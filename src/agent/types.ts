/**
 * Agent Configuration Types
 */

import { z } from 'zod';
import type { LLMType } from '../llm/types';
import type { MCPServer } from '../mcp/types';

/**
 * Configuration for creating an Agent
 */
export interface AgentConfig<I extends z.ZodObject<any>, O extends z.ZodObject<any>> {
    /** The LLM model to use */
    llm: LLMType;

    /** Zod schema for input validation */
    inputFormat: I;

    /** Zod schema for output validation */
    outputFormat: O;

    /** MCP servers to connect to for tool discovery */
    servers?: MCPServer[];

    /** System prompt for the LLM */
    systemPrompt?: string;

    /** Temperature for LLM generation (0-1) */
    temperature?: number;

    /** Maximum tokens for LLM response */
    maxTokens?: number;

    /** Solana wallet configuration for 402 payments */
    solanaWallet?: {
        privateKey: string;
        rpcUrl?: string;
    };
}

/**
 * Result from an agent run
 */
export type AgentResult<O extends z.ZodObject<any>> = z.infer<O>;
