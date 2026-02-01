// src/types.ts
import { z } from "zod";

export const LLM = {
  "gpt-4o-mini": "gpt-4o-mini",
  gpt4o: "gpt-4o",
  gpt4: "gpt-4",
  claude: "claude-3-sonnet-20240229",
  deepseek: "deepseek-chat",
} as const;

export type LLMType = typeof LLM[keyof typeof LLM];

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

export interface AgentConfig<I extends z.ZodObject<any>, O extends z.ZodObject<any>> {
  /** Name of the agent for identification in analytics */
  name?: string;
  llm: LLMType;
  inputFormat: I;
  outputFormat: O;
  servers?: MCPServer[];
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  solanaWallet?: { privateKey: string; rpcUrl?: string };
  /** URL to send analytics data to (e.g., http://localhost:3002/api/record) */
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
