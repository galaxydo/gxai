// src/agent.ts
import { z } from "zod";
import { measure } from "measure-fn";
import type { AgentConfig, MCPTool, MCPServer, ProgressCallback, ProgressUpdate, StreamingCallback, StreamingUpdate } from './types';
import { objToXml, xmlToObj } from './xml';
import { callLLM } from './inference';
import { discoverTools, invokeTool } from './mcp';
import { fetchWithPayment } from './payments';
import { generateRequestId } from './utils';
import { validateUrl } from './validation';

export class Agent<I extends z.ZodObject<any>, O extends z.ZodObject<any>> {
  private config: AgentConfig<I, O>;

  constructor(config: AgentConfig<I, O>) {
    this.config = config;
    this.validateNoArrays(this.config.outputFormat);
  }

  async run(input: z.infer<I>, progressCallback?: ProgressCallback): Promise<z.infer<O>> {
    const requestId = generateRequestId();
    const startTime = Date.now();
    const toolInvocations: Array<{ server: string; tool: string; parameters: any; result: any }> = [];

    try {
      const result = await measure.assert(`Agent.run ${this.config.llm}`, async (m) => {
        const validatedInput = await m('Validate input', () =>
          this.config.inputFormat.parse(input)
        );

        progressCallback?.({
          stage: "input_resolution",
          message: "Resolving MCP-dependent input fields...",
        });
        await m('Resolve MCP inputs', () =>
          this.resolveMCPInputFields(validatedInput, progressCallback)
        );

        let relevantServers: MCPServer[] = [];
        if (this.config.servers && this.config.servers.length > 0) {
          progressCallback?.({
            stage: "server_selection",
            message: "Analyzing input to determine relevant servers...",
          });
          relevantServers = await m('Select servers', () =>
            this.selectRelevantServers(validatedInput)
          ) ?? [];
          progressCallback?.({
            stage: "server_selection",
            message: `Selected ${relevantServers.length} relevant servers`,
            data: { servers: relevantServers.map((s) => s.name) },
          });
        }

        const toolResults: Record<string, any> = {};
        if (relevantServers.length > 0) {
          progressCallback?.({
            stage: "tool_discovery",
            message: "Discovering available tools...",
          });
          await m('Discover and invoke tools', async () => {
            for (const server of relevantServers) {
              const tools = await discoverTools(server);
              if (tools && tools.length > 0) {
                const relevantTools = await this.selectRelevantTools(validatedInput, tools, server);
                for (const tool of (relevantTools ?? [])) {
                  progressCallback?.({
                    stage: "tool_invocation",
                    message: `Invoking ${server.name}.${tool.name}...`,
                  });
                  const parameters = await this.generateToolParameters(validatedInput, tool);
                  const result = await invokeTool(server, tool.name, parameters);
                  toolResults[`${server.name}.${tool.name}`] = result;
                  toolInvocations.push({
                    server: server.name,
                    tool: tool.name,
                    parameters,
                    result
                  });
                }
              }
            }
          });
        }

        progressCallback?.({
          stage: "response_generation",
          message: "Generating final response...",
        });

        const response = await this.generateResponse(validatedInput, toolResults, progressCallback);

        const validatedResponse = await m('Validate output', () =>
          this.config.outputFormat.parse(response || {})
        );

        return validatedResponse || {};
      });

      // Send analytics if configured
      if (this.config.analyticsUrl) {
        await this.sendAnalytics({
          id: requestId,
          agentName: this.config.name || 'unnamed-agent',
          llm: this.config.llm,
          timestamp: startTime,
          duration: Date.now() - startTime,
          status: 'success',
          input,
          output: result,
          toolInvocations: toolInvocations.length > 0 ? toolInvocations : undefined,
        });
      }

      return result;
    } catch (error) {
      if (this.config.analyticsUrl) {
        await this.sendAnalytics({
          id: requestId,
          agentName: this.config.name || 'unnamed-agent',
          llm: this.config.llm,
          timestamp: startTime,
          duration: Date.now() - startTime,
          status: 'error',
          input,
          output: {},
          error: error instanceof Error ? error.message : String(error),
          toolInvocations: toolInvocations.length > 0 ? toolInvocations : undefined,
        });
      }
      throw error;
    }
  }

  private async sendAnalytics(data: {
    id: string;
    agentName: string;
    llm: string;
    timestamp: number;
    duration: number;
    status: 'success' | 'error';
    input: any;
    output: any;
    error?: string;
    toolInvocations?: Array<{ server: string; tool: string; parameters: any; result: any }>;
  }): Promise<void> {
    if (!this.config.analyticsUrl) return;

    try {
      await fetch(this.config.analyticsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
    } catch (e) {
      // Silently fail analytics - don't break the main flow
      console.warn('Failed to send analytics:', e);
    }
  }

  private async resolveMCPInputFields(input: any, progressCallback?: ProgressCallback): Promise<void> {
    const shape = this.config.inputFormat.shape;
    for (const [key, schema] of Object.entries(shape)) {
      const desc = (schema as any).description as string | undefined;
      if (!desc || !desc.startsWith("mcp:")) continue;

      const urlMatch = desc.match(/^mcp:\s*(https?:\/\/[^\s]+)/);
      if (!urlMatch) continue;
      const serverUrl = validateUrl(urlMatch[1]);

      const tempServer: MCPServer = {
        name: `resolver_${key}`,
        description: `Temporary server for resolving input field ${key}`,
        url: serverUrl,
      };

      progressCallback?.({
        stage: "input_resolution",
        message: `Resolving input field "${key}" using MCP server at ${serverUrl}...`,
      });

      const tools = await discoverTools(tempServer);
      if (!tools || tools.length === 0) continue;

      const systemPrompt = `You are selecting the most appropriate tool from the available tools on the server to resolve the value for the input field "${key}". 
      The field's description is: "${desc}".
      Select only the single most relevant tool based on the field description, tool descriptions, and the provided user input.
      If no tool seems suitable, do not select any.`;

      const userPrompt = objToXml({
        resolve_field: key,
        field_description: desc,
        input,
        available_tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema,
        })),
        task: "Select the tool name to invoke to resolve this field",
        response_format: { selected_tool: "string: the name of the selected tool" },
      });

      const response = await callLLM(
        this.config.llm,
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: `<request>${userPrompt}</request>` },
        ],
        { temperature: 0.3 },
        null,
        undefined,
        progressCallback,
        (url, options, _m, desc, pcb) => fetchWithPayment(url, options, desc, pcb, this.config.solanaWallet)
      );

      if (!response) continue;

      let selectedToolName: string | undefined;
      try {
        const parsed = xmlToObj(response);
        selectedToolName = parsed.selected_tool;
      } catch (error) {
        continue;
      }

      if (!selectedToolName) continue;

      const tool = tools.find((t) => t.name === selectedToolName);
      if (!tool) continue;

      const parameters = await this.generateToolParameters(input, tool);
      const result = await invokeTool(tempServer, tool.name, parameters);

      input[key] = result;

      progressCallback?.({
        stage: "input_resolution",
        message: `Resolved input field "${key}" with value: ${JSON.stringify(result).substring(0, 100)}...`,
      });
    }
  }

  private async selectRelevantServers(input: any): Promise<MCPServer[]> {
    if (!this.config.servers || this.config.servers.length === 0) return [];

    return await measure('Select relevant servers', async () => {
      const systemPrompt = `You are analyzing user input to determine which servers might be relevant to fulfill the request. 
        Select only servers that are likely needed based on the input content.`;
      const userPrompt = objToXml({
        input,
        available_servers: this.config.servers!.map(s => ({ name: s.name, description: s.description })),
        task: "Select relevant server names that should be used to fulfill this request",
        response_format: { relevant_servers: { server_names: "array of server names" } },
      });

      const response = await callLLM(
        this.config.llm,
        [{ role: "system", content: systemPrompt }, { role: "user", content: `<request>${userPrompt}</request>` }],
        { temperature: 0.3 },
        null,
        undefined,
        undefined,
        (url, options, _m, desc) => fetchWithPayment(url, options, desc)
      );

      if (!response) return this.config.servers!;

      try {
        const parsed = xmlToObj(response);
        const serverNames = parsed.relevant_servers?.server_names || [];
        return this.config.servers!.filter(server =>
          Array.isArray(serverNames) ? serverNames.includes(server.name) : serverNames === server.name
        );
      } catch (error) {
        return this.config.servers!;
      }
    }) ?? [];
  }

  private async selectRelevantTools(input: any, tools: MCPTool[], server: MCPServer): Promise<MCPTool[]> {
    if (tools.length === 0) return [];

    return await measure(`Select tools from ${server.name}`, async () => {
      const systemPrompt = `You are selecting which tools from a server should be used to fulfill a user request.
        Select only tools that are necessary for the given input.`;
      const userPrompt = objToXml({
        input,
        server: server.name,
        available_tools: tools.map(t => ({ name: t.name, description: t.description })),
        task: "Select tool names that should be invoked",
        response_format: { selected_tools: { tool_names: "array of tool names" } },
      });

      const response = await callLLM(
        this.config.llm,
        [{ role: "system", content: systemPrompt }, { role: "user", content: `<request>${userPrompt}</request>` }],
        { temperature: 0.3 },
        null,
        undefined,
        undefined,
        (url, options, _m, desc) => fetchWithPayment(url, options, desc)
      );

      if (!response) return tools.slice(0, 1);

      try {
        const parsed = xmlToObj(response);
        const toolNames = parsed.selected_tools?.tool_names || [];
        return tools.filter(tool =>
          Array.isArray(toolNames) ? toolNames.includes(tool.name) : toolNames === tool.name
        );
      } catch (error) {
        return tools.slice(0, 1);
      }
    }) ?? [];
  }

  private async generateToolParameters(input: any, tool: MCPTool): Promise<any> {
    return await measure(`Generate params for ${tool.name}`, async () => {
      const systemPrompt = `You are generating parameters for a tool invocation based on user input and tool specification.
        Generate appropriate parameters that match the tool's input schema.`;
      const userPrompt = objToXml({
        input,
        tool: { name: tool.name, description: tool.description, input_schema: tool.inputSchema },
        task: "Generate parameters for this tool",
        response_format: { parameters: "object containing the tool parameters" },
      });

      const response = await callLLM(
        this.config.llm,
        [{ role: "system", content: systemPrompt }, { role: "user", content: `<request>${userPrompt}</request>` }],
        { temperature: 0.3 },
        null,
        undefined,
        undefined,
        (url, options, _m, desc) => fetchWithPayment(url, options, desc)
      );

      if (!response) return {};

      try {
        const parsed = xmlToObj(response);
        return parsed.parameters || {};
      } catch (error) {
        return {};
      }
    }) ?? {};
  }

  private async generateResponse(
    input: any,
    toolResults: Record<string, any>,
    progressCallback?: ProgressCallback
  ): Promise<any> {
    const streamingCallback: StreamingCallback | undefined = progressCallback ?
      (update: StreamingUpdate) => progressCallback(update as unknown as ProgressUpdate) :
      undefined;

    const systemPrompt = this.config.systemPrompt || "";
    const obj: any = {
      input,
      output_format: this.getOutputFormatDescription(),
      task: this.generateTaskDescription(),
    };

    const hasToolResults = toolResults && Object.keys(toolResults).length > 0 &&
      Object.values(toolResults).some(result =>
        result !== null && result !== undefined && result !== '' && JSON.stringify(result) !== '{}');
    if (hasToolResults) {
      obj.context = { tool_results: toolResults };
    }
    const userPrompt = objToXml(obj);
    const messages: Array<{ role: string; content: string }> = [];
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt })
    }
    messages.push({ role: "user", content: `<request>${userPrompt}</request>` });

    const response = await measure(`LLM ${this.config.llm}`, () =>
      callLLM(
        this.config.llm,
        messages,
        { temperature: this.config.temperature || 0.7, maxTokens: this.config.maxTokens || 4000 },
        null,
        streamingCallback,
        progressCallback,
        (url, options, _m, desc, pcb) => fetchWithPayment(url, options, desc, pcb, this.config.solanaWallet)
      )
    );

    if (!response) return {};

    const parsed = xmlToObj(response);
    if (!parsed) return {};

    const rootKey = Object.keys(parsed)[0];
    const sourceObject = (rootKey && typeof parsed[rootKey] === 'object' && Object.keys(parsed).length === 1) ? parsed[rootKey] : parsed;

    const shape = this.config.outputFormat.shape;
    const result: any = {};

    for (const [key, schema] of Object.entries(shape)) {
      if (sourceObject[key] !== undefined) {
        let value = sourceObject[key];
        const typeName = this.getSchemaTypeName(schema as z.ZodType<any>);

        if (typeName === 'ZodString' && typeof value === 'object' && value !== null) {
          const fieldRegex = new RegExp(`<${key}>([\\s\\S]*?)</${key}>`, 's');
          const match = response.match(fieldRegex);
          if (match && typeof match[1] === 'string') {
            value = match[1];
          }
        }
        result[key] = value;
      }
    }
    return result;
  }

  private validateNoArrays(schema: z.ZodObject<any>, path: string = ''): void {
    const shape = schema.shape;
    for (const [key, fieldSchema] of Object.entries(shape)) {
      const currentPath = path ? `${path}.${key}` : key;

      let currentSchema = fieldSchema as any;
      while (currentSchema._def.typeName === 'ZodOptional' || currentSchema._def.typeName === 'ZodNullable') {
        currentSchema = currentSchema.unwrap();
      }

      if (currentSchema._def.typeName === 'ZodArray') {
        throw new Error(`Arrays are not supported in output schema. Found array at path: ${currentPath}. Use individual fields like ${key}_1, ${key}_2 instead.`);
      }

      if (currentSchema._def.typeName === 'ZodObject') {
        this.validateNoArrays(currentSchema, currentPath);
      }
    }
  }

  private getSchemaTypeName(schema: z.ZodType<any>): string {
    const def = schema._def as any;
    if (def.typeName === "ZodOptional" || def.typeName === "ZodNullable") {
      return this.getSchemaTypeName((schema as any).unwrap());
    }
    return def.typeName;
  }

  private getOutputFormatDescription(): any {
    const shape = this.config.outputFormat.shape;
    const description: any = {};

    for (const [key, schema] of Object.entries(shape)) {
      let currentSchema = schema as any;
      while (currentSchema._def.typeName === 'ZodOptional' || currentSchema._def.typeName === 'ZodNullable') {
        currentSchema = currentSchema.unwrap();
      }

      if (currentSchema._def.typeName === 'ZodObject') {
        description[key] = this.getNestedDescription(currentSchema);
      } else {
        description[key] = '';
      }
    }

    return description;
  }

  private getNestedDescription(schema: z.ZodObject<any>): any {
    const shape = schema.shape;
    const description: any = {};

    for (const [key, fieldSchema] of Object.entries(shape)) {
      let currentSchema = fieldSchema as any;
      while (currentSchema._def.typeName === 'ZodOptional' || currentSchema._def.typeName === 'ZodNullable') {
        currentSchema = currentSchema.unwrap();
      }

      if (currentSchema._def.typeName === 'ZodObject') {
        description[key] = this.getNestedDescription(currentSchema);
      } else {
        description[key] = '';
      }
    }

    return description;
  }

  private generateTaskDescription(): string {
    const fieldDescriptions = this.getFieldDescriptions(this.config.outputFormat);
    let task = "Generate a response matching the output format exactly, using XML tags for each field";

    if (fieldDescriptions.length > 0) {
      task += "\naccordingly to following instructions:\n\n" + fieldDescriptions.join('\n');
    }

    return task;
  }

  private getFieldDescriptions(schema: z.ZodObject<any>, path: string = ''): string[] {
    const shape = schema.shape;
    const descriptions: string[] = [];

    for (const [key, fieldSchema] of Object.entries(shape)) {
      const currentPath = path ? `${path}_${key}` : key;

      let currentSchema = fieldSchema as any;
      let description = (fieldSchema as any).description || '';

      while (currentSchema._def.typeName === 'ZodOptional' || currentSchema._def.typeName === 'ZodNullable') {
        currentSchema = currentSchema.unwrap();
        if (!description) {
          description = currentSchema.description || '';
        }
      }

      let constraint: string | null = null;
      if (currentSchema._def.typeName === 'ZodBoolean') {
        constraint = 'either "true" or "false"';
      } else if (currentSchema._def.typeName === 'ZodEnum') {
        const allowedValues = currentSchema._def.values;
        constraint = `exactly one of these values: ${allowedValues.map((v: string) => `"${v}"`).join(', ')}`;
      }

      if (constraint) {
        if (description) {
          description += `. Must be ${constraint}`;
        } else {
          description = `Must be ${constraint}`;
        }
      }

      if (description) {
        descriptions.push(`- ${currentPath} SHOULD be ${description}`);
      }

      if (currentSchema._def.typeName === 'ZodObject') {
        descriptions.push(...this.getFieldDescriptions(currentSchema, currentPath));
      }
    }

    return descriptions;
  }
}

if (import.meta.env.NODE_ENV === "test") {
  const { test, expect } = await import('bun:test');

  test('Agent constructor validates no arrays in output schema', () => {
    const validConfig = {
      llm: 'gpt-4o-mini' as const,
      inputFormat: z.object({}),
      outputFormat: z.object({ field: z.string() }),
    };
    expect(() => new Agent(validConfig)).not.toThrow();

    const invalidConfig = {
      llm: 'gpt-4o-mini' as const,
      inputFormat: z.object({}),
      outputFormat: z.object({ field: z.array(z.string()) }),
    };
    expect(() => new Agent(invalidConfig)).toThrow('Arrays are not supported');
  });

  test('Agent run validates input', async () => {
    const config = {
      llm: 'gpt-4o-mini' as const,
      inputFormat: z.object({ name: z.string() }),
      outputFormat: z.object({ output: z.string() }),
    };
    const agent = new Agent(config);
    // Should throw on invalid input
    await expect(agent.run({ invalid: true } as any)).rejects.toThrow();
  });
}
