// smart-agent/src/agent.ts
// Core agentic loop — iterates LLM + tools until all objectives pass
import { measure } from "measure-fn"
import type {
    AgentConfig,
    AgentEvent,
    AgentState,
    ObjectiveResult,
    Tool,
    ToolInvocation,
    ToolResult,
} from "./types"
import { createBuiltinTools } from "./tools"
import { callLLM } from "./llm"
import { loadSkills, formatSkillsForPrompt } from "./skills"
import { objToXml, xmlToObj } from "./xml"

export class Agent {
    private config: Required<Pick<AgentConfig, "model" | "objectives" | "maxIterations" | "temperature" | "maxTokens" | "cwd" | "toolTimeoutMs">> & AgentConfig
    private tools: Map<string, Tool>
    private skillsPrompt: string = ""
    private initialized = false

    constructor(config: AgentConfig) {
        if (!config.objectives || config.objectives.length === 0) {
            throw new Error("At least one objective is required")
        }

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
            const skills = await loadSkills(this.config.skills)
            this.skillsPrompt = formatSkillsForPrompt(skills)
        }
    }

    /**
     * Run the agentic loop. Yields AgentEvents as it progresses.
     * 
     * ```ts
     * for await (const event of agent.run("fix the tests")) {
     *   console.log(event.type, event)
     * }
     * ```
     */
    async *run(prompt: string): AsyncGenerator<AgentEvent> {
        await this.ensureInitialized()
        const startTime = Date.now()

        const state: AgentState = {
            messages: [],
            iteration: 0,
            toolHistory: [],
            touchedFiles: new Set(),
        }

        // System prompt
        state.messages.push({
            role: "system",
            content: this.buildSystemPrompt(),
            timestamp: Date.now(),
        })

        // User prompt
        state.messages.push({
            role: "user",
            content: prompt,
            timestamp: Date.now(),
        })

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
                    state.messages.push({ role: "user", content: "Empty response. Try again.", timestamp: Date.now() })
                    continue
                }

                state.messages.push({ role: "assistant", content: llmResponse, timestamp: Date.now() })

                // ── Parse structured XML response ──
                const parsed = this.parseResponse(llmResponse)

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
                        timestamp: Date.now(),
                    })
                }

                // ── Check objectives ──
                const objectiveResults = await this.checkObjectives(state)
                yield { type: "objective_check", iteration: i, results: objectiveResults }

                const allMet = objectiveResults.every(o => o.met)

                if (allMet) {
                    yield { type: "complete", iteration: i, elapsed: Date.now() - startTime }
                    return
                }

                // Not all met — add feedback for next iteration
                if (invocations.length === 0) {
                    // LLM didn't use any tools but objectives aren't met — nudge it
                    const feedback = objectiveResults
                        .filter(o => !o.met)
                        .map(o => `- "${o.name}": NOT MET — ${o.reason}`)
                        .join("\n")

                    state.messages.push({
                        role: "user",
                        content: `The following objectives are NOT met yet. Use tools to make progress:\n${feedback}`,
                        timestamp: Date.now(),
                    })
                }

            } catch (error: any) {
                yield { type: "error", iteration: i, error: error.message || String(error) }
                state.messages.push({
                    role: "user",
                    content: `Error in iteration ${i}: ${error.message}. Recover and continue.`,
                    timestamp: Date.now(),
                })
            }
        }

        yield { type: "max_iterations", iteration: this.config.maxIterations }
    }

    // ── Internal ──

    private buildSystemPrompt(): string {
        const toolDescriptions = [...this.tools.values()]
            .map(t => {
                const params = Object.entries(t.parameters)
                    .map(([name, p]) => `    - ${name} (${p.type}${p.required ? ", required" : ""}): ${p.description}`)
                    .join("\n")
                return `  ${t.name}: ${t.description}\n    Parameters:\n${params}`
            })
            .join("\n\n")

        const objectiveList = this.config.objectives
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

        for (const objective of this.config.objectives) {
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
