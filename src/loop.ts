/**
 * LoopAgent — Self-healing agentic loop
 *
 * Iteratively calls an LLM with tool access (write_file, exec, read_file)
 * and checks user-defined outcome predicates after each iteration.
 * Stops when all outcomes are met or maxIterations is reached.
 *
 * Usage:
 *   const agent = new LoopAgent({ llm, outcomes: [...], maxIterations: 10 })
 *   const result = await agent.execute("Build a script that...", onEvent)
 */
import { callLLM } from './inference';
import type { LLMType } from './types';
import * as fs from 'fs';
import * as path from 'path';

// ─── Types ──────────────────────────────────────────────

export interface LoopOutcome {
    description: string;
    validate: (state: LoopState) => Promise<{ met: boolean; reason: string }>;
}

export interface LoopConfig {
    llm: LLMType | string;
    systemPrompt?: string;
    cwd?: string;
    maxIterations?: number;
    confidenceThreshold?: number;
    temperature?: number;
    maxTokens?: number;
    /** Max recent tool calls to include verbatim in context (older ones are summarized). Default: 20 */
    contextWindow?: number;
    /** Path to auto-save state after each iteration. Enables crash recovery via `LoopAgent.fromCheckpoint()`. */
    checkpointPath?: string;
    outcomes: LoopOutcome[];
}

export interface ToolCall {
    tool: string;
    params: Record<string, any>;
    result?: ToolResult;
}

export interface ToolResult {
    success: boolean;
    output?: string;
    error?: string;
}

export interface LoopState {
    iteration: number;
    toolHistory: ToolCall[];
    outcomeResults: OutcomeResult[];
}

export interface OutcomeResult {
    outcome: string;
    met: boolean;
    confidence: number;
    reason: string;
}

export type LoopEvent =
    | { type: 'iteration_start'; iteration: number }
    | { type: 'tool_start'; tool: string; params: Record<string, any> }
    | { type: 'tool_result'; tool: string; result: ToolResult }
    | { type: 'outcome_check'; outcomes: OutcomeResult[] }
    | { type: 'complete'; iteration: number; totalElapsedMs: number }
    | { type: 'max_iterations_reached'; iteration: number }
    | { type: 'error'; error: string };

export type LoopEventCallback = (event: LoopEvent) => void;

export interface LoopResult {
    success: boolean;
    iterations: number;
    elapsedMs: number;
    state: LoopState;
}

// ─── Built-in Tools ─────────────────────────────────────

function executeWriteFile(params: { path: string; content: string }, cwd: string): ToolResult {
    try {
        const filePath = path.isAbsolute(params.path)
            ? params.path
            : path.resolve(cwd, params.path);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, params.content, 'utf-8');
        return { success: true, output: `Wrote ${params.content.length} bytes to ${filePath}` };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}

function executeReadFile(params: { path: string }, cwd: string): ToolResult {
    try {
        const filePath = path.isAbsolute(params.path)
            ? params.path
            : path.resolve(cwd, params.path);
        if (!fs.existsSync(filePath)) {
            return { success: false, error: `File not found: ${filePath}` };
        }
        const content = fs.readFileSync(filePath, 'utf-8');
        return { success: true, output: content.substring(0, 10000) };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}

async function executeCommand(params: { command: string }, cwd: string): Promise<ToolResult> {
    try {
        const proc = Bun.spawn(['sh', '-c', params.command], {
            cwd,
            stdout: 'pipe',
            stderr: 'pipe',
        });
        const stdout = await new Response(proc.stdout).text();
        const stderr = await new Response(proc.stderr).text();
        const exitCode = await proc.exited;
        const output = (stdout + (stderr ? `\n[stderr] ${stderr}` : '')).substring(0, 10000);
        return {
            success: exitCode === 0,
            output,
            error: exitCode !== 0 ? `Exit code: ${exitCode}` : undefined,
        };
    } catch (e: any) {
        // Fallback for Windows (no sh)
        try {
            const proc = Bun.spawn(['cmd', '/c', params.command], {
                cwd,
                stdout: 'pipe',
                stderr: 'pipe',
            });
            const stdout = await new Response(proc.stdout).text();
            const stderr = await new Response(proc.stderr).text();
            const exitCode = await proc.exited;
            const output = (stdout + (stderr ? `\n[stderr] ${stderr}` : '')).substring(0, 10000);
            return {
                success: exitCode === 0,
                output,
                error: exitCode !== 0 ? `Exit code: ${exitCode}` : undefined,
            };
        } catch (e2: any) {
            return { success: false, error: e2.message };
        }
    }
}

async function executeTool(name: string, params: Record<string, any>, cwd: string): Promise<ToolResult> {
    switch (name) {
        case 'write_file': return executeWriteFile(params as any, cwd);
        case 'read_file': return executeReadFile(params as any, cwd);
        case 'exec': return executeCommand(params as any, cwd);
        default: return { success: false, error: `Unknown tool: ${name}` };
    }
}

// ─── LLM Prompt ─────────────────────────────────────────

const TOOL_DOCS = `You have the following tools:

1. write_file(path, content) — Write content to a file. Creates directories automatically.
2. read_file(path) — Read a file's content.
3. exec(command) — Run a shell command and get stdout/stderr.

To use a tool, respond with a JSON block inside <tool_call> tags:
<tool_call>
{"tool": "write_file", "params": {"path": "output/hello.ts", "content": "console.log('hello')"}}
</tool_call>

You can make multiple tool calls in one response. Each must be in its own <tool_call> block.
After tool results are returned, analyze them and decide if you need more actions.`;

function buildSystemPrompt(config: LoopConfig): string {
    const parts = [
        config.systemPrompt || 'You are a skilled developer. Complete the given task step by step.',
        '',
        TOOL_DOCS,
        '',
        '## Outcomes to achieve:',
        ...config.outcomes.map((o, i) => `${i + 1}. ${o.description}`),
        '',
        'Work iteratively. Use tools to make progress, then check results. Fix any errors you encounter.',
    ];
    return parts.join('\n');
}

/** Compact older tool history into a brief summary to save tokens */
function summarizeHistory(calls: ToolCall[]): string {
    if (calls.length === 0) return '';
    const toolCounts: Record<string, { total: number; success: number; fail: number }> = {};
    for (const call of calls) {
        const key = call.tool;
        if (!toolCounts[key]) toolCounts[key] = { total: 0, success: 0, fail: 0 };
        toolCounts[key].total++;
        if (call.result?.success) toolCounts[key].success++;
        else toolCounts[key].fail++;
    }
    const summary = Object.entries(toolCounts)
        .map(([tool, c]) => `${tool}: ${c.total} calls (${c.success} ok, ${c.fail} failed)`)
        .join(', ');
    return `[Earlier history: ${calls.length} tool calls — ${summary}]`;
}

function buildIterationPrompt(state: LoopState, task: string, contextWindow: number): string {
    const parts = [task];

    if (state.toolHistory.length > 0) {
        const recentStart = Math.max(0, state.toolHistory.length - contextWindow);
        const olderCalls = state.toolHistory.slice(0, recentStart);
        const recentCalls = state.toolHistory.slice(recentStart);

        parts.push('\n\n## Previous tool results:');

        // Compact summary for older history
        if (olderCalls.length > 0) {
            parts.push(summarizeHistory(olderCalls));
        }

        // Verbatim recent calls
        for (const call of recentCalls) {
            parts.push(`\n[${call.tool}] ${JSON.stringify(call.params)}`);
            if (call.result) {
                parts.push(call.result.success
                    ? `✅ ${call.result.output?.substring(0, 300) || 'OK'}`
                    : `❌ ${call.result.error || 'Failed'}`);
            }
        }
    }

    if (state.outcomeResults.length > 0) {
        parts.push('\n\n## Outcome status:');
        for (const o of state.outcomeResults) {
            parts.push(`${o.met ? '✅' : '❌'} ${o.outcome}: ${o.reason}`);
        }
        parts.push('\nFix any unmet outcomes.');
    }

    return parts.join('\n');
}

// ─── Tool Call Parser ───────────────────────────────────

function parseToolCalls(response: string): ToolCall[] {
    const calls: ToolCall[] = [];
    const regex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
    let match;
    while ((match = regex.exec(response)) !== null) {
        try {
            const parsed = JSON.parse(match[1]!);
            if (parsed.tool && parsed.params) {
                calls.push({ tool: parsed.tool, params: parsed.params });
            }
        } catch {
            // Skip malformed tool calls
        }
    }
    return calls;
}

// ─── LoopAgent ──────────────────────────────────────────

export class LoopAgent {
    private config: LoopConfig;
    public state: LoopState;

    constructor(config: LoopConfig, initialState?: LoopState) {
        if (!config.outcomes?.length) {
            throw new Error('LoopAgent requires at least one outcome');
        }
        this.config = {
            maxIterations: 10,
            confidenceThreshold: 0.9,
            temperature: 0.3,
            maxTokens: 8000,
            contextWindow: 20,
            ...config,
        };
        this.state = initialState || {
            iteration: 0,
            toolHistory: [],
            outcomeResults: [],
        };
    }

    public toJSON(): string {
        return JSON.stringify(this.state);
    }

    public static fromJSON(json: string, config: LoopConfig): LoopAgent {
        const state = JSON.parse(json) as LoopState;
        return new LoopAgent(config, state);
    }

    /** Resume from a checkpoint file on disk (created by checkpointPath config) */
    public static fromCheckpoint(checkpointPath: string, config: LoopConfig): LoopAgent | null {
        try {
            if (!fs.existsSync(checkpointPath)) return null;
            const json = fs.readFileSync(checkpointPath, 'utf-8');
            return LoopAgent.fromJSON(json, config);
        } catch {
            return null;
        }
    }

    /** Save current state to checkpoint file */
    private saveCheckpoint(): void {
        if (!this.config.checkpointPath) return;
        try {
            const dir = path.dirname(this.config.checkpointPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(this.config.checkpointPath, this.toJSON(), 'utf-8');
        } catch {
            // Checkpoint write failure is non-fatal
        }
    }

    /** Remove checkpoint file (called on successful completion) */
    private removeCheckpoint(): void {
        if (!this.config.checkpointPath) return;
        try {
            if (fs.existsSync(this.config.checkpointPath)) fs.unlinkSync(this.config.checkpointPath);
        } catch { }
    }

    /**
     * Execute the loop and stream events as Server-Sent Events.
     * Returns a ReadableStream suitable for SSE transport.
     */
    executeAsSSE(task: string): ReadableStream<Uint8Array> {
        const encoder = new TextEncoder();
        const agent = this;

        return new ReadableStream({
            async start(controller) {
                try {
                    await agent.execute(task, (event: LoopEvent) => {
                        const data = `data: ${JSON.stringify(event)}\n\n`;
                        controller.enqueue(encoder.encode(data));
                    });
                    controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                } catch (err: any) {
                    const errorEvent = `data: ${JSON.stringify({ type: 'error', error: err.message })}\n\n`;
                    controller.enqueue(encoder.encode(errorEvent));
                } finally {
                    controller.close();
                }
            }
        });
    }

    /**
     * Convenience: returns a complete Response object with SSE headers.
     * Can be returned directly from an API route handler.
     */
    createSSEResponse(task: string): Response {
        return new Response(this.executeAsSSE(task), {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            },
        });
    }

    async execute(task: string, onEvent?: LoopEventCallback): Promise<LoopResult> {
        const startTime = Date.now();
        const cwd = this.config.cwd || process.cwd();
        const state = this.state;

        const systemPrompt = buildSystemPrompt(this.config);
        const maxIter = this.config.maxIterations!;

        for (let i = state.iteration; i < maxIter; i++) {
            state.iteration = i;
            onEvent?.({ type: 'iteration_start', iteration: i });

            try {
                // 1. Call LLM
                const userPrompt = buildIterationPrompt(state, task, this.config.contextWindow!);
                const response = await callLLM(
                    this.config.llm as string,
                    [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt },
                    ],
                    {
                        temperature: this.config.temperature,
                        maxTokens: this.config.maxTokens,
                    },
                );

                // 2. Parse tool calls from response
                const toolCalls = parseToolCalls(response);

                // 3. Execute each tool call in parallel
                await Promise.all(toolCalls.map(async (call) => {
                    onEvent?.({ type: 'tool_start', tool: call.tool, params: call.params });
                    call.result = await executeTool(call.tool, call.params, cwd);
                    onEvent?.({ type: 'tool_result', tool: call.tool, result: call.result });
                }));
                state.toolHistory.push(...toolCalls);

                // 4. Check outcomes
                state.outcomeResults = await this.checkOutcomes(state);
                onEvent?.({ type: 'outcome_check', outcomes: state.outcomeResults });

                // 4b. Auto-checkpoint after each iteration
                this.saveCheckpoint();

                // 5. All met?
                const allMet = state.outcomeResults.every(o => o.met);
                if (allMet) {
                    const elapsed = Date.now() - startTime;
                    onEvent?.({ type: 'complete', iteration: i, totalElapsedMs: elapsed });
                    this.removeCheckpoint();
                    return { success: true, iterations: i + 1, elapsedMs: elapsed, state };
                }

                // 6. No tool calls and no progress? Bail to avoid infinite no-ops
                if (toolCalls.length === 0 && i > 0) {
                    // LLM didn't produce any tool calls — might be stuck
                    // Give it one more chance with a nudge
                }

            } catch (err: any) {
                onEvent?.({ type: 'error', error: err.message });
            }
        }

        // Max iterations reached
        const elapsed = Date.now() - startTime;
        onEvent?.({ type: 'max_iterations_reached', iteration: maxIter });
        return { success: false, iterations: maxIter, elapsedMs: elapsed, state };
    }

    private async checkOutcomes(state: LoopState): Promise<OutcomeResult[]> {
        const results: OutcomeResult[] = [];
        for (const outcome of this.config.outcomes) {
            try {
                const { met, reason } = await outcome.validate(state);
                results.push({
                    outcome: outcome.description,
                    met,
                    confidence: met ? 1.0 : 0.0,
                    reason,
                });
            } catch (err: any) {
                results.push({
                    outcome: outcome.description,
                    met: false,
                    confidence: 0,
                    reason: `Validation error: ${err.message}`,
                });
            }
        }
        return results;
    }
}
