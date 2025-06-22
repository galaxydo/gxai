import { z } from 'zod';

// Measure context and logging
export type MeasureContext = {
  requestId?: string;
  level?: number;
  parentAction?: string;
};

export async function measure<T>(
  fn: (measure: typeof measure) => Promise<T>,
  action: string,
  context: MeasureContext = {}
): Promise<T> {
  const start = performance.now();
  const level = context.level || 0;
  const indent = "=".repeat(level > 0 ? level + 1 : 0);
  const requestId = context.requestId;
  const logPrefixStart = requestId ? `[${requestId}] ${indent}>` : `${indent}>`;
  const logPrefixEnd = requestId ? `[${requestId}] ${indent}<` : `${indent}<`;

  try {
    console.log(`${logPrefixStart} ${action}...`);
    const result = await fn((nestedFn, nestedAction) =>
      measure(nestedFn, nestedAction, {
        requestId,
        level: level + 1,
        parentAction: action,
      })
    );
    const duration = performance.now() - start;
    console.log(`${logPrefixEnd} ${action} ✓ ${duration.toFixed(2)}ms`);
    return result;
  } catch (error) {
    const duration = performance.now() - start;
    console.log('=========================== ERROR ===========================');
    console.log(`${logPrefixEnd} ${action} ✗ ${duration.toFixed(2)}ms`);
    if (error instanceof Error) {
      console.error(`Error in action "${action}":`, error.message);
      if (error.stack) console.error(error.stack);
    } else {
      console.error(`Unknown error in action "${action}":`, error);
    }
    console.log('=============================================================');
    throw error;
  }
}

// Generate unique request ID
function generateRequestId(): string {
  return Math.random().toString(36).substring(2, 10);
}

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
  // Enhanced XML parser based on satios-ai implementation
  const parseElement = (content: string, currentSchema?: z.ZodType<any>): any => {
    content = content.trim();
    
    // If no XML tags, return as string value
    if (!content.includes('<')) {
      return content || '';
    }

    const result: any = {};
    
    // Improved regex that handles nested tags properly
    const tagRegex = /<([^>\s/]+)(?:[^>]*)>(.*?)<\/\1>/gs;
    let match;
    let hasMatches = false;

    tagRegex.lastIndex = 0;

    while ((match = tagRegex.exec(content)) !== null) {
      hasMatches = true;
      const [, tagName, tagContent] = match;
      // Handle nested content vs simple values
      
      if (tagContent.trim().includes('<')) {
        result[tagName] = parseElement(tagContent, currentSchema);
      } else {
        // Convert simple values based on context
        const trimmedContent = tagContent.trim();

        // Try to parse numbers and booleans
        if (trimmedContent === 'true' || trimmedContent === 'false') {
          result[tagName] = trimmedContent === 'true';
        } else if (/^\d+(\.\d+)?$/.test(trimmedContent)) {
          result[tagName] = Number(trimmedContent);
        } else {
          result[tagName] = trimmedContent;
        }
      }
    }

    // If no matches found, try alternative parsing
    if (!hasMatches) {
      console.warn('No XML matches found, returning content as-is:', content.substring(0, 100));
      return content;
    }

    return result;
  };

  return parseElement(xmlContent);
}

// Helper function to convert type based on schema
function convertValue(value: string, fieldSchema?: z.ZodType<any>): any {
  if (!fieldSchema) return value;

  // Get base type by unwrapping optional/nullable
  let baseSchema = fieldSchema;
  while (baseSchema._def.typeName === 'ZodOptional' || baseSchema._def.typeName === 'ZodNullable') {
    baseSchema = baseSchema.unwrap();
  }

  try {
    switch (baseSchema._def.typeName) {
      case 'ZodNumber':
        const cleanNum = value.replace(/[^\d.-]/g, '');
        const num = Number(cleanNum);
        if (isNaN(num)) throw new Error(`Invalid number: ${value}`);
        return num;
      case 'ZodBoolean':
        return value.toLowerCase() === 'true';
      case 'ZodString':
      default:
        return value.trim();
    }
  } catch (err) {
    console.warn(`Type conversion failed for value: ${value}`, err);
    return value; // Return original value if conversion fails
  }
}
// Helper to get schema type name
function getSchemaTypeName(schema: z.ZodType<any>): string {
  if (schema._def.typeName === 'ZodOptional' || schema._def.typeName === 'ZodNullable') {
    return getSchemaTypeName(schema.unwrap());
  }
  return schema._def.typeName;
}


// LLM API calls with measurement
async function callLLM(
  llm: LLMType,
  messages: Array<{ role: string; content: string }>,
  options: { temperature?: number; maxTokens?: number } = {},
  measureFn?: typeof measure
): Promise<string> {
  const executeCall = async (measure: typeof measure) => {
    const { temperature = 0.7, maxTokens = 4000 } = options;
    
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    let url = "";
    let body: Record<string, any> = {};

    return await measure(async () => {
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
    }, `HTTP ${llm} API call`);
  };

  if (measureFn) {
    return await measureFn(executeCall, `LLM call to ${llm}`);
  } else {
    return await measure(executeCall, `LLM call to ${llm}`);
  }
}

// MCP Server communication with measurement
async function discoverTools(server: MCPServer, measureFn?: typeof measure): Promise<MCPTool[]> {
  const executeDiscovery = async (measure: typeof measure) => {
    return await measure(async () => {
      const response = await fetch(`${server.url}/tools`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      
      if (!response.ok) {
        console.warn(`Failed to discover tools from ${server.name}: ${response.statusText}`);
        return [];
      }
      
      const tools = await response.json();
      console.log(`Discovered ${tools.length} tools from ${server.name}`);
      return tools;
    }, `HTTP GET ${server.url}/tools`);
  };

  try {
    if (measureFn) {
      return await measureFn(executeDiscovery, `Discover tools from ${server.name}`);
    } else {
      return await measure(executeDiscovery, `Discover tools from ${server.name}`);
    }
  } catch (error) {
    console.warn(`Error discovering tools from ${server.name}:`, error);
    return [];
  }
}

async function invokeTool(server: MCPServer, toolName: string, parameters: any, measureFn?: typeof measure): Promise<any> {
  const executeInvocation = async (measure: typeof measure) => {
    return await measure(async () => {
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

      const result = await response.json();
      console.log(`Tool ${toolName} returned:`, typeof result === 'object' ? JSON.stringify(result).substring(0, 100) + '...' : result);
      return result;
    }, `HTTP POST ${server.url}/call (${toolName})`);
  };

  if (measureFn) {
    return await measureFn(executeInvocation, `Invoke ${server.name}.${toolName}`);
  } else {
    return await measure(executeInvocation, `Invoke ${server.name}.${toolName}`);
  }
}

// Main Agent class
export class Agent<I extends z.ZodObject<any>, O extends z.ZodObject<any>> {
  private config: AgentConfig<I, O>;

  constructor(config: AgentConfig<I, O>) {
    this.config = config;
  }

  async run(input: z.infer<I>, progressCallback?: ProgressCallback): Promise<z.infer<O>> {
    const requestId = generateRequestId();
    
    return await measure(async (measure) => {
      // Step 1: Validate input
      const validatedInput = await measure(async () => {
        return this.config.inputFormat.parse(input);
      }, 'Validate input schema');
      
      // Step 2: Determine relevant servers (if any)
      let relevantServers: MCPServer[] = [];
      if (this.config.servers && this.config.servers.length > 0) {
        progressCallback?.({
          stage: 'server_selection',
          message: 'Analyzing input to determine relevant servers...',
        });

        relevantServers = await measure(async (measure) => {
          return await this.selectRelevantServers(validatedInput, measure);
        }, 'Select relevant MCP servers');
        
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

        await measure(async (measure) => {
          for (const server of relevantServers) {
            const tools = await discoverTools(server, measure);
            
            if (tools.length > 0) {
              const relevantTools = await measure(async (measure) => {
                return await this.selectRelevantTools(validatedInput, tools, server, measure);
              }, `Select relevant tools from ${server.name}`);
              
              for (const tool of relevantTools) {
                progressCallback?.({
                  stage: 'tool_invocation',
                  message: `Invoking ${server.name}.${tool.name}...`,
                });

                try {
                  await measure(async (measure) => {
                    const parameters = await measure(async (measure) => {
                      return await this.generateToolParameters(validatedInput, tool, measure);
                    }, `Generate parameters for ${tool.name}`);
                    
                    const result = await invokeTool(server, tool.name, parameters, measure);
                    toolResults[`${server.name}.${tool.name}`] = result;
                  }, `Execute ${server.name}.${tool.name}`);
                } catch (error) {
                  console.warn(`Failed to invoke ${server.name}.${tool.name}:`, error);
                }
              }
            }
          }
        }, 'Discover and invoke tools');
      }

      // Step 4: Generate final response
      progressCallback?.({
        stage: 'response_generation',
        message: 'Generating final response...',
      });

      try {
        const response = await measure(async (measure) => {
          return await this.generateResponse(validatedInput, toolResults, measure);
        }, 'Generate AI response');
        
        // Validate and return output
        return await measure(async () => {
          return this.config.outputFormat.parse(response);
        }, 'Validate output schema');
      } catch (validationError) {
        console.error('Output validation failed:', validationError);
        
        // Try to create a minimal valid response as fallback
        const fallbackResponse = await measure(async () => {
          return this.createFallbackResponse(validatedInput);
        }, 'Generate fallback response');
        
        console.log('Using fallback response:', fallbackResponse);
        
        return await measure(async () => {
          return this.config.outputFormat.parse(fallbackResponse);
        }, 'Validate fallback response');
      }
    }, `Agent.run for ${this.config.llm}`, { requestId });
  }

  private createFallbackResponse(input: any): any {
    const shape = this.config.outputFormat.shape;
    const fallback: any = {};
    
    for (const [key, schema] of Object.entries(shape)) {
      const zodSchema = schema as z.ZodType<any>;
      const typeName = getSchemaTypeName(zodSchema);
      
      if (typeName === 'ZodString') {
        if (key.toLowerCase().includes('response')) {
          fallback[key] = `I understand your request about: ${JSON.stringify(input)}. I'm working on improving my response format.`;
        } else if (key.toLowerCase().includes('thinking') || key.toLowerCase().includes('comment')) {
          fallback[key] = 'Processing your request and generating appropriate response.';
        } else {
          fallback[key] = 'Generated content';
        }
      } else if (typeName === 'ZodArray') {
        fallback[key] = [];
      } else if (typeName === 'ZodObject') {
        fallback[key] = {};
      } else if (typeName === 'ZodNumber') {
        fallback[key] = 0;
      } else if (typeName === 'ZodBoolean') {
        fallback[key] = false;
      } else {
        fallback[key] = 'Fallback value';
      }
    }
    
    return fallback;
  }

  private async selectRelevantServers(input: any, measureFn: typeof measure): Promise<MCPServer[]> {
    if (!this.config.servers || this.config.servers.length === 0) {
      return [];
    }

    return await measureFn(async (measure) => {
      const systemPrompt = `You are analyzing user input to determine which servers might be relevant to fulfill the request. 
      Select only servers that are likely needed based on the input content.`;

      const userPrompt = await measure(async () => {
        return objToXml({
          input: input,
          available_servers: this.config.servers!.map(s => ({
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
      }, 'Generate server selection prompt');

      const response = await callLLM(
        this.config.llm,
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `<request>${userPrompt}</request>` }
        ],
        { temperature: 0.3 },
        measure
      );

      return await measure(async () => {
        try {
          const parsed = xmlToObj(response);
          const serverNames = parsed.relevant_servers?.server_names || [];
          
          const selectedServers = this.config.servers!.filter(server => 
            Array.isArray(serverNames) 
              ? serverNames.includes(server.name)
              : serverNames === server.name
          );
          
          console.log(`Selected ${selectedServers.length}/${this.config.servers!.length} servers:`, selectedServers.map(s => s.name));
          return selectedServers;
        } catch (error) {
          console.warn('Failed to parse server selection response, using all servers:', error);
          return this.config.servers!;
        }
      }, 'Parse server selection response');
    }, 'Select relevant servers');
  }

  private async selectRelevantTools(input: any, tools: MCPTool[], server: MCPServer, measureFn: typeof measure): Promise<MCPTool[]> {
    if (tools.length === 0) return [];

    return await measureFn(async (measure) => {
      const systemPrompt = `You are selecting which tools from a server should be used to fulfill a user request.
      Select only tools that are necessary for the given input.`;

      const userPrompt = await measure(async () => {
        return objToXml({
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
      }, 'Generate tool selection prompt');

      const response = await callLLM(
        this.config.llm,
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `<request>${userPrompt}</request>` }
        ],
        { temperature: 0.3 },
        measure
      );

      return await measure(async () => {
        try {
          const parsed = xmlToObj(response);
          const toolNames = parsed.selected_tools?.tool_names || [];
          
          const selectedTools = tools.filter(tool => 
            Array.isArray(toolNames)
              ? toolNames.includes(tool.name)
              : toolNames === tool.name
          );
          
          console.log(`Selected ${selectedTools.length}/${tools.length} tools from ${server.name}:`, selectedTools.map(t => t.name));
          return selectedTools;
        } catch (error) {
          console.warn('Failed to parse tool selection response, using first tool:', error);
          return tools.slice(0, 1);
        }
      }, 'Parse tool selection response');
    }, `Select relevant tools from ${server.name}`);
  }

  private async generateToolParameters(input: any, tool: MCPTool, measureFn: typeof measure): Promise<any> {
    return await measureFn(async (measure) => {
      const systemPrompt = `You are generating parameters for a tool invocation based on user input and tool specification.
      Generate appropriate parameters that match the tool's input schema.`;

      const userPrompt = await measure(async () => {
        return objToXml({
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
      }, 'Generate parameter generation prompt');

      const response = await callLLM(
        this.config.llm,
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `<request>${userPrompt}</request>` }
        ],
        { temperature: 0.3 },
        measure
      );

      return await measure(async () => {
        try {
          const parsed = xmlToObj(response);
          const parameters = parsed.parameters || {};
          console.log(`Generated parameters for ${tool.name}:`, JSON.stringify(parameters).substring(0, 100) + '...');
          return parameters;
        } catch (error) {
          console.warn('Failed to parse tool parameters response:', error);
          return {};
        }
      }, 'Parse tool parameters response');
    }, `Generate parameters for ${tool.name}`);
  }

  private async generateResponse(input: any, toolResults: Record<string, any>, measureFn: typeof measure): Promise<any> {
    return await measureFn(async (measure) => {
      const systemPrompt = this.config.systemPrompt || 
        `You are an AI assistant that provides helpful responses based on user input and available context.
        Generate responses that match the specified output format exactly.
        
        IMPORTANT: Format your response as XML with the exact field names specified in the output format.
        For example, if the output format requires 'correctResponse' and 'thinkingComments', format like:
        <correctResponse>Your main response here</correctResponse>
        <thinkingComments>Your thinking process here</thinkingComments>`;

      const userPrompt = await measure(async () => {
        return objToXml({
          input: input,
          context: {
            tool_results: toolResults,
          },
          output_format: this.getOutputFormatDescription(),
          task: "Generate a response matching the output format exactly, using XML tags for each field"
        });
      }, 'Generate response prompt');

      const response = await callLLM(
        this.config.llm,
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `<request>${userPrompt}</request>` }
        ],
        { 
          temperature: this.config.temperature || 0.7,
          maxTokens: this.config.maxTokens || 4000,
        },
        measure
      );

      console.log('LLM Response:', response.substring(0, 500) + '...');
      
      const parsed = await measure(async () => {
        return xmlToObj(response);
      }, 'Parse LLM response XML');
      
      console.log('Parsed XML:', parsed);
      
      // Ensure we have the required fields by creating fallbacks
      return await measure(async () => {
        const shape = this.config.outputFormat.shape;
        const result: any = {};
        // First, try to extract fields directly from parsed object
        
        for (const [key, schema] of Object.entries(shape)) {
          if (parsed[key] !== undefined) {
            result[key] = parsed[key];
          } else if (parsed.response && typeof parsed.response === 'object' && parsed.response[key] !== undefined) {
            // Handle case where fields are nested under 'response'
            result[key] = parsed.response[key];
          } else if (parsed[Object.keys(parsed)[0]] && typeof parsed[Object.keys(parsed)[0]] === 'object') {
            // Handle case where fields are nested under first key
            const firstKey = Object.keys(parsed)[0];
            const nestedObj = parsed[firstKey];
            if (nestedObj[key] !== undefined) {
              result[key] = nestedObj[key];
            } else {
              result[key] = this.createFallbackForField(key, schema, parsed, response);
            }
          } else {
            result[key] = this.createFallbackForField(key, schema, parsed, response);
          }
        }

        console.log('Final result before validation:', result);
        return result;
      }, 'Build structured response object');
    }, 'Generate AI response');
  }

  private createFallbackForField(key: string, schema: z.ZodType<any>, parsed: any, response: string): any {
    const typeName = getSchemaTypeName(schema);
            
    if (typeName === 'ZodString') {
      // Try to find relevant content in parsed object or response
      if (key.toLowerCase().includes('response') || key.toLowerCase().includes('message')) {
        return Object.values(parsed).find(v => typeof v === 'string' && v.length > 10) ||
               response.substring(0, 200) || 'Response generated';
      } else if (key.toLowerCase().includes('thinking') || key.toLowerCase().includes('comment')) {
        return 'Processing your request and generating appropriate response.';
      } else {
        return 'Generated content';
      }
    } else if (typeName === 'ZodArray') {
      return [];
    } else if (typeName === 'ZodObject') {
      return {};
    } else if (typeName === 'ZodNumber') {
      return 0;
    } else if (typeName === 'ZodBoolean') {
      return false;
    } else {
      return 'Fallback value';
    }
  }

  private getOutputFormatDescription(): any {
    const shape = this.config.outputFormat.shape;
    const description: any = {};
    
    for (const [key, schema] of Object.entries(shape)) {
      const zodSchema = schema as z.ZodType<any>;
      description[key] = {
        type: getSchemaTypeName(zodSchema),
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