/**
 * memory.ts — Agent Conversation Memory
 *
 * Maintains conversational history across multiple Agent.run() calls,
 * enabling multi-turn interactions where the agent remembers prior context.
 *
 * Usage:
 *   const memory = new ConversationMemory({ maxTurns: 10 });
 *   memory.addUser("What is the capital of France?");
 *   memory.addAssistant("The capital of France is Paris.");
 *   const messages = memory.getMessages();
 *
 * Integrates with Agent via AgentConfig.memory:
 *   const agent = new Agent({ ..., memory: new ConversationMemory() });
 *   // Each run() auto-appends input/output to memory
 */

export interface ConversationMemoryConfig {
    /** Maximum number of turns (user+assistant pairs) to retain. Default: 20 */
    maxTurns?: number;
    /** System message prepended to every getMessages() call */
    systemMessage?: string;
}

export interface MemoryMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
    timestamp: number;
}

export class ConversationMemory {
    private messages: MemoryMessage[] = [];
    private config: ConversationMemoryConfig;
    /** Optional label for identifying forked branches */
    public label: string | null = null;

    constructor(config: ConversationMemoryConfig = {}) {
        this.config = { maxTurns: 20, ...config };
    }

    /** Add a user message */
    addUser(content: string): void {
        this.messages.push({ role: 'user', content, timestamp: Date.now() });
        this.prune();
    }

    /** Add an assistant message */
    addAssistant(content: string): void {
        this.messages.push({ role: 'assistant', content, timestamp: Date.now() });
        this.prune();
    }

    /** Add a system message */
    addSystem(content: string): void {
        this.messages.push({ role: 'system', content, timestamp: Date.now() });
    }

    /** Get all messages formatted for LLM consumption */
    getMessages(): Array<{ role: string; content: string }> {
        const result: Array<{ role: string; content: string }> = [];
        if (this.config.systemMessage) {
            result.push({ role: 'system', content: this.config.systemMessage });
        }
        for (const msg of this.messages) {
            result.push({ role: msg.role, content: msg.content });
        }
        return result;
    }

    /** Get conversation history as a formatted string for context injection */
    getContextString(): string {
        if (this.messages.length === 0) return '';
        const lines = this.messages.map(m => {
            const label = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Agent' : 'System';
            return `[${label}]: ${m.content.substring(0, 500)}`;
        });
        return `<conversation_history>\n${lines.join('\n')}\n</conversation_history>`;
    }

    /** Get current turn count */
    get turnCount(): number {
        return Math.floor(this.messages.filter(m => m.role === 'user').length);
    }

    /** Get total message count */
    get messageCount(): number {
        return this.messages.length;
    }

    /** Clear all messages */
    clear(): void {
        this.messages = [];
    }

    /** Export messages for serialization */
    toJSON(): MemoryMessage[] {
        return [...this.messages];
    }

    /** Import messages from serialized data */
    fromJSON(messages: MemoryMessage[]): void {
        this.messages = [...messages];
        this.prune();
    }

    /**
     * Fork this conversation into an independent branch.
     * The forked memory has the same messages and config
     * but diverges from this point forward.
     * Useful for A/B testing different conversation paths.
     */
    fork(branchLabel?: string): ConversationMemory {
        const forked = new ConversationMemory({ ...this.config });
        forked.messages = this.messages.map(m => ({ ...m }));
        forked.label = branchLabel || `fork-${Date.now()}`;
        return forked;
    }

    /**
     * Summarize older messages to compress context window usage.
     * Keeps the most recent `keepRecent` turns intact and compresses
     * everything before into a single system summary message.
     *
     * @param keepRecent Number of recent turns to preserve (default: 5)
     * @returns The summary text that replaced older messages
     */
    summarize(keepRecent = 5): string {
        const userMessages = this.messages.filter(m => m.role === 'user');
        if (userMessages.length <= keepRecent) return ''; // Nothing to summarize

        // Find cutoff point — keep the last `keepRecent` user messages
        const cutoffUserMsg = userMessages[userMessages.length - keepRecent];
        if (!cutoffUserMsg) return '';
        const cutoffIdx = this.messages.indexOf(cutoffUserMsg);
        if (cutoffIdx <= 0) return '';

        // Extract older messages for summarization
        const olderMessages = this.messages.slice(0, cutoffIdx);
        const recentMessages = this.messages.slice(cutoffIdx);

        // Simple extractive summary — take key content from each message
        const summaryLines = olderMessages.map(m => {
            const label = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Agent' : 'System';
            const content = m.content.length > 200 ? m.content.substring(0, 200) + '...' : m.content;
            return `${label}: ${content}`;
        });

        const summaryText = `[Conversation Summary - ${olderMessages.length} messages compressed]\n${summaryLines.join('\n')}`;

        // Replace messages: summary system message + recent messages
        this.messages = [
            { role: 'system', content: summaryText, timestamp: Date.now() },
            ...recentMessages,
        ];

        return summaryText;
    }

    /**
     * Summarize using a custom function (e.g., LLM-powered).
     * The summarizer receives the older messages and returns a summary string.
     *
     * @param summarizer Function that produces a summary from messages
     * @param keepRecent Number of recent turns to preserve (default: 5)
     */
    async summarizeWithLLM(
        summarizer: (messages: MemoryMessage[]) => Promise<string>,
        keepRecent = 5
    ): Promise<string> {
        const userMessages = this.messages.filter(m => m.role === 'user');
        if (userMessages.length <= keepRecent) return '';

        const cutoffUserMsg = userMessages[userMessages.length - keepRecent];
        if (!cutoffUserMsg) return '';
        const cutoffIdx = this.messages.indexOf(cutoffUserMsg);
        if (cutoffIdx <= 0) return '';

        const olderMessages = this.messages.slice(0, cutoffIdx);
        const recentMessages = this.messages.slice(cutoffIdx);

        const summaryText = await summarizer(olderMessages);

        this.messages = [
            { role: 'system', content: summaryText, timestamp: Date.now() },
            ...recentMessages,
        ];

        return summaryText;
    }

    /** Prune old turns to stay within maxTurns */
    private prune(): void {
        const maxTurns = this.config.maxTurns || 20;
        const userMessages = this.messages.filter(m => m.role === 'user');
        if (userMessages.length <= maxTurns) return;

        // Find the index of the Nth-from-end user message
        const cutoffUserMsg = userMessages[userMessages.length - maxTurns];
        if (!cutoffUserMsg) return;
        const cutoffIdx = this.messages.indexOf(cutoffUserMsg);
        if (cutoffIdx > 0) {
            this.messages = this.messages.slice(cutoffIdx);
        }
    }
}
