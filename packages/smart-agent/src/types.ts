// smart-agent/src/types.ts
// All type definitions for the smart-agent package

/** A built-in tool the agent can invoke */
export interface Tool {
    name: string
    description: string
    parameters: Record<string, { type: string; description: string; required?: boolean }>
    execute: (params: Record<string, any>) => Promise<ToolResult>
}

/** Result from a tool execution */
export interface ToolResult {
    success: boolean
    output: string
    error?: string
}

/** A skill — loaded from YAML, describes CLI commands the agent can use via exec */
export interface Skill {
    name: string
    description: string
    commands: SkillCommand[]
}

/** A single command within a skill */
export interface SkillCommand {
    name: string
    description: string
    usage: string
    params?: Record<string, string>
}

/** An objective the agent must achieve */
export interface Objective {
    /** Identifier */
    name: string
    /** Human-readable description — injected into the system prompt */
    description: string
    /** Validator function — runs after each LLM turn to check if met */
    validate: (state: AgentState) => Promise<ObjectiveResult> | ObjectiveResult
}

/** Result of an objective validation */
export interface ObjectiveResult {
    met: boolean
    reason: string
}

/** Accumulated state across iterations */
export interface AgentState {
    /** All messages exchanged */
    messages: Message[]
    /** Current iteration number (0-based) */
    iteration: number
    /** All tool invocations and their results */
    toolHistory: ToolHistoryEntry[]
    /** Files that have been created/modified */
    touchedFiles: Set<string>
}

/** A tool invocation record */
export interface ToolHistoryEntry {
    iteration: number
    tool: string
    params: Record<string, any>
    result: ToolResult
}

/** A single message in the conversation */
export interface Message {
    role: "system" | "user" | "assistant" | "tool"
    content: string
    timestamp: number
}

/** Tool invocation parsed from LLM response */
export interface ToolInvocation {
    tool: string
    params: Record<string, any>
    reasoning: string
}

/** Agent configuration */
export interface AgentConfig {
    /** LLM model identifier (e.g. "gemini-2.0-flash", "gpt-4o-mini") */
    model: string
    /** Skills — either file paths to YAML or inline Skill objects */
    skills?: (string | Skill)[]
    /** Objectives the agent must achieve */
    objectives: Objective[]
    /** Maximum loop iterations. Default: 20 */
    maxIterations?: number
    /** LLM temperature. Default: 0.3 */
    temperature?: number
    /** Max tokens per LLM call. Default: 8000 */
    maxTokens?: number
    /** Working directory for file/exec tools. Default: process.cwd() */
    cwd?: string
    /** Timeout per tool execution in ms. Default: 30000 */
    toolTimeoutMs?: number
    /** Additional system prompt text */
    systemPrompt?: string
    /** Custom tools to add alongside the 4 built-in ones */
    tools?: Tool[]
}

/** Events emitted during the agent loop */
export type AgentEvent =
    | { type: "iteration_start"; iteration: number; elapsed: number }
    | { type: "thinking"; iteration: number; message: string }
    | { type: "tool_start"; iteration: number; tool: string; params: Record<string, any> }
    | { type: "tool_result"; iteration: number; tool: string; result: ToolResult }
    | { type: "objective_check"; iteration: number; results: Array<{ name: string; met: boolean; reason: string }> }
    | { type: "complete"; iteration: number; elapsed: number }
    | { type: "error"; iteration: number; error: string }
    | { type: "max_iterations"; iteration: number }
