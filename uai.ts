import { z } from "zod";

import { measure } from "@ments/utils";

/** Generates a unique request ID for tracking operations. */
function generateRequestId(): string {
  return Math.random().toString(36).substring(2, 10);
}

// ### LLM Definitions
export const LLM = {
  "gpt-4o-mini": "gpt-4o-mini",
  gpt4o: "gpt-4o",
  gpt4: "gpt-4",
  claude: "claude-3-sonnet-20240229",
  deepseek: "deepseek-chat",
} as const;

export type LLMType = typeof LLM[keyof typeof LLM];

// ### MCP Server and Tool Interfaces
export interface MCPServer {
  name: string;
  description: string;
  url: string;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: any; // JSON schema for tool parameters
}

// ### Agent Configuration
export interface AgentConfig<I extends z.ZodObject<any>, O extends z.ZodObject<any>> {
  llm: LLMType;
  inputFormat: I;
  outputFormat: O;
  servers?: MCPServer[];
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
}

// ### Progress Callback Types
export interface ProgressUpdate {
  stage: "server_selection" | "tool_discovery" | "tool_invocation" | "response_generation" | "streaming";
  message: string;
  data?: any;
}
export interface StreamingUpdate {
  stage: "streaming";
  field: string;
  value: string;
}


export type ProgressCallback = (update: ProgressUpdate) => void;
export type StreamingCallback = (update: StreamingUpdate) => void;

// ### XML Utilities
/** Converts an object to an XML string. */
function objToXml(obj: any, parentKey?: string): string {
  const sanitizeTagName = (name: string): string => {
    return name.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^[^a-zA-Z]/, "tag_$&");
  };

  const wrapTag = (tag: string, content: string): string => {
    const safeTag = sanitizeTagName(tag);
    return `<${safeTag}>${content}</${safeTag}>`;
  };

  if (Array.isArray(obj)) {
    return wrapTag(
      `${parentKey ?? "array"}`,
      obj.map((item) => wrapTag("item", typeof item === "object" ? objToXml(item) : String(item))).join("")
    );
  }

  if (obj && typeof obj === "object") {
    const entries = Object.entries(obj).filter(([, v]) => v !== undefined && v !== null);
    if (entries.length === 0) {
      return wrapTag(parentKey || "empty", "");
    }
    const content = entries
      .map(([key, value]) =>
        typeof value === "object" ? objToXml(value, key) : `<${key}>${String(value)}</${key}>`
      )
      .join("");
    return parentKey ? wrapTag(parentKey, content) : content;
  }

  return wrapTag(parentKey || "value", String(obj));
}

/** Parses an XML string into an object. */
function xmlToObj(xmlContent: string): any {
  const parseElement = (content: string): any => {
    content = content.trim();
    if (!content.includes("<")) {
      return content || "";
    }
    const result: any = {};
    const tagRegex = /<([^>\s/]+)(?:[^>]*)>(.*?)<\/\1>/gs;
    let match;
    let hasMatches = false;
    while ((match = tagRegex.exec(content)) !== null) {
      hasMatches = true;
      const [, tagName, tagContent] = match;
      if (tagContent.trim().includes("<")) {
        result[tagName] = parseElement(tagContent);
      } else {
        const trimmedContent = tagContent.trim();
        if (trimmedContent === "true" || trimmedContent === "false") {
          result[tagName] = trimmedContent === "true";
        } else if (/^\d+(\.\d+)?$/.test(trimmedContent)) {
          result[tagName] = Number(trimmedContent);
        } else {
          result[tagName] = trimmedContent;
        }
      }
    }
    if (!hasMatches) return content;
    return result;
  };
  return parseElement(xmlContent);
}

// ### LLM API Calls
async function callLLM(
  llm: LLMType,
  messages: Array<{ role: string; content: string }>,
  options: { temperature?: number; maxTokens?: number } = {},
  measureFn?: typeof measure,
  streamingCallback?: StreamingCallback
): Promise<string> {
  const executeCall = async (measure: typeof measure) => {
    const { temperature = 0.7, maxTokens = 4000 } = options;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    let url = "";
    let body: Record<string, any> = {};
    if (llm.includes("claude")) {
      headers["x-api-key"] = process.env.ANTHROPIC_API_KEY!;
      headers["anthropic-version"] = "2023-06-01";
      url = "https://api.anthropic.com/v1/messages";
      body = { model: llm, max_tokens: maxTokens, messages, stream: !!streamingCallback };
    } else if (llm.includes("deepseek")) {
      headers["Authorization"] = `Bearer ${process.env.DEEPSEEK_API_KEY}`;
      url = "https://api.deepseek.com/v1/chat/completions";
      body = { model: llm, temperature, messages, max_tokens: maxTokens, stream: !!streamingCallback };
    } else {
      headers["Authorization"] = `Bearer ${process.env.OPENAI_API_KEY}`;
      url = "https://api.openai.com/v1/chat/completions";
      if (llm.includes('o4-')) {
        body = { model: llm, temperature: 1.0, messages, max_completion_tokens: maxTokens, stream: !!streamingCallback };
      } else {
        body = { model: llm, temperature, messages, max_tokens: maxTokens, stream: !!streamingCallback };
      }
    }

    const requestBodyStr = JSON.stringify(body);

    if (!streamingCallback) {
      const response = await measure(
        async () => {
          const res = await fetch(url, {
            method: "POST",
            headers,
            body: requestBodyStr,
          });
          if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`LLM API error: ${errorText}`);
          }
          return res;
        },
        `HTTP ${llm} API call - Body: ${requestBodyStr.substring(0, 200)}...`
      );
      if (!response) {
        throw new Error(`LLM API call to ${llm} failed. The network request did not return a response.`);
      }
      const data = await response.json();
      const content = llm.includes("claude") ? data.content?.[0]?.text : data.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error(
          `LLM API call to ${llm} failed. Unexpected response format: ${JSON.stringify(data).substring(0, 200)}...`
        );
      }
      return content;
    } else {
      // Streaming response handling
      const response = await measure(
        async () => {
          const res = await fetch(url, {
            method: "POST",
            headers,
            body: requestBodyStr,
          });
          if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`LLM API error: ${errorText}`);
          }
          return res;
        },
        `HTTP ${llm} streaming API call - Body: ${requestBodyStr.substring(0, 200)}...`
      );
      if (!response) {
        throw new Error(`LLM streaming API call to ${llm} failed. The network request did not return a response.`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No readable stream available");
      }

      const decoder = new TextDecoder();
      let fullResponse = "";
      let buffer = "";
      let tagStack: string[] = [];
      let currentTagName = "";
      let wordBuffer = "";
      let insideTag = false;

      const parseSseLine = (line: string): string => {
        if (!line.startsWith("data: ") || line.includes("[DONE]")) {
          return "";
        }
        try {
          const data = JSON.parse(line.slice(6));
          if (llm.includes("claude")) {
            return data.type === "content_block_delta" && data.delta?.text ? data.delta.text : "";
          } else {
            return data.choices?.[0]?.delta?.content || "";
          }
        } catch (e) {
          return "";
        }
      };

      const processChunk = (chunk: string) => {
        fullResponse += chunk;

        for (const char of chunk) {
          if (char === "<") {
            if (wordBuffer && tagStack.length > 0) {
              streamingCallback({ stage: "streaming", field: tagStack.join("_"), value: wordBuffer });
            }
            wordBuffer = "";
            insideTag = true;
            currentTagName = "";
          } else if (char === ">" && insideTag) {
            insideTag = false;
            if (currentTagName.startsWith("/")) {
              tagStack.pop();
            } else if (currentTagName.trim()) {
              tagStack.push(currentTagName.trim());
            }
            currentTagName = "";
            wordBuffer = "";
          } else if (insideTag) {
            currentTagName += char;
          } else if (tagStack.length > 0) {
            const currentField = tagStack.join("_");
            if (char === " " || char === "\n") {
              if (wordBuffer) {
                streamingCallback({ stage: "streaming", field: currentField, value: wordBuffer });
              }
              streamingCallback({ stage: "streaming", field: currentField, value: char });
              wordBuffer = "";
            } else {
              wordBuffer += char;
            }
          }
        }
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || ""; // Keep incomplete line in buffer

          for (const line of lines) {
            const content = parseSseLine(line);
            if (content) {
              processChunk(content);
            }
          }
        }
      } finally {
        reader.releaseLock();
        // Process any remaining buffer after the loop
        if (buffer) {
          const content = parseSseLine(buffer);
          if (content) {
            processChunk(content);
          }
        }
        // Send any pending word buffer at the end
        if (wordBuffer && tagStack.length > 0 && streamingCallback) {
          streamingCallback({ stage: "streaming", field: tagStack.join("_"), value: wordBuffer });
        }
      }

      return fullResponse;
    }
  };
  return measureFn
    ? await measureFn(executeCall, `LLM call to ${llm}`)
    : await measure(executeCall, `LLM call to ${llm}`);
}
// ### MCP Server Communication
/** Discovers tools from an MCP server with measurement. */
async function discoverTools(server: MCPServer, measureFn?: typeof measure): Promise<MCPTool[]> {
  const executeDiscovery = async (measure: typeof measure) => {
    const response = await measure(
      async () => {
        const res = await fetch(`${server.url}/tools`, {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        });
        if (!res.ok) {
          throw new Error(`Failed to discover tools: ${res.statusText}`);
        }
        return res;
      },
      `HTTP GET ${server.url}/tools`
    );
    if (!response) {
      throw new Error(`Failed to discover tools from ${server.name}: No response.`);
    }
    const tools = await response.json();
    return await measure(
      async () => tools,
      `Discovered ${tools.length} tools from ${server.name}`
    );
  };
  const discoveredTools = await (measureFn
    ? measureFn(executeDiscovery, `Discover tools from ${server.name}`)
    : measure(executeDiscovery, `Discover tools from ${server.name}`));
  return discoveredTools || [];
}

/** Invokes a tool on an MCP server with measurement. */
async function invokeTool(server: MCPServer, toolName: string, parameters: any, measureFn?: typeof measure): Promise<any> {
  const executeInvocation = async (measure: typeof measure) => {
    const response = await measure(
      async () => {
        const res = await fetch(`${server.url}/call`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ method: toolName, params: parameters }),
        });
        if (!res.ok) {
          throw new Error(`Tool invocation failed: ${res.statusText}`);
        }
        return res;
      },
      `HTTP POST ${server.url}/call - Tool: ${toolName}, Params: ${JSON.stringify(parameters).substring(0, 200)}...`
    );
    if (!response) {
      throw new Error(`Tool invocation for ${toolName} on ${server.name} failed: No response from server.`);
    }
    const result = await response.json();
    return await measure(
      async () => result,
      `Tool ${toolName} returned: ${typeof result === "object" ? JSON.stringify(result).substring(0, 100) + "..." : result}`
    );
  };
  return measureFn
    ? await measureFn(executeInvocation, `Invoke ${server.name}.${toolName}`)
    : await measure(executeInvocation, `Invoke ${server.name}.${toolName}`);
}

// ### Main Agent Class
export class Agent<I extends z.ZodObject<any>, O extends z.ZodObject<any>> {
  private config: AgentConfig<I, O>;

  constructor(config: AgentConfig<I, O>) {
    this.config = config;
    this.validateNoArrays(this.config.outputFormat);
  }

  /** Runs the agent with the given input, using measurement for all logging. */
  async run(input: z.infer<I>, progressCallback?: ProgressCallback, measureFn?: typeof measure): Promise<z.infer<O>> {
    const requestId = generateRequestId();
    return await (measureFn || measure)(
      async (measure) => {
        const validatedInput = await measure(
          async () => this.config.inputFormat.parse(input),
          "Validate input schema"
        );
        if (!validatedInput) {
          throw new Error("Input validation failed. Please check the provided input against the agent's input format.");
        }
        let relevantServers: MCPServer[] = [];
        if (this.config.servers && this.config.servers.length > 0) {
          progressCallback?.({
            stage: "server_selection",
            message: "Analyzing input to determine relevant servers...",
          });
          relevantServers = await measure(
            async (measure) => await this.selectRelevantServers(validatedInput, measure),
            "Select relevant MCP servers"
          );
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
          await measure(
            async (measure) => {
              for (const server of relevantServers) {
                const tools = await discoverTools(server, measure);
                if (tools.length > 0) {
                  const relevantTools = await measure(
                    async (measure) => await this.selectRelevantTools(validatedInput, tools, server, measure),
                    `Select relevant tools from ${server.name}`
                  );
                  for (const tool of relevantTools) {
                    progressCallback?.({
                      stage: "tool_invocation",
                      message: `Invoking ${server.name}.${tool.name}...`,
                    });
                    try {
                      await measure(
                        async (measure) => {
                          const parameters = await measure(
                            async (measure) => await this.generateToolParameters(validatedInput, tool, measure),
                            `Generate parameters for ${tool.name}`
                          );
                          const result = await invokeTool(server, tool.name, parameters, measure);
                          toolResults[`${server.name}.${tool.name}`] = result;
                        },
                        `Execute ${server.name}.${tool.name}`
                      );
                    } catch (error) {
                      // Error handled by measure
                    }
                  }
                }
              }
            },
            "Discover and invoke tools"
          );
        }
        progressCallback?.({
          stage: "response_generation",
          message: "Generating final response...",
        });

        const response = await measure(
          async (measure) => await this.generateResponse(validatedInput, toolResults, measure, progressCallback),
          "Generate AI response with toolResults: " + JSON.stringify(toolResults),
        );

        // If response generation fails, response can be null or an empty object.
        const validationMessage = response ? `Validate output schema of response fields: ${Object.keys(response).join(", ")}` : "Skipping validation of empty response.";

        const validatedResponse = await measure(
          async () => this.config.outputFormat.parse(response || {}),
          validationMessage
        );

        return validatedResponse || {}; // Return empty object if validation fails.
      },
      `Agent.run for ${this.config.llm}`,
      { requestId }
    );
  }

  /** Selects relevant servers based on input. */
  private async selectRelevantServers(input: any, measureFn: typeof measure): Promise<MCPServer[]> {
    if (!this.config.servers || this.config.servers.length === 0) return [];
    return await measureFn(
      async (measure) => {
        const systemPrompt = `You are analyzing user input to determine which servers might be relevant to fulfill the request. 
        Select only servers that are likely needed based on the input content.`;
        const userPrompt = await measure(
          async () => objToXml({
            input,
            available_servers: this.config.servers!.map(s => ({ name: s.name, description: s.description })),
            task: "Select relevant server names that should be used to fulfill this request",
            response_format: { relevant_servers: { server_names: "array of server names" } },
          }),
          "Generate server selection prompt"
        );
        const response = await callLLM(
          this.config.llm,
          [{ role: "system", content: systemPrompt }, { role: "user", content: `<request>${userPrompt}</request>` }],
          { temperature: 0.3 },
          measure
        );
        if (!response) {
          return this.config.servers!;
        }
        try {
          const parsed = xmlToObj(response);
          const serverNames = parsed.relevant_servers?.server_names || [];
          const selectedServers = this.config.servers!.filter(server =>
            Array.isArray(serverNames) ? serverNames.includes(server.name) : serverNames === server.name
          );
          return await measure(
            async () => selectedServers,
            `Selected ${selectedServers.length} servers: ${selectedServers.map(s => s.name).join(", ")}`
          );
        } catch (error) {
          return this.config.servers!;
        }
      },
      "Select relevant servers"
    );
  }

  /** Selects relevant tools from a server. */
  private async selectRelevantTools(input: any, tools: MCPTool[], server: MCPServer, measureFn: typeof measure): Promise<MCPTool[]> {
    if (tools.length === 0) return [];
    return await measureFn(
      async (measure) => {
        const systemPrompt = `You are selecting which tools from a server should be used to fulfill a user request.
        Select only tools that are necessary for the given input.`;
        const userPrompt = await measure(
          async () => objToXml({
            input,
            server: server.name,
            available_tools: tools.map(t => ({ name: t.name, description: t.description })),
            task: "Select tool names that should be invoked",
            response_format: { selected_tools: { tool_names: "array of tool names" } },
          }),
          "Generate tool selection prompt"
        );
        const response = await callLLM(
          this.config.llm,
          [{ role: "system", content: systemPrompt }, { role: "user", content: `<request>${userPrompt}</request>` }],
          { temperature: 0.3 },
          measure
        );
        if (!response) {
          return tools.slice(0, 1);
        }
        try {
          const parsed = xmlToObj(response);
          const toolNames = parsed.selected_tools?.tool_names || [];
          const selectedTools = tools.filter(tool =>
            Array.isArray(toolNames) ? toolNames.includes(tool.name) : toolNames === tool.name
          );
          return await measure(
            async () => selectedTools,
            `Selected ${selectedTools.length} tools from ${server.name}: ${selectedTools.map(t => t.name).join(", ")}`
          );
        } catch (error) {
          return tools.slice(0, 1);
        }
      },
      `Select relevant tools from ${server.name}`
    );
  }

  /** Generates parameters for a tool invocation. */
  private async generateToolParameters(input: any, tool: MCPTool, measureFn: typeof measure): Promise<any> {
    return await measureFn(
      async (measure) => {
        const systemPrompt = `You are generating parameters for a tool invocation based on user input and tool specification.
        Generate appropriate parameters that match the tool's input schema.`;
        const userPrompt = await measure(
          async () => objToXml({
            input,
            tool: { name: tool.name, description: tool.description, input_schema: tool.inputSchema },
            task: "Generate parameters for this tool",
            response_format: { parameters: "object containing the tool parameters" },
          }),
          "Generate parameter generation prompt"
        );
        const response = await callLLM(
          this.config.llm,
          [{ role: "system", content: systemPrompt }, { role: "user", content: `<request>${userPrompt}</request>` }],
          { temperature: 0.3 },
          measure
        );
        if (!response) {
          return {};
        }
        try {
          const parsed = xmlToObj(response);
          const parameters = parsed.parameters || {};
          return await measure(
            async () => parameters,
            `Generated parameters for ${tool.name}: ${JSON.stringify(parameters).substring(0, 100)}...`
          );
        } catch (error) {
          return {};
        }
      },
      `Generate parameters for ${tool.name}`
    );
  }

  /** Generates the final response based on input and tool results. */
  private async generateResponse(
    input: any,
    toolResults: Record<string, any>,
    measure: typeof measure,
    progressCallback?: ProgressCallback
  ): Promise<any> {
    const streamingCallback: StreamingCallback | undefined = progressCallback ?
      (update) => progressCallback(update as ProgressUpdate) :
      undefined;

    const systemPrompt = this.config.systemPrompt || null;
    const obj = {
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
    const messages = [];
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt })
    }
    messages.push({ role: "user", content: `<request>${userPrompt}</request>` });

    const response = await measure(() => callLLM(
      this.config.llm,
      messages,
      { temperature: this.config.temperature || 0.7, maxTokens: this.config.maxTokens || 4000 },
      measure,
      streamingCallback
    ), `Executing Prompt: ${userPrompt}`);
    if (!response) {
      return {};
    }


    const parsed = await measure(
      async () => xmlToObj(response),
      "Parsing Response: " + response,
    );
    if (!parsed) {
      return {};
    }

    const shape = this.config.outputFormat.shape;
    const result: any = {};

    // Determine the main object to extract fields from, handling a potential single root element in the XML response.
    const rootKey = Object.keys(parsed)[0];
    const sourceObject = (rootKey && typeof parsed[rootKey] === 'object' && Object.keys(parsed).length === 1) ? parsed[rootKey] : parsed;

    for (const [key, schema] of Object.entries(shape)) {
      if (sourceObject[key] !== undefined) {
        let value = sourceObject[key];
        const typeName = this.getSchemaTypeName(schema as z.ZodType<any>);

        // If the schema expects a string but the parser returned an object, it's likely an unescaped markup string.
        if (typeName === 'ZodString' && typeof value === 'object' && value !== null) {
          // Re-extract the raw inner content for this field from the original XML response string.
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

  /** Validates that the output schema contains no arrays. */
  private validateNoArrays(schema: z.ZodObject<any>, path: string = ''): void {
    const shape = schema.shape;
    for (const [key, fieldSchema] of Object.entries(shape)) {
      const currentPath = path ? `${path}.${key}` : key;

      // Unwrap optional/nullable
      let currentSchema = fieldSchema as z.ZodType<any>;
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


  /** Gets the type name of a Zod schema, unwrapping optional/nullable types. */
  private getSchemaTypeName(schema: z.ZodType<any>): string {
    if (schema._def.typeName === "ZodOptional" || schema._def.typeName === "ZodNullable") {
      return this.getSchemaTypeName(schema.unwrap());
    }
    return schema._def.typeName;
  }
  /** Returns the output format structure for use in prompts. */
  private getOutputFormatDescription(): any {
    const shape = this.config.outputFormat.shape;
    const description: any = {};

    for (const [key, schema] of Object.entries(shape)) {
      const zodSchema = schema as z.ZodType<any>;

      // Unwrap optional and nullable to get to the core type
      let currentSchema = zodSchema;
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

  /** Returns nested object structure description. */
  private getNestedDescription(schema: z.ZodObject<any>): any {
    const shape = schema.shape;
    const description: any = {};

    for (const [key, fieldSchema] of Object.entries(shape)) {
      const zodSchema = fieldSchema as z.ZodType<any>;

      let currentSchema = zodSchema;
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

  /** Generates task description with field explanations. */
  private generateTaskDescription(): string {
    const fieldDescriptions = this.getFieldDescriptions(this.config.outputFormat);
    let task = "Generate a response matching the output format exactly, using XML tags for each field";

    if (fieldDescriptions.length > 0) {
      task += "\naccordingly to following instructions:\n\n" + fieldDescriptions.join('\n');
    }

    return task;
  }

  /** Extracts field descriptions from schema recursively. */
  private getFieldDescriptions(schema: z.ZodObject<any>, path: string = ''): string[] {
    const shape = schema.shape;
    const descriptions: string[] = [];

    for (const [key, fieldSchema] of Object.entries(shape)) {
      const currentPath = path ? `${path}_${key}` : key;
      const zodSchema = fieldSchema as z.ZodType<any>;

      // Unwrap optional and nullable to get to the core type and check for descriptions
      let currentSchema = zodSchema;
      let description = (zodSchema as any).description || '';

      while (currentSchema._def.typeName === 'ZodOptional' || currentSchema._def.typeName === 'ZodNullable') {
        currentSchema = currentSchema.unwrap();
        if (!description) {
          description = (currentSchema as any).description || '';
        }
      }

      // Handle constrained types like booleans and enums to provide clear instructions to the LLM
      let constraint: string | null = null;
      if (currentSchema._def.typeName === 'ZodBoolean') {
        constraint = 'either "true" or "false"';
      } else if (currentSchema._def.typeName === 'ZodEnum') {
        const enumSchema = currentSchema as z.ZodEnum<any>;
        const allowedValues = enumSchema._def.values;
        constraint = `exactly one of these values: ${allowedValues.map(v => `"${v}"`).join(', ')}`;
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

// ### Utility Exports
export const mcp = {
  server: (config: Omit<MCPServer, "name"> & { name: string }): MCPServer => config,
};

export const tool = {
  // Placeholder for future tool utility functions
};
