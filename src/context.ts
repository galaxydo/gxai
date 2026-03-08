/**
 * context.ts — Context Window Tracking
 *
 * Tracks cumulative token usage across multi-turn runs
 * and provides warnings when approaching a model's context window limit.
 */

/** Known context window sizes per model (in tokens) */
const CONTEXT_WINDOWS: Array<{ match: string; maxTokens: number }> = [
    // OpenAI
    { match: 'gpt-4o-mini', maxTokens: 128_000 },
    { match: 'o4-mini', maxTokens: 200_000 },
    { match: 'gpt-4o', maxTokens: 128_000 },
    { match: 'gpt-4', maxTokens: 8_192 },

    // Anthropic
    { match: 'claude-3-5-sonnet', maxTokens: 200_000 },
    { match: 'claude-3-sonnet', maxTokens: 200_000 },
    { match: 'claude', maxTokens: 200_000 },

    // DeepSeek
    { match: 'deepseek', maxTokens: 128_000 },

    // Gemini
    { match: 'gemini-2.5-pro', maxTokens: 1_048_576 },
    { match: 'gemini-2.0-flash', maxTokens: 1_048_576 },
    { match: 'gemini', maxTokens: 1_048_576 },
];

const DEFAULT_CONTEXT_WINDOW = 128_000;

/** Look up the context window size for a model */
export function getContextWindowSize(llm: string): number {
    for (const entry of CONTEXT_WINDOWS) {
        if (llm.includes(entry.match)) return entry.maxTokens;
    }
    return DEFAULT_CONTEXT_WINDOW;
}

export interface ContextUsage {
    /** Total accumulated input tokens across all runs */
    cumulativeInputTokens: number;
    /** Model context window size */
    contextWindowSize: number;
    /** Usage ratio (0-1+) */
    utilizationRatio: number;
    /** Warning level: 'ok' | 'warning' (>75%) | 'critical' (>90%) | 'exceeded' (>100%) */
    level: 'ok' | 'warning' | 'critical' | 'exceeded';
}

export class ContextTracker {
    private cumulativeInputTokens = 0;
    private contextWindowSize: number;

    constructor(llm: string) {
        this.contextWindowSize = getContextWindowSize(llm);
    }

    /** Add tokens from a completed run */
    addUsage(inputTokens: number): void {
        this.cumulativeInputTokens += inputTokens;
    }

    /** Get current context utilization */
    getUsage(): ContextUsage {
        const ratio = this.cumulativeInputTokens / this.contextWindowSize;
        let level: ContextUsage['level'] = 'ok';
        if (ratio > 1.0) level = 'exceeded';
        else if (ratio > 0.9) level = 'critical';
        else if (ratio > 0.75) level = 'warning';

        return {
            cumulativeInputTokens: this.cumulativeInputTokens,
            contextWindowSize: this.contextWindowSize,
            utilizationRatio: Math.round(ratio * 1000) / 1000,
            level,
        };
    }

    /** Check if context is still within safe limits */
    isSafe(): boolean {
        return this.cumulativeInputTokens / this.contextWindowSize <= 0.9;
    }

    /** Reset the tracker (e.g., after memory pruning) */
    reset(): void {
        this.cumulativeInputTokens = 0;
    }
}
