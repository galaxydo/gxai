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
import { callLLM } from "./llm"
import { loadSkills, formatSkillsForPrompt } from "./skills"
import { objToXml, xmlToObj } from "./xml"
import { hydrateObjective, PLANNER_SYSTEM_PROMPT } from "./objectives"

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
    async *run(input: string | Message[]): AsyncGenerator<AgentEvent> {
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

        yield* this.executeLoop(state, startTime)
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

    private async *executeLoop(state: AgentState, startTime: number): AsyncGenerator<AgentEvent> {
        for (let i = 0; i < this.config.maxIterations; i++) {
            state.iteration = i
            yield { type: "iteration_start", iteration: i, elapsed: Date.now() - startTime }

            try {
                // ── Call LLM ──
                const llmResponse = await measure(`Iteration ${i}`, () =>
                    callLLM(
                        this.config.model,
                        state.messages.map(m => ({
                            role: m.role === "tool" ? "user" : m.role,
                            content: m.content,
                        })),
                        { temperature: this.config.temperature, maxTokens: this.config.maxTokens },
                    )
                )

                if (!llmResponse) {
                    yield { type: "error", iteration: i, error: "LLM returned empty response" }
                    state.messages.push({ role: "user", content: "Empty response. Try again." })
                    continue
                }

                state.messages.push({ role: "assistant", content: llmResponse })

                // ── Parse structured XML response ──
                const parsed = measureSync('Parse XML response', () => this.parseResponse(llmResponse))!

                if (parsed.message) {
                    yield { type: "thinking", iteration: i, message: parsed.message }
                }

                // ── Execute tools ──
                const invocations: ToolInvocation[] = parsed.tool_invocations || []

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

    // ── Internal ──

    private buildSystemPrompt(): string {
        return measureSync('Build system prompt', () => this.buildSystemPromptInner())!
    }

    private buildSystemPromptInner(): string {
        const toolDescriptions = [...this.tools.values()]
            .map(t => {
                const params = Object.entries(t.parameters)
                    .map(([name, p]) => `    - ${name} (${p.type}${p.required ? ", required" : ""}): ${p.description}`)
                    .join("\n")
                return `  ${t.name}: ${t.description}\n    Parameters:\n${params}`
            })
            .join("\n\n")

        const objectiveList = this.objectives
            .map((o, i) => `  ${i + 1}. [${o.name}] ${o.description}`)
            .join("\n")

        const custom = this.config.systemPrompt ? `\n\n${this.config.systemPrompt}` : ""

        return `You are an autonomous agent that works toward objectives using tools.
You operate in a loop: analyze state → invoke tools → repeat until all objectives are met.

AVAILABLE TOOLS:
${toolDescriptions}
${this.skillsPrompt}

OBJECTIVES (all must be met to complete):
${objectiveList}
${custom}

RESPONSE FORMAT (XML):
<response>
  <message>What you're doing and why</message>
  <tool_invocations>
    <invocation>
      <tool>tool_name</tool>
      <params>
        <param_name>value</param_name>
      </params>
      <reasoning>Why this tool call</reasoning>
    </invocation>
  </tool_invocations>
</response>

RULES:
1. Use available tools to make progress toward ALL objectives
2. You can invoke multiple tools per turn
3. Be precise with file paths and command syntax
4. Learn from tool errors — adjust your approach
5. When writing code, ensure it is correct and complete
6. Keep messages concise but informative`
    }

    private parseResponse(raw: string): {
        message: string
        tool_invocations: ToolInvocation[]
    } {
        try {
            const parsed = xmlToObj(raw)
            const root = parsed.response || parsed

            // Parse tool invocations
            const toolInvocations: ToolInvocation[] = []
            const toolSection = root.tool_invocations
            if (toolSection) {
                const invocations = toolSection.invocation
                    ? (Array.isArray(toolSection.invocation) ? toolSection.invocation : [toolSection.invocation])
                    : []
                for (const inv of invocations) {
                    const params: Record<string, any> = {}
                    if (inv.params && typeof inv.params === "object") {
                        for (const [k, v] of Object.entries(inv.params)) {
                            params[k] = v
                        }
                    }
                    toolInvocations.push({
                        tool: String(inv.tool || ""),
                        params,
                        reasoning: String(inv.reasoning || ""),
                    })
                }
            }

            return {
                message: String(root.message || ""),
                tool_invocations: toolInvocations,
            }
        } catch {
            return { message: raw.substring(0, 500), tool_invocations: [] }
        }
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
