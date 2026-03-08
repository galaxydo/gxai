/**
 * context-window.ts — Context Window Manager
 *
 * Automatic context window tracking and pruning to fit model limits.
 * Estimates token counts and trims messages from the front when
 * approaching the model's context limit.
 *
 * Usage:
 *   const cw = new ContextWindow({ maxTokens: 8192, reserveTokens: 1024 });
 *   cw.addSystemPrompt('You are helpful.');
 *   cw.addMessage('user', 'Hello!');
 *   const messages = cw.getMessages(); // auto-pruned to fit
 */

export interface ContextWindowConfig {
    /** Maximum tokens for the model (default: 8192) */
    maxTokens?: number;
    /** Tokens to reserve for output (default: 1024) */
    reserveTokens?: number;
    /** Characters per token estimate (default: 4) */
    charsPerToken?: number;
    /** Strategy for pruning: 'fifo' removes oldest, 'summarize' keeps summary (default: 'fifo') */
    pruneStrategy?: 'fifo' | 'summarize';
}

export interface ContextMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    /** Whether this message is pinned (never pruned) */
    pinned?: boolean;
    /** Estimated token count */
    tokens?: number;
}

export interface ContextWindowStats {
    totalTokens: number;
    maxTokens: number;
    availableTokens: number;
    messageCount: number;
    prunedCount: number;
    utilization: number; // 0-1
}

export class ContextWindow {
    private messages: ContextMessage[] = [];
    private config: Required<ContextWindowConfig>;
    private prunedCount = 0;

    constructor(config: ContextWindowConfig = {}) {
        this.config = {
            maxTokens: config.maxTokens ?? 8192,
            reserveTokens: config.reserveTokens ?? 1024,
            charsPerToken: config.charsPerToken ?? 4,
            pruneStrategy: config.pruneStrategy ?? 'fifo',
        };
    }

    /** Estimate token count for text */
    estimateTokens(text: string): number {
        return Math.ceil(text.length / this.config.charsPerToken);
    }

    /** Add a system prompt (always pinned) */
    addSystemPrompt(content: string): this {
        const tokens = this.estimateTokens(content);
        this.messages.unshift({ role: 'system', content, pinned: true, tokens });
        this.prune();
        return this;
    }

    /** Add a message */
    addMessage(role: ContextMessage['role'], content: string, pinned = false): this {
        const tokens = this.estimateTokens(content);
        this.messages.push({ role, content, pinned, tokens });
        this.prune();
        return this;
    }

    /** Get all messages (auto-pruned to fit within context window) */
    getMessages(): ContextMessage[] {
        return [...this.messages];
    }

    /** Current total estimated tokens */
    get totalTokens(): number {
        return this.messages.reduce((sum, m) => sum + (m.tokens ?? 0), 0);
    }

    /** Available tokens for new content */
    get availableTokens(): number {
        return Math.max(0, this.config.maxTokens - this.config.reserveTokens - this.totalTokens);
    }

    /** Get context window stats */
    get stats(): ContextWindowStats {
        const budget = this.config.maxTokens - this.config.reserveTokens;
        return {
            totalTokens: this.totalTokens,
            maxTokens: this.config.maxTokens,
            availableTokens: this.availableTokens,
            messageCount: this.messages.length,
            prunedCount: this.prunedCount,
            utilization: budget > 0 ? Math.min(1, this.totalTokens / budget) : 1,
        };
    }

    /** Check if content fits within the window */
    fits(content: string): boolean {
        return this.estimateTokens(content) <= this.availableTokens;
    }

    /** Clear all non-pinned messages */
    clearUnpinned(): void {
        this.messages = this.messages.filter(m => m.pinned);
    }

    /** Clear everything */
    clear(): void {
        this.messages = [];
        this.prunedCount = 0;
    }

    /** Prune messages to fit within context window */
    private prune(): void {
        const budget = this.config.maxTokens - this.config.reserveTokens;

        while (this.totalTokens > budget && this.messages.length > 1) {
            // Find the first non-pinned message
            const idx = this.messages.findIndex(m => !m.pinned);
            if (idx === -1) break; // all pinned, can't prune

            if (this.config.pruneStrategy === 'summarize' && this.messages.length > 3) {
                // Summarize strategy: replace oldest non-pinned messages with a summary
                const removed = this.messages.splice(idx, 1)[0]!;
                this.prunedCount++;
                // Insert a condensed marker
                const summaryMsg: ContextMessage = {
                    role: 'system',
                    content: `[Earlier context pruned: ${removed.role} message, ~${removed.tokens} tokens]`,
                    tokens: this.estimateTokens('[Earlier context pruned]'),
                };
                this.messages.splice(idx, 0, summaryMsg);
                // If the summary is still too big, just remove it
                if (this.totalTokens > budget) {
                    this.messages.splice(idx, 1);
                }
            } else {
                // FIFO: just remove oldest non-pinned
                this.messages.splice(idx, 1);
                this.prunedCount++;
            }
        }
    }
}
