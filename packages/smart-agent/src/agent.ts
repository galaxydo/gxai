// smart-agent/src/agent.ts
// Core agentic loop — iterates LLM + tools until all objectives pass
import { measure, measureSync } from "measure-fn"
import type {
    AgentConfig,
    AgentEvent,
    AgentState,
    Message,
    Objective,
    ObjectiveResult,
    PlannedObjective,
    Tool,
    ToolInvocation,
    ToolResult,
} from "./types"
import { createBuiltinTools } from "./tools"
import { callLLM, streamLLM } from "./llm"
import { loadSkills, formatSkillsForPrompt } from "./skills"
import { hydrateObjective, PLANNER_SYSTEM_PROMPT } from "./objectives"

// jsx-ai — strategy-agnostic LLM caller with native tool support
import { callLLM as jsxCallLLM } from "../../jsx-ai/src/index"
import { jsx, Fragment } from "../../jsx-ai/src/jsx-runtime"
import type { LLMResponse } from "../../jsx-ai/src/types"

export class Agent {
    private config: Required<Pick<AgentConfig, "model" | "maxIterations" | "temperature" | "maxTokens" | "cwd" | "toolTimeoutMs">> & AgentConfig
    private objectives: Objective[]
    private tools: Map<string, Tool>
    private skillsPrompt: string = ""
    private initialized = false

    constructor(config: AgentConfig) {
        this.objectives = config.objectives || []

        this.config = {
            ...config,
            maxIterations: config.maxIterations ?? 20,
            temperature: config.temperature ?? 0.3,
            maxTokens: config.maxTokens ?? 8000,
            cwd: config.cwd ?? process.cwd(),
            toolTimeoutMs: config.toolTimeoutMs ?? 30000,
        }

        // Register built-in tools + custom tools
        this.tools = new Map()
        for (const tool of createBuiltinTools(this.config.cwd, this.config.toolTimeoutMs)) {
            this.tools.set(tool.name, tool)
        }
        if (config.tools) {
            for (const tool of config.tools) {
                this.tools.set(tool.name, tool)
            }
        }
    }

    /** Lazily load skills (only once) */
    private async ensureInitialized(): Promise<void> {
        if (this.initialized) return
        this.initialized = true

        if (this.config.skills && this.config.skills.length > 0) {
            await measure('Load skills', async () => {
                const skills = await loadSkills(this.config.skills!)
                this.skillsPrompt = formatSkillsForPrompt(skills)
            })
        }
    }

    /**
     * Run the agentic loop with predefined objectives.
     * 
     * Accepts a simple string prompt OR a message array for conversation history:
     * ```ts
     * // Simple prompt
     * for await (const event of agent.run("fix the tests")) {}
     * 
     * // Conversation history
     * for await (const event of agent.run([
     *   { role: "user", content: "fix the auth tests" },
     *   { role: "assistant", content: "I'll look at the test files..." },
     *   { role: "user", content: "focus on login.test.ts" },
     * ])) {}
     * ```
     */
    async *run(input: string | Message[], signal?: AbortSignal): AsyncGenerator<AgentEvent> {
        if (this.objectives.length === 0) {
            throw new Error("No objectives defined. Use Agent.plan() for dynamic objective generation, or pass objectives in the constructor.")
        }

        await this.ensureInitialized()
        const startTime = Date.now()

        const state: AgentState = {
            messages: [],
            iteration: 0,
            toolHistory: [],
            touchedFiles: new Set(),
        }

        // System prompt as first message
        state.messages.push({
            role: "system",
            content: this.buildSystemPrompt(),
        })

        // User input — string or message array
        if (typeof input === "string") {
            state.messages.push({ role: "user", content: input })
        } else {
            // Append conversation history after system prompt
            for (const msg of input) {
                if (msg.role === "system") continue // skip — we already have our system prompt
                state.messages.push({ role: msg.role, content: msg.content })
            }
        }

        yield* this.executeLoop(state, startTime, signal)
    }

    /**
     * Plan + execute: dynamically generate objectives from a user prompt, then run.
     * 
     * Uses a planner LLM call to analyze the user's request and create
     * verifiable objectives, then executes the agent with those objectives.
     * 
     * ```ts
     * for await (const event of Agent.plan("make the auth tests pass", {
     *   model: "gemini-3-flash-preview",
     *   skills: ["./skills/bun.yaml"],
     * })) {
     *   console.log(event.type)
     * }
     * ```
     */
    static async *plan(input: string | Message[], config: AgentConfig): AsyncGenerator<AgentEvent> {
        const cwd = config.cwd ?? process.cwd()

        // Extract the user's actual prompt
        const userPrompt = typeof input === "string"
            ? input
            : input.filter(m => m.role === "user").map(m => m.content).join("\n")

        // ── Stage 1: Planner — generate objectives ──
        const plannerMessages: Array<{ role: string; content: string }> = [
            { role: "system", content: PLANNER_SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
        ]

        const plannerResponse = await measure("Planner", () =>
            callLLM(config.model, plannerMessages, {
                temperature: config.temperature ?? 0.3,
                maxTokens: config.maxTokens ?? 4000,
            })
        )

        // Parse the planner's JSON response
        let planned: PlannedObjective[]
        try {
            // Strip markdown code fences if present
            let json = (plannerResponse || "").trim()
            if (json.startsWith("```")) {
                json = json.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "")
            }
            planned = JSON.parse(json)
            if (!Array.isArray(planned) || planned.length === 0) {
                throw new Error("Planner returned empty objectives")
            }
        } catch (e: any) {
            yield { type: "error", iteration: -1, error: `Planner failed to generate objectives: ${e.message}\nRaw: ${(plannerResponse || "").substring(0, 300)}` }
            return
        }

        // Hydrate planned objectives into real Objective objects
        const objectives = planned.map(p => hydrateObjective(p, cwd))

        // Emit planning event so consumers know what's being worked on
        yield { type: "planning", objectives: planned }

        // ── Stage 2: Worker — execute with generated objectives ──
        const agent = new Agent({
            ...config,
            objectives,
        })

        yield* agent.run(input)
    }

    // ── Core loop (shared by run + plan) ──

    private async *executeLoop(state: AgentState, startTime: number, signal?: AbortSignal): AsyncGenerator<AgentEvent> {
        for (let i = 0; i < this.config.maxIterations; i++) {
            // Check abort before each iteration
            if (signal?.aborted) {
                yield { type: "cancelled", iteration: i, elapsed: Date.now() - startTime }
                return
            }

            state.iteration = i
            yield { type: "iteration_start", iteration: i, elapsed: Date.now() - startTime }

            try {
                // ── Call LLM via jsx-ai (strategy-agnostic) ──
                const llmResult = await measure(`LLM ${this.config.model}`, () =>
                    this.callWithJsxAi(state.messages)
                ) as LLMResponse

                if (!llmResult) {
                    yield { type: "error", iteration: i, error: "LLM returned empty response" }
                    state.messages.push({ role: "user", content: "Empty response. Try again." })
                    continue
                }

                // Store assistant message (text or summary of tool calls)
                const assistantContent = llmResult.text ||
                    (llmResult.toolCalls.length > 0
                        ? llmResult.toolCalls.map(tc => `${tc.name}(${JSON.stringify(tc.args)})`).join(", ")
                        : "(empty)")
                state.messages.push({ role: "assistant", content: assistantContent })

                if (llmResult.text) {
                    yield { type: "thinking", iteration: i, message: llmResult.text }
                }

                // ── Execute tool calls (from jsx-ai's structured response) ──
                const invocations: ToolInvocation[] = llmResult.toolCalls.map(tc => ({
                    tool: tc.name,
                    params: tc.args,
                    reasoning: "",
                }))

                if (invocations.length > 0) {
                    const toolMessages: string[] = []

                    for (const inv of invocations) {
                        const tool = this.tools.get(inv.tool)
                        if (!tool) {
                            const err = `Unknown tool: "${inv.tool}". Available: ${[...this.tools.keys()].join(", ")}`
                            toolMessages.push(`[${inv.tool}] ERROR: ${err}`)
                            yield { type: "tool_result", iteration: i, tool: inv.tool, result: { success: false, output: "", error: err } }
                            continue
                        }

                        yield { type: "tool_start", iteration: i, tool: inv.tool, params: inv.params }

                        const result = await measure(`Tool: ${inv.tool}`, () => tool.execute(inv.params)) as ToolResult

                        state.toolHistory.push({ iteration: i, tool: inv.tool, params: inv.params, result })

                        if (inv.params.path) {
                            state.touchedFiles.add(inv.params.path)
                        }

                        yield { type: "tool_result", iteration: i, tool: inv.tool, result }

                        const icon = result.success ? "✓" : "✗"
                        toolMessages.push(`[${inv.tool}] ${icon}\n${result.output}${result.error ? `\nERROR: ${result.error}` : ""}`)
                    }

                    state.messages.push({
                        role: "tool",
                        content: `Tool results:\n\n${toolMessages.join("\n\n")}`,
                    })
                }

                // ── Check objectives ──
                const objectiveResults = await measure('Check objectives', () => this.checkObjectives(state)) as Array<{ name: string; met: boolean; reason: string }>
                yield { type: "objective_check", iteration: i, results: objectiveResults as Array<{ name: string; met: boolean; reason: string }> }

                const allMet = objectiveResults.every(o => o.met)

                if (allMet) {
                    yield { type: "complete", iteration: i, elapsed: Date.now() - startTime }
                    return
                }

                // Not all met — add feedback for next iteration
                if (invocations.length === 0) {
                    const feedback = objectiveResults
                        .filter(o => !o.met)
                        .map(o => `- "${o.name}": NOT MET — ${o.reason}`)
                        .join("\n")

                    state.messages.push({
                        role: "user",
                        content: `The following objectives are NOT met yet. Use tools to make progress:\n${feedback}`,
                    })
                }

            } catch (error: any) {
                yield { type: "error", iteration: i, error: error.message || String(error) }
                state.messages.push({
                    role: "user",
                    content: `Error in iteration ${i}: ${error.message}. Recover and continue.`,
                })
            }
        }

        yield { type: "max_iterations", iteration: this.config.maxIterations }
    }

    // ── jsx-ai integration ──

    /**
     * Build a JSX tree and call the LLM via jsx-ai.
     * jsx-ai picks the best strategy automatically (hybrid for Gemini).
     * The agent doesn't care whether tools are sent as XML, natural language, or native FC.
     */
    private async callWithJsxAi(messages: Message[]): Promise<LLMResponse> {
        const h = jsx

        // Build tool nodes from registered tools
        const toolNodes = [...this.tools.values()].map(t =>
            h("tool", {
                name: t.name,
                description: t.description,
                children: Object.entries(t.parameters).map(([name, p]) =>
                    h("param", {
                        name,
                        type: p.type,
                        required: p.required,
                        children: p.description,
                    })
                ),
            })
        )

        // Build message nodes from conversation history
        const messageNodes = messages.map(m => {
            if (m.role === "system") {
                return h("system", { children: m.content })
            }
            return h("message", {
                role: m.role === "tool" ? "user" : m.role as "user" | "assistant",
                children: m.content,
            })
        })

        // Assemble the prompt tree
        const tree = h("prompt", {
            model: this.config.model,
            temperature: this.config.temperature,
            maxTokens: this.config.maxTokens,
            children: [
                ...messageNodes,
                ...toolNodes,
            ],
        })

        return await jsxCallLLM(tree)
    }

    // ── Internal ──

    private buildSystemPrompt(): string {
        return measureSync('Build system prompt', () => this.buildSystemPromptInner())!
    }

    private buildSystemPromptInner(): string {
        const objectiveList = this.objectives
            .map((o, i) => `  ${i + 1}. [${o.name}] ${o.description}`)
            .join("\n")

        const custom = this.config.systemPrompt ? `\n\n${this.config.systemPrompt}` : ""

        // Check if all objectives are conversational (respond type)
        const isConversational = this.objectives.every(o =>
            o.name.includes('respond') || o.name.includes('tell') || o.name.includes('explain') || o.name.includes('joke') || o.name.includes('answer')
        )

        const conversationalHint = isConversational
            ? `\n\nNOTE: These objectives are conversational — just provide a helpful response. No tools needed.`
            : ""

        // No more XML format instructions — jsx-ai handles all of that
        return `You are an autonomous agent that works toward objectives using tools.
You operate in a loop: analyze state → invoke tools → repeat until all objectives are met.
${this.skillsPrompt}

OBJECTIVES (all must be met to complete):
${objectiveList}
${conversationalHint}
${custom}

RULES:
1. Use available tools to make progress toward ALL objectives
2. You can invoke multiple tools per turn
3. Be precise with file paths and command syntax
4. Learn from tool errors — NEVER repeat the exact same failing tool call
5. If a tool fails twice, try an alternative approach or explain why it can't be done
6. When writing code, ensure it is correct and complete
7. Keep messages concise but informative
8. If the objective just asks for a response (explanation, joke, advice), just respond — no tools needed
9. On Windows, use PowerShell commands: 'Get-ChildItem' not 'ls', 'Get-Content' not 'cat'
10. If you cannot make progress, explain the blocker — do NOT repeat failed actions`
    }

    private async checkObjectives(state: AgentState): Promise<Array<{ name: string; met: boolean; reason: string }>> {
        const results: Array<{ name: string; met: boolean; reason: string }> = []

        for (const objective of this.objectives) {
            try {
                const result: ObjectiveResult = await objective.validate(state)
                results.push({ name: objective.name, met: result.met, reason: result.reason })
            } catch (e: any) {
                results.push({ name: objective.name, met: false, reason: `Validator error: ${e.message}` })
            }
        }

        return results
    }
}
