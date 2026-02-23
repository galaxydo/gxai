// smart-agent/src/session.ts
// Multi-turn chat session — planner adjusts objectives per message, executor runs them
import { measure, measureSync } from "measure-fn"
import type {
    AgentConfig,
    AgentEvent,
    Message,
    PlannedObjective,
} from "./types"
import { Agent } from "./agent"
import { callLLM } from "./llm"
import { hydrateObjective, PLANNER_SYSTEM_PROMPT } from "./objectives"

/** Session event — extends AgentEvent with session-level events */
export type SessionEvent =
    | AgentEvent
    | { type: "session_start"; sessionId: string }
    | { type: "replanning"; message: string }

/**
 * A multi-turn chat session. Each user message goes through a pipeline:
 * 
 * 1. **Planner** receives the full conversation so far and generates/adjusts objectives
 * 2. **Executor** runs Agent.run() with the current objectives
 * 3. Results are accumulated in the session history
 * 
 * ```ts
 * const session = new Session({ model: "gemini-3-flash-preview" })
 * 
 * for await (const event of session.send("create a hello world project")) {
 *   console.log(event.type)
 * }
 * 
 * // Follow-up — planner adjusts objectives based on previous context
 * for await (const event of session.send("now add unit tests")) {
 *   console.log(event.type)
 * }
 * ```
 */
export class Session {
    readonly id: string
    private config: AgentConfig
    private history: Message[] = []
    private plannerHistory: Array<{ role: string; content: string }> = []
    private currentObjectives: PlannedObjective[] = []
    private turnCount = 0

    constructor(config: AgentConfig) {
        this.id = randomId()
        this.config = config

        // Initialize planner with system prompt
        this.plannerHistory = [
            { role: "system", content: PLANNER_SYSTEM_PROMPT + REFINEMENT_ADDENDUM },
        ]
    }

    /**
     * Send a message to the session. The planner will generate or adjust
     * objectives, then the executor will run.
     */
    async *send(message: string): AsyncGenerator<SessionEvent> {
        this.turnCount++
        const turn = this.turnCount

        // Track in user message history
        this.history.push({ role: "user", content: message })

        // ── Stage 1: Planner — generate or adjust objectives ──
        yield { type: "replanning", message }

        // Build planner context with previous objectives if any
        const plannerUserMsg = this.currentObjectives.length > 0
            ? `Previous objectives:\n${JSON.stringify(this.currentObjectives, null, 2)}\n\nNew user message: "${message}"\n\nGenerate updated objectives. Keep objectives that are still relevant, remove completed ones, and add new ones as needed.`
            : message

        this.plannerHistory.push({ role: "user", content: plannerUserMsg })

        const plannerResponse = await measure(`Planner (turn ${turn})`, () =>
            callLLM(this.config.model, this.plannerHistory, {
                temperature: this.config.temperature ?? 0.3,
                maxTokens: this.config.maxTokens ?? 4000,
            })
        )

        // Parse objectives
        const planned = measureSync(`Parse objectives (turn ${turn})`, () => {
            let json = (plannerResponse || "").trim()
            if (json.startsWith("```")) {
                json = json.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "")
            }
            const parsed: PlannedObjective[] = JSON.parse(json)
            if (!Array.isArray(parsed) || parsed.length === 0) {
                throw new Error("Empty objectives")
            }
            return parsed
        })

        if (!planned) {
            yield {
                type: "error",
                iteration: -1,
                error: `Planner failed to parse objectives.\nRaw: ${(plannerResponse || "").substring(0, 300)}`,
            }
            return
        }

        // Store planner response in history for future refinement
        this.plannerHistory.push({ role: "assistant", content: plannerResponse || "" })
        this.currentObjectives = planned

        // Emit planning event
        yield { type: "planning", objectives: planned }

        // ── Stage 2: Executor — run with generated objectives ──
        const cwd = this.config.cwd ?? process.cwd()
        const objectives = measureSync(`Hydrate objectives (turn ${turn})`, () =>
            planned.map(p => hydrateObjective(p, cwd))
        )!

        const agent = new Agent({
            ...this.config,
            objectives,
        })

        // Pass full conversation history to executor
        const executorInput: Message[] = this.history.map(m => ({
            role: m.role,
            content: m.content,
        }))

        for await (const event of agent.run(executorInput)) {
            yield event

            // Track completion in history
            if (event.type === "complete") {
                this.history.push({
                    role: "assistant",
                    content: `Completed objectives: ${planned.map(p => p.name).join(", ")}`,
                })
            }
        }
    }

    /** Get the current session history */
    getHistory(): readonly Message[] {
        return this.history
    }

    /** Get current planned objectives */
    getObjectives(): readonly PlannedObjective[] {
        return this.currentObjectives
    }
}

function randomId(): string {
    return Math.random().toString(36).substring(2, 10)
}

/** Addendum to planner system prompt for refinement mode */
const REFINEMENT_ADDENDUM = `

REFINEMENT MODE:
When you receive "Previous objectives" + a new message, you must:
1. Keep objectives that are still relevant and not yet met
2. Remove objectives that have been completed or are no longer needed
3. Add new objectives based on the new message
4. Adjust existing objectives if the user wants changes

Always respond with the COMPLETE updated list of objectives (not just changes).`
