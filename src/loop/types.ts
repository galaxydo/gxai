// src/loop/types.ts
import { z } from "zod";


// ============================================
// Built-in Tool Definitions
// ============================================

/** A tool that the loop agent can invoke */
export interface LoopTool {
    name: string;
    description: string;
    parameters: z.ZodObject<any>;
    execute: (params: any) => Promise<ToolResult>;
}

/** Result from a tool execution */
export interface ToolResult {
    success: boolean;
    output: string;
    error?: string;
}

/** Tool invocation requested by the LLM */
export interface ToolInvocation {
    tool: string;
    params: Record<string, any>;
    reasoning: string;
}

// ============================================
// Desired Outcomes
// ============================================

/** A desired outcome that the agent should achieve */
export interface DesiredOutcome {
    /** Human-readable description of the outcome */
    description: string;
    /** 
     * Optional validator — called with the full loop state to check if the outcome is met.
     * If provided, the agent uses this + LLM confidence. If not, LLM confidence alone decides.
     */
    validate?: (state: LoopState) => Promise<{ met: boolean; reason: string }>;
}

/** Confidence assessment for a single outcome */
export interface OutcomeConfidence {
    outcome: string;
    confidence: number; // 0.0 - 1.0
    reasoning: string;
    met: boolean;
}

// ============================================
// Loop State & Events
// ============================================

/** A single message in the loop conversation */
export interface LoopMessage {
    role: "system" | "user" | "assistant" | "tool";
    content: string;
    /** Which tool produced this message (for role=tool) */
    toolName?: string;
    timestamp: number;
}

/** Accumulated state across iterations */
export interface LoopState {
    /** All messages exchanged */
    messages: LoopMessage[];
    /** Current iteration number (0-based) */
    iteration: number;
    /** All tool invocations and their results */
    toolHistory: Array<{
        iteration: number;
        tool: string;
        params: Record<string, any>;
        result: ToolResult;
    }>;
    /** Files that have been created/modified */
    touchedFiles: Set<string>;
    /** Outcome confidence from latest iteration */
    latestConfidence: OutcomeConfidence[];
    /** Final response fields (populated when done) */
    responseFields: Record<string, any>;
}

/** Events emitted during the loop */
export type LoopEvent =
    | { type: "iteration_start"; iteration: number; totalElapsedMs: number }
    | { type: "llm_response"; iteration: number; message: string; confidence: OutcomeConfidence[] }
    | { type: "tool_start"; iteration: number; tool: string; params: Record<string, any> }
    | { type: "tool_result"; iteration: number; tool: string; result: ToolResult }
    | { type: "intermediate_message"; iteration: number; message: string }
    | { type: "outcome_check"; iteration: number; outcomes: OutcomeConfidence[] }
    | { type: "complete"; iteration: number; result: Record<string, any>; totalElapsedMs: number }
    | { type: "max_iterations_reached"; iteration: number }
    | { type: "error"; iteration: number; error: string };

// ============================================
// Loop Agent Configuration
// ============================================

export interface LoopAgentConfig {
    /** LLM model identifier (e.g. "gemini-2.0-flash", "gpt-4o-mini") */
    llm: string;

    /** System prompt — establishes the agent's role and behavior */
    systemPrompt?: string;

    /** Desired outcomes the agent must achieve */
    outcomes: DesiredOutcome[];

    /** Optional output schema for structured response fields (besides outcomes) */
    outputSchema?: z.ZodObject<any>;

    /** Custom tools to use instead of / in addition to defaults */
    tools?: LoopTool[];

    /** Whether to include the 4 default tools (read_file, write_file, edit_file, exec). Default: true */
    includeDefaultTools?: boolean;

    /** Maximum loop iterations. Default: 20 */
    maxIterations?: number;

    /** Minimum confidence threshold (0-1) for ALL outcomes to consider the task done. Default: 0.9 */
    confidenceThreshold?: number;

    /** LLM temperature. Default: 0.3 (lower for more deterministic tool use) */
    temperature?: number;

    /** Max tokens per LLM call. Default: 8000 */
    maxTokens?: number;

    /** Working directory for file/exec tools. Default: process.cwd() */
    cwd?: string;

    /** Timeout per tool execution in ms. Default: 30000 */
    toolTimeoutMs?: number;

    /** Optional name for logging/analytics */
    name?: string;
}
