// src/loop/agent.ts
// Agentic loop — iterates LLM + tools until desired outcomes are achieved with confidence
import { z } from "zod";
import { measure } from "measure-fn";
import { objToXml, xmlToObj } from "../xml";
import { callLLM } from "../inference";
import { fetchWithPayment } from "../payments";
import type {
    LoopAgentConfig,
    LoopEvent,
    LoopMessage,
    LoopState,
    LoopTool,
    ToolInvocation,
    OutcomeConfidence,
    ToolResult,
} from "./types";
import { createDefaultTools } from "./tools";

export class LoopAgent {
    private config: Required<
        Pick<LoopAgentConfig, "llm" | "outcomes" | "maxIterations" | "confidenceThreshold" | "temperature" | "maxTokens" | "cwd" | "toolTimeoutMs">
    > & LoopAgentConfig;
    private tools: Map<string, LoopTool>;

    constructor(config: LoopAgentConfig) {
        this.config = {
            ...config,
            maxIterations: config.maxIterations ?? 20,
            confidenceThreshold: config.confidenceThreshold ?? 0.9,
            temperature: config.temperature ?? 0.3,
            maxTokens: config.maxTokens ?? 8000,
            cwd: config.cwd ?? process.cwd(),
            toolTimeoutMs: config.toolTimeoutMs ?? 30000,
        };

        // Build tool registry
        this.tools = new Map();

        if (config.includeDefaultTools !== false) {
            for (const tool of createDefaultTools(this.config.cwd, this.config.toolTimeoutMs)) {
                this.tools.set(tool.name, tool);
            }
        }

        if (config.tools) {
            for (const tool of config.tools) {
                this.tools.set(tool.name, tool);
            }
        }
    }

    /**
     * Run the agentic loop. Returns an async generator that yields LoopEvents.
     * The final event will be of type "complete" or "max_iterations_reached" or "error".
     * 
     * Usage:
     * ```ts
     * const agent = new LoopAgent({ ... });
     * for await (const event of agent.run("create a hello world script")) {
     *   console.log(event);
     * }
     * ```
     */
    async *run(userPrompt: string): AsyncGenerator<LoopEvent> {
        const startTime = Date.now();

        const state: LoopState = {
            messages: [],
            iteration: 0,
            toolHistory: [],
            touchedFiles: new Set(),
            latestConfidence: [],
            responseFields: {},
        };

        // Build the system prompt
        const systemMessage = this.buildSystemPrompt();
        state.messages.push({ role: "system", content: systemMessage, timestamp: Date.now() });

        // Add user prompt
        state.messages.push({ role: "user", content: userPrompt, timestamp: Date.now() });

        for (let i = 0; i < this.config.maxIterations; i++) {
            state.iteration = i;

            yield { type: "iteration_start", iteration: i, totalElapsedMs: Date.now() - startTime };

            try {
                // Call LLM with full conversation history
                const llmResponse = await measure.assert(`Iteration ${i}`, async (m) => {
                    const messages = state.messages.map(msg => ({
                        role: msg.role === "tool" ? "user" : msg.role,
                        content: msg.content,
                    }));

                    return await callLLM(
                        this.config.llm as any,
                        messages,
                        { temperature: this.config.temperature, maxTokens: this.config.maxTokens },
                        m,
                        undefined,
                        undefined,
                        (url, options, _mFn, desc, pcb) => fetchWithPayment(url, options, desc, pcb)
                    );
                });

                if (!llmResponse) {
                    yield { type: "error", iteration: i, error: "LLM returned empty response" };
                    state.messages.push({
                        role: "user",
                        content: `LLM returned empty response in iteration ${i}. Try again.`,
                        timestamp: Date.now(),
                    });
                    continue;
                }

                // Add assistant message to history
                state.messages.push({ role: "assistant", content: llmResponse, timestamp: Date.now() });

                // Parse the structured response
                const parsed = this.parseResponse(llmResponse);

                // Extract confidence
                const confidence = parsed.confidence || [];
                state.latestConfidence = confidence;

                yield {
                    type: "llm_response",
                    iteration: i,
                    message: parsed.message || "",
                    confidence,
                };

                // Emit intermediate message if present
                if (parsed.message) {
                    yield { type: "intermediate_message", iteration: i, message: parsed.message };
                }

                // Extract response fields
                if (parsed.response_fields) {
                    state.responseFields = { ...state.responseFields, ...parsed.response_fields };
                }

                // Check if there are tool invocations
                const toolInvocations: ToolInvocation[] = parsed.tool_invocations || [];

                if (toolInvocations.length === 0) {
                    // No tools — check if all outcomes are met  
                    const allMet = await this.checkOutcomes(state, confidence);

                    yield { type: "outcome_check", iteration: i, outcomes: allMet };

                    if (allMet.every(o => o.met)) {
                        yield {
                            type: "complete",
                            iteration: i,
                            result: state.responseFields,
                            totalElapsedMs: Date.now() - startTime,
                        };
                        return;
                    }

                    // Not met yet — add feedback and continue
                    const feedback = allMet
                        .filter(o => !o.met)
                        .map(o => `- "${o.outcome}": NOT MET (confidence: ${(o.confidence * 100).toFixed(0)}%) — ${o.reasoning}`)
                        .join("\n");

                    state.messages.push({
                        role: "user",
                        content: `The following outcomes are NOT yet met. Continue working:\n${feedback}\n\nUse the available tools to make progress toward these outcomes.`,
                        timestamp: Date.now(),
                    });
                } else {
                    // Execute tools
                    const toolMessages: string[] = [];

                    for (const invocation of toolInvocations) {
                        const tool = this.tools.get(invocation.tool);
                        if (!tool) {
                            const errMsg = `Unknown tool: "${invocation.tool}". Available: ${[...this.tools.keys()].join(", ")}`;
                            toolMessages.push(`[${invocation.tool}] ERROR: ${errMsg}`);
                            yield { type: "tool_result", iteration: i, tool: invocation.tool, result: { success: false, output: "", error: errMsg } };
                            continue;
                        }

                        yield { type: "tool_start", iteration: i, tool: invocation.tool, params: invocation.params };

                        // Execute the tool — measured
                        const result = await measure(
                            `Tool: ${invocation.tool}`,
                            () => tool.execute(invocation.params)
                        ) as ToolResult;

                        state.toolHistory.push({
                            iteration: i,
                            tool: invocation.tool,
                            params: invocation.params,
                            result,
                        });

                        // Track touched files
                        if (invocation.params.path) {
                            state.touchedFiles.add(invocation.params.path);
                        }

                        yield { type: "tool_result", iteration: i, tool: invocation.tool, result };

                        const statusEmoji = result.success ? "✓" : "✗";
                        toolMessages.push(
                            `[${invocation.tool}] ${statusEmoji}\n${result.output}${result.error ? `\nERROR: ${result.error}` : ""}`
                        );
                    }

                    // Add tool results back to conversation
                    state.messages.push({
                        role: "tool",
                        content: `Tool results from iteration ${i}:\n\n${toolMessages.join("\n\n")}`,
                        toolName: toolInvocations.map(t => t.tool).join(", "),
                        timestamp: Date.now(),
                    });

                    // Also check outcomes after tools — allows early completion
                    // without needing an extra LLM round-trip
                    const postToolCheck = await this.checkOutcomes(state, confidence);
                    yield { type: "outcome_check", iteration: i, outcomes: postToolCheck };

                    if (postToolCheck.every(o => o.met)) {
                        yield {
                            type: "complete",
                            iteration: i,
                            result: state.responseFields,
                            totalElapsedMs: Date.now() - startTime,
                        };
                        return;
                    }
                }
            } catch (error: any) {
                yield { type: "error", iteration: i, error: error.message || String(error) };

                // Add error to conversation so the agent can recover
                state.messages.push({
                    role: "user",
                    content: `An error occurred in iteration ${i}: ${error.message}. Try to recover and continue.`,
                    timestamp: Date.now(),
                });
            }
        }

        // Exhausted max iterations
        yield { type: "max_iterations_reached", iteration: this.config.maxIterations };
    }

    /**
     * Convenience: run and collect only the final result (blocking).
     */
    async execute(userPrompt: string, onEvent?: (event: LoopEvent) => void): Promise<{
        success: boolean;
        result: Record<string, any>;
        iterations: number;
        elapsedMs: number;
    }> {
        let finalResult: Record<string, any> = {};
        let success = false;
        let iterations = 0;
        let elapsedMs = 0;

        for await (const event of this.run(userPrompt)) {
            onEvent?.(event);

            if (event.type === "complete") {
                finalResult = event.result;
                success = true;
                iterations = event.iteration + 1;
                elapsedMs = event.totalElapsedMs;
            } else if (event.type === "max_iterations_reached") {
                iterations = event.iteration;
            } else if (event.type === "error") {
                iterations = event.iteration + 1;
            }
        }

        return { success, result: finalResult, iterations, elapsedMs };
    }

    // ============================================
    // Internal
    // ============================================

    private buildSystemPrompt(): string {
        const toolDescriptions = [...this.tools.values()]
            .map(t => {
                const paramDesc = Object.entries(t.parameters.shape)
                    .map(([name, schema]) => {
                        const desc = (schema as any)?.description || "";
                        const typeName = (schema as any)?._def?.typeName || "string";
                        return `    - ${name} (${typeName.replace("Zod", "").toLowerCase()}): ${desc}`;
                    })
                    .join("\n");
                return `  ${t.name}: ${t.description}\n    Parameters:\n${paramDesc}`;
            })
            .join("\n\n");

        const outcomeDescriptions = this.config.outcomes
            .map((o, i) => `  ${i + 1}. ${o.description}`)
            .join("\n");

        const outputFieldsDesc = this.config.outputSchema
            ? "\n\nOutput Fields (include in your <response_fields> when done):\n" +
            Object.entries(this.config.outputSchema.shape)
                .map(([key, schema]) => {
                    const desc = (schema as any)?.description || "";
                    return `  - ${key}: ${desc}`;
                })
                .join("\n")
            : "";

        const customSystem = this.config.systemPrompt ? `\n\n${this.config.systemPrompt}` : "";

        return `You are an autonomous agent that iteratively works toward desired outcomes using available tools.
You operate in a loop: each turn, you analyze the current state, execute tools if needed, and assess your confidence.

AVAILABLE TOOLS:
${toolDescriptions}

DESIRED OUTCOMES:
${outcomeDescriptions}
${outputFieldsDesc}${customSystem}

RESPONSE FORMAT:
You MUST respond in XML format with the following structure:

<response>
  <message>Brief description of what you're doing this iteration and your thought process</message>
  <confidence>
    <outcome>
      <description>The outcome description</description>
      <confidence>0.0 to 1.0</confidence>
      <reasoning>Why you believe this confidence level</reasoning>
      <met>true or false</met>
    </outcome>
  </confidence>
  <tool_invocations>
    <invocation>
      <tool>tool_name</tool>
      <params>
        <param_name>param_value</param_name>
      </params>
      <reasoning>Why this tool call is needed</reasoning>
    </invocation>
  </tool_invocations>
  <response_fields>
    <field_name>field_value</field_name>
  </response_fields>
</response>

RULES:
1. Assess confidence for EACH desired outcome at EVERY turn
2. If all outcomes have confidence >= ${this.config.confidenceThreshold} and met=true, do NOT invoke any tools — just return the final response
3. If outcomes are not met, invoke tools to make progress
4. You can invoke multiple tools per turn
5. Be precise with file paths and command syntax
6. Learn from tool errors — if a tool fails, adjust your approach
7. Keep messages concise but informative
8. When writing code, ensure it is correct and complete — do not use placeholders`;
    }

    private parseResponse(raw: string): {
        message: string;
        confidence: OutcomeConfidence[];
        tool_invocations: ToolInvocation[];
        response_fields: Record<string, any>;
    } {
        try {
            const parsed = xmlToObj(raw);
            const root = parsed.response || parsed;

            // Parse confidence
            const confidence: OutcomeConfidence[] = [];
            const confSection = root.confidence;
            if (confSection) {
                const outcomes = confSection.outcome
                    ? (Array.isArray(confSection.outcome) ? confSection.outcome : [confSection.outcome])
                    : [];
                for (const o of outcomes) {
                    confidence.push({
                        outcome: String(o.description || ""),
                        confidence: Number(o.confidence) || 0,
                        reasoning: String(o.reasoning || ""),
                        met: o.met === true || o.met === "true",
                    });
                }
            }

            // Parse tool invocations
            const toolInvocations: ToolInvocation[] = [];
            const toolSection = root.tool_invocations;
            if (toolSection) {
                const invocations = toolSection.invocation
                    ? (Array.isArray(toolSection.invocation) ? toolSection.invocation : [toolSection.invocation])
                    : [];
                for (const inv of invocations) {
                    const params: Record<string, any> = {};
                    if (inv.params && typeof inv.params === "object") {
                        for (const [k, v] of Object.entries(inv.params)) {
                            params[k] = v;
                        }
                    }
                    toolInvocations.push({
                        tool: String(inv.tool || ""),
                        params,
                        reasoning: String(inv.reasoning || ""),
                    });
                }
            }

            // Parse response fields
            const responseFields: Record<string, any> = {};
            if (root.response_fields && typeof root.response_fields === "object") {
                Object.assign(responseFields, root.response_fields);
            }

            return {
                message: String(root.message || ""),
                confidence,
                tool_invocations: toolInvocations,
                response_fields: responseFields,
            };
        } catch (e) {
            // Fallback: treat the entire response as a message with no tools
            return {
                message: raw.substring(0, 500),
                confidence: [],
                tool_invocations: [],
                response_fields: {},
            };
        }
    }

    private async checkOutcomes(state: LoopState, llmConfidence: OutcomeConfidence[]): Promise<OutcomeConfidence[]> {
        const results: OutcomeConfidence[] = [];

        for (const outcome of this.config.outcomes) {
            // Find matching LLM confidence
            const llmMatch = llmConfidence.find(c =>
                c.outcome === outcome.description ||
                c.outcome.includes(outcome.description.substring(0, 30))
            );

            let met = llmMatch?.met ?? false;
            let confidence = llmMatch?.confidence ?? 0;
            let reasoning = llmMatch?.reasoning ?? "No LLM assessment available";

            // If there's a programmatic validator, use it too
            if (outcome.validate) {
                try {
                    const validationResult = await outcome.validate(state);
                    if (validationResult.met) {
                        // Validator confirms — trust it, raise confidence
                        met = true;
                        confidence = Math.max(confidence, 1.0);
                        reasoning = `Validator: ${validationResult.reason}`;
                    } else {
                        // Validator says not met — override LLM
                        met = false;
                        reasoning = `Validator: ${validationResult.reason}. LLM: ${reasoning}`;
                        confidence = Math.min(confidence, 0.3);
                    }
                } catch (e: any) {
                    met = false;
                    reasoning = `Validator error: ${e.message}. LLM: ${reasoning}`;
                    confidence = 0;
                }
            }

            // Apply threshold
            if (confidence < this.config.confidenceThreshold) {
                met = false;
            }

            results.push({
                outcome: outcome.description,
                confidence,
                reasoning,
                met,
            });
        }

        return results;
    }
}
