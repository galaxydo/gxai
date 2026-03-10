// src/types.ts
import { z } from "zod";
import type { ToolAuthorizer } from "./tool-auth";
import { readFileSync } from "fs";
import { extname } from "path";

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
  /** Direct native execution hook (bypasses MCP transport when used in localTools) */
  execute?: (params: any) => Promise<any>;
}

export interface AgentConfig<I extends z.ZodObject<any>, O extends z.ZodObject<any>> {
  name?: string;
  llm: LLMType;
  inputFormat: I;
  outputFormat: O;
  servers?: MCPServer[];
  /** Array of fully-implemented native JS/TS tools that bypass the remote MCP transport layer */
  localTools?: MCPTool[];
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  solanaWallet?: { privateKey: string; rpcUrl?: string; allowedRecipients?: string[] };
  analyticsUrl?: string;
  /** Maximum estimated cost in USD per run. If estimateCost() exceeds this, run() throws before executing. */
  maxCostUSD?: number;
  /** Maximum duration in milliseconds for run(). If exceeded, throws TimeoutError. */
  maxDurationMs?: number;
  /** Optional conversation memory for multi-turn interactions */
  memory?: any;
  /** Optional session manager for persisting memory + state across process restarts.
   * When provided, Agent auto-restores memory on first run and auto-saves after each run.
   * Use with memory for full multi-turn persistence:
   * ```ts
   * const agent = new Agent({
   *   memory: new ConversationMemory(),
   *   session: new SessionManager({ storageKey: 'my-agent' }),
   *   ...
   * });
   * ```
   */
  session?: any;
  /** Response caching config — when set, identical inputs return cached LLM responses */
  cacheConfig?: { ttlMs?: number; maxEntries?: number };
  /** Output validation hooks — run on raw LLM output before schema parsing. Throw to reject. */
  outputValidators?: OutputValidator[];
  /** Tool authorization mechanism to globally whitelist/blacklist tools */
  toolAuth?: ToolAuthorizer;
}

/** Validator function that receives raw LLM output. Throw an error to reject. */
export type OutputValidator = (rawOutput: string, input: any) => void | Promise<void>;

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

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface LLMResult {
  content: string;
  usage?: TokenUsage;
}

export type ProgressCallback = (update: ProgressUpdate) => void;
export type StreamingCallback = (update: StreamingUpdate) => void;

// --- Vision / Image Input ---

/** Image content for multimodal messages */
export interface ImageContent {
  /** Base64-encoded image data (without the data: prefix) */
  data?: string;
  /** URL of the image (used directly for OpenAI, fetched+encoded for others) */
  url?: string;
  /** MIME type (auto-detected if not provided) */
  mimeType?: string;
}

/** Message type supporting both text and multimodal content */
export interface LLMMessage {
  role: string;
  content: string;
  cacheControl?: boolean;
  /** Optional images for vision models (GPT-4o, Gemini, Claude) */
  images?: ImageContent[];
}

/** Create an ImageContent from a URL */
export function imageFromUrl(url: string, mimeType?: string): ImageContent {
  return { url, mimeType };
}

/** Create an ImageContent from base64-encoded data */
export function imageFromBase64(data: string, mimeType: string = 'image/png'): ImageContent {
  return { data, mimeType };
}

/** Create an ImageContent from a local file path */
export function imageFromFile(filePath: string): ImageContent {
  const ext = extname(filePath).toLowerCase();
  const mimeMap: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
  };
  const mimeType = mimeMap[ext] || 'image/png';
  const data = readFileSync(filePath).toString('base64');
  return { data, mimeType };
}

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
