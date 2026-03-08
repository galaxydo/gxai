// src/types.ts
import { z } from "zod";

export const LLM = {
  "gpt-4o-mini": "gpt-4o-mini",
  gpt4o: "gpt-4o",
  gpt4: "gpt-4",
  claude: "claude-3-sonnet-20240229",
  claude35Sonnet: "claude-3-5-sonnet-20240620",
  claude35SonnetLatest: "claude-3-5-sonnet-20241022",
  deepseek: "deepseek-chat",
  "gemini-2.0-flash": "gemini-2.0-flash",
  "gemini-2.5-pro": "gemini-2.5-pro-preview-05-06",
  "gemini-3-flash-preview": "gemini-2.0-flash",
} as const;

export type LLMType = typeof LLM[keyof typeof LLM];

export interface MCPServer {
  name: string;
  description: string;
  url: string;
  /** Optional overrides for discovered tools (e.g., injecting auth hooks) */
  tools?: Record<string, Partial<MCPTool>>;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: any;
  /** Optional async hook to intercept and authorize tool execution before it happens */
  authorize?: (params: any) => Promise<boolean | string>;
}

export interface AgentConfig<I extends z.ZodObject<any>, O extends z.ZodObject<any>> {
  name?: string;
  llm: LLMType;
  inputFormat: I;
  outputFormat: O;
  servers?: MCPServer[];
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  solanaWallet?: { privateKey: string; rpcUrl?: string; allowedRecipients?: string[] };
  analyticsUrl?: string;
}

export interface ProgressUpdate {
  stage: "server_selection" | "tool_discovery" | "tool_invocation" | "response_generation" | "streaming" | "input_resolution" | "payment";
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

// --- LLM helpers (merged from src/llm/types.ts) ---

export function isGeminiModel(llm: LLMType | string): boolean {
  return llm.toString().startsWith('gemini');
}

export function getLLMBaseUrl(llm: LLMType | string): string {
  if (llm.startsWith('gpt') || llm.startsWith('o4-')) return 'https://api.openai.com/v1/chat/completions';
  if (llm.startsWith('claude')) return 'https://api.anthropic.com/v1/messages';
  if (llm === 'deepseek-chat') return 'https://api.deepseek.com/v1/chat/completions';
  if (llm.startsWith('gemini')) {
    return `https://generativelanguage.googleapis.com/v1beta/models/${llm}:generateContent`;
  }
  throw new Error(`Unknown LLM provider for: ${llm}`);
}

export function getLLMApiKey(llm: LLMType | string): string {
  if (llm.startsWith('gpt') || llm.startsWith('o4-')) {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error('OPENAI_API_KEY not set');
    return key;
  }
  if (llm.startsWith('claude')) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('ANTHROPIC_API_KEY not set');
    return key;
  }
  if (llm === 'deepseek-chat') {
    const key = process.env.DEEPSEEK_API_KEY;
    if (!key) throw new Error('DEEPSEEK_API_KEY not set');
    return key;
  }
  if (llm.startsWith('gemini')) {
    const key = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    if (!key) throw new Error('GOOGLE_API_KEY or GEMINI_API_KEY not set');
    return key;
  }
  throw new Error(`Unknown LLM provider for: ${llm}`);
}

// --- MCP helper ---

export const mcp = {
  server: (config: MCPServer): MCPServer => config,
};
