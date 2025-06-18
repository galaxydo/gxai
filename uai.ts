import { z } from 'zod';

// LLM enum
export const LLM = {
  gpt4o: 'gpt-4o',
  gpt4: 'gpt-4',
  claude: 'claude-3-sonnet-20240229',
  deepseek: 'deepseek-chat',
} as const;

export type LLMType = typeof LLM[keyof typeof LLM];

// Server configuration for MCP
export interface MCPServer {
  name: string;
  description: string;
  url: string;
}

// Tool definition from MCP server
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: any; // JSON schema for tool parameters
}

// Agent configuration
export interface AgentConfig<I extends z.ZodObject<any>, O extends z.ZodObject<any>> {
  llm: LLMType;
  inputFormat: I;
  outputFormat: O;
  servers?: MCPServer[];
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
}

// Progress callback types
export interface ProgressUpdate {
  stage: 'server_selection' | 'tool_discovery' | 'tool_invocation' | 'response_generation';
  message: string;
  data?: any;
}

export type ProgressCallback = (update: ProgressUpdate) => void;

// XML utilities (adapted from satios-ai)
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
      obj.map((item, index) =>
        wrapTag("item", typeof item === "object" ? objToXml(item) : String(item))
      ).join("")
    );
  }

  if (obj && typeof obj === "object") {
    const entries = Object.entries(obj).filter(([, v]) => v !== undefined && v !== null);
    
    if (entries.length === 0) {
      return wrapTag(parentKey || "empty", "");
    }

    const content = entries
      .map(([key, value]) =>
        typeof value === "object"
          ? objToXml(value, key)
          : `<${key}>${String(value)}</${key}>`
      )
      .join("");

    return parentKey ? wrapTag(parentKey, content) : content;
  }

  return wrapTag(parentKey || "value", String(obj));
}

function xmlToObj(xmlContent: string): any {
  // Simple XML parser for our structured output
  const parseElement = (content: string): any => {
    // Remove wrapper tags if present
    content = content.trim();
    
    // Check if it's a simple value (no nested tags)
    if (!content.includes('<')) {
      return content;
    }

    const result: any = {};
    const tagRegex = /<([^>\/]+)>(.*?)<\/\1>/gs;
    let match;

    while ((match = tagRegex.exec(content)) !== null) {
      const [, tagName, tagContent] = match;
      
      if (tagContent.includes('<')) {
        result[tagName] = parseElement(tagContent);
      } else {
        result[tagName] = tagContent;
      }
    }

    return result;
  };

  return parseElement(xmlContent);
}

// LLM API calls
async function callLLM(
  llm: LLMType,
  messages: Array<{ role: string; content: string }>,
  options: { temperature?: number; maxTokens?: number } = {}
): Promise<string> {
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
    body = { model: llm, max_tokens: maxTokens, messages };
  } else if (llm.includes("deepseek")) {
    headers["Authorization"] = `Bearer ${process.env.DEEPSEEK_API_KEY}`;
    url = "https://api.deepseek.com/v1/chat/completions";
    body = { model: llm, temperature, messages, max_tokens: maxTokens };
  } else {
    // OpenAI models (gpt-4, gpt-4o, etc.)
    headers["Authorization"] = `Bearer ${process.env.OPENAI_API_KEY}`;
    url = "https://api.openai.com/v1/chat/completions";
    body = { model: llm, temperature, messages, max_tokens: maxTokens };
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM API error: ${errorText}`);
  }

  const data = await response.json();
  
  if (llm.includes("claude")) {
    return data.content[0].text;
  } else {
    return data.choices[0].message.content;
  }
}

// MCP Server communication
async function discoverTools(server: MCPServer): Promise<MCPTool[]> {
  try {
    const response = await fetch(`${server.url}/tools`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    
    if (!response.ok) {
      console.warn(`Failed to discover tools from ${server.name}: ${response.statusText}`);
      return [];
    }
    
    return await response.json();
  } catch (error) {
    console.warn(`Error discovering tools from ${server.name}:`, error);
    return [];
  }
}

async function invokeTool(server: MCPServer, toolName: string, parameters: any): Promise<any> {
  const response = await fetch(`${server.url}/call`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      method: toolName,
      params: parameters,
    }),
  });

  if (!response.ok) {
    throw new Error(`Tool invocation failed: ${response.statusText}`);
  }

  return await response.json();
}

// Main Agent class
export class Agent<I extends z.ZodObject<any>, O extends z.ZodObject<any>> {
  private config: AgentConfig<I, O>;

  constructor(config: AgentConfig<I, O>) {
    this.config = config;
  }

  async run(input: z.infer<I>, progressCallback?: ProgressCallback): Promise<z.infer<O>> {
    // Step 1: Validate input
    const validatedInput = this.config.inputFormat.parse(input);
    
    // Step 2: Determine relevant servers (if any)
    let relevantServers: MCPServer[] = [];
    if (this.config.servers && this.config.servers.length > 0) {
      progressCallback?.({
        stage: 'server_selection',
        message: 'Analyzing input to determine relevant servers...',
      });

      relevantServers = await this.selectRelevantServers(validatedInput);
      
      progressCallback?.({
        stage: 'server_selection',
        message: `Selected ${relevantServers.length} relevant servers`,
        data: { servers: relevantServers.map(s => s.name) },
      });
    }

    // Step 3: Discover and invoke tools
    const toolResults: Record<string, any> = {};
    
    if (relevantServers.length > 0) {
      progressCallback?.({
        stage: 'tool_discovery',
        message: 'Discovering available tools...',
      });

      for (const server of relevantServers) {
        const tools = await discoverTools(server);
        
        if (tools.length > 0) {
          const relevantTools = await this.selectRelevantTools(validatedInput, tools, server);
          
          for (const tool of relevantTools) {
            progressCallback?.({
              stage: 'tool_invocation',
              message: `Invoking ${server.name}.${tool.name}...`,
            });

            try {
              const parameters = await this.generateToolParameters(validatedInput, tool);
              const result = await invokeTool(server, tool.name, parameters);
              toolResults[`${server.name}.${tool.name}`] = result;
            } catch (error) {
              console.warn(`Failed to invoke ${server.name}.${tool.name}:`, error);
            }
          }
        }
      }
    }

    // Step 4: Generate final response
    progressCallback?.({
      stage: 'response_generation',
      message: 'Generating final response...',
    });

    const response = await this.generateResponse(validatedInput, toolResults);
    
    return this.config.outputFormat.parse(response);
  }

  private async selectRelevantServers(input: any): Promise<MCPServer[]> {
    if (!this.config.servers || this.config.servers.length === 0) {
      return [];
    }

    const systemPrompt = `You are analyzing user input to determine which servers might be relevant to fulfill the request. 
    Select only servers that are likely needed based on the input content.`;

    const userPrompt = objToXml({
      input: input,
      available_servers: this.config.servers.map(s => ({
        name: s.name,
        description: s.description,
      })),
      task: "Select relevant server names that should be used to fulfill this request",
      response_format: {
        relevant_servers: {
          server_names: "array of server names"
        }
      }
    });

    const response = await callLLM(
      this.config.llm,
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `<request>${userPrompt}</request>` }
      ],
      { temperature: 0.3 }
    );

    try {
      const parsed = xmlToObj(response);
      const serverNames = parsed.relevant_servers?.server_names || [];
      
      return this.config.servers!.filter(server => 
        Array.isArray(serverNames) 
          ? serverNames.includes(server.name)
          : serverNames === server.name
      );
    } catch (error) {
      console.warn('Failed to parse server selection response, using all servers:', error);
      return this.config.servers!;
    }
  }

  private async selectRelevantTools(input: any, tools: MCPTool[], server: MCPServer): Promise<MCPTool[]> {
    if (tools.length === 0) return [];

    const systemPrompt = `You are selecting which tools from a server should be used to fulfill a user request.
    Select only tools that are necessary for the given input.`;

    const userPrompt = objToXml({
      input: input,
      server: server.name,
      available_tools: tools.map(t => ({
        name: t.name,
        description: t.description,
      })),
      task: "Select tool names that should be invoked",
      response_format: {
        selected_tools: {
          tool_names: "array of tool names"
        }
      }
    });

    const response = await callLLM(
      this.config.llm,
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `<request>${userPrompt}</request>` }
      ],
      { temperature: 0.3 }
    );

    try {
      const parsed = xmlToObj(response);
      const toolNames = parsed.selected_tools?.tool_names || [];
      
      return tools.filter(tool => 
        Array.isArray(toolNames)
          ? toolNames.includes(tool.name)
          : toolNames === tool.name
      );
    } catch (error) {
      console.warn('Failed to parse tool selection response, using first tool:', error);
      return tools.slice(0, 1);
    }
  }

  private async generateToolParameters(input: any, tool: MCPTool): Promise<any> {
    const systemPrompt = `You are generating parameters for a tool invocation based on user input and tool specification.
    Generate appropriate parameters that match the tool's input schema.`;

    const userPrompt = objToXml({
      input: input,
      tool: {
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema,
      },
      task: "Generate parameters for this tool",
      response_format: {
        parameters: "object containing the tool parameters"
      }
    });

    const response = await callLLM(
      this.config.llm,
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `<request>${userPrompt}</request>` }
      ],
      { temperature: 0.3 }
    );

    try {
      const parsed = xmlToObj(response);
      return parsed.parameters || {};
    } catch (error) {
      console.warn('Failed to parse tool parameters response:', error);
      return {};
    }
  }

  private async generateResponse(input: any, toolResults: Record<string, any>): Promise<any> {
    const systemPrompt = this.config.systemPrompt || 
      `You are an AI assistant that provides helpful responses based on user input and available context.
      Generate responses that match the specified output format exactly.`;

    const userPrompt = objToXml({
      input: input,
      context: {
        tool_results: toolResults,
      },
      output_format: this.getOutputFormatDescription(),
      task: "Generate a response matching the output format"
    });

    const response = await callLLM(
      this.config.llm,
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `<request>${userPrompt}</request>` }
      ],
      { 
        temperature: this.config.temperature || 0.7,
        maxTokens: this.config.maxTokens || 4000,
      }
    );

    return xmlToObj(response);
  }

  private getOutputFormatDescription(): any {
    const shape = this.config.outputFormat.shape;
    const description: any = {};
    
    for (const [key, schema] of Object.entries(shape)) {
      const zodSchema = schema as z.ZodType<any>;
      description[key] = {
        type: zodSchema._def.typeName,
        description: (zodSchema as any).description || '',
      };
    }
    
    return description;
  }
}

// Utility exports
export const mcp = {
  server: (config: Omit<MCPServer, 'name'> & { name: string }): MCPServer => config,
};

export const tool = {
  // Utility functions for tool management if needed
};