/**
 * conversation-memory.ts — Knowledge Store with Semantic Search
 *
 * Persistent tagged memory with text similarity retrieval and importance ranking.
 * Use this to store long-term knowledge entries that persist across sessions.
 *
 * NOTE: For turn-based chat history (user/assistant message pairs),
 * see memory.ts (ConversationMemory — chat history).
 *
 * Usage:
 *   const mem = new ConversationMemory({ maxEntries: 1000 });
 *   mem.add('User prefers dark mode', ['preference', 'ui']);
 *   const results = mem.search('color theme');
 */

export interface MemoryEntry {
    id: string;
    content: string;
    tags: string[];
    timestamp: number;
    importance: number; // 0-1
    metadata?: Record<string, any>;
}

export interface MemoryConfig {
    maxEntries?: number;
    storageKey?: string;
}

export interface SearchResult {
    entry: MemoryEntry;
    score: number;
}

export class ConversationMemory {
    private entries: MemoryEntry[] = [];
    private maxEntries: number;
    private storageKey: string;

    constructor(config: MemoryConfig = {}) {
        this.maxEntries = config.maxEntries ?? 1000;
        this.storageKey = config.storageKey ?? 'gxai-memory';
    }

    /** Add a memory entry */
    add(content: string, tags: string[] = [], importance = 0.5, metadata?: Record<string, any>): MemoryEntry {
        const entry: MemoryEntry = {
            id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            content,
            tags,
            timestamp: Date.now(),
            importance,
            metadata,
        };

        this.entries.push(entry);

        // Prune if over limit (remove lowest importance first)
        if (this.entries.length > this.maxEntries) {
            this.entries.sort((a, b) => b.importance - a.importance);
            this.entries = this.entries.slice(0, this.maxEntries);
        }

        return entry;
    }

    /** Search memories by text similarity (simple TF-IDF-like scoring) */
    search(query: string, limit = 5): SearchResult[] {
        const queryTokens = tokenize(query);
        if (queryTokens.length === 0) return [];

        const scored: SearchResult[] = this.entries.map(entry => {
            const entryTokens = tokenize(entry.content);
            const tagBonus = entry.tags.some(t =>
                queryTokens.some(qt => t.toLowerCase().includes(qt))
            ) ? 0.3 : 0;

            // Jaccard-like similarity + importance weighting
            const intersection = queryTokens.filter(t => entryTokens.includes(t)).length;
            const union = new Set([...queryTokens, ...entryTokens]).size;
            const similarity = union > 0 ? intersection / union : 0;

            const score = (similarity + tagBonus) * (0.5 + entry.importance * 0.5);
            return { entry, score };
        });

        return scored
            .filter(r => r.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
    }

    /** Get memories by tag */
    getByTag(tag: string): MemoryEntry[] {
        return this.entries.filter(e => e.tags.includes(tag));
    }

    /** Get recent memories */
    getRecent(count = 10): MemoryEntry[] {
        return [...this.entries]
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, count);
    }

    /** Get most important memories */
    getImportant(count = 10): MemoryEntry[] {
        return [...this.entries]
            .sort((a, b) => b.importance - a.importance)
            .slice(0, count);
    }

    /** Remove a memory by ID */
    remove(id: string): boolean {
        const idx = this.entries.findIndex(e => e.id === id);
        if (idx >= 0) { this.entries.splice(idx, 1); return true; }
        return false;
    }

    /** Clear all memories */
    clear(): void {
        this.entries = [];
    }

    /** Export all memories */
    export(): MemoryEntry[] {
        return [...this.entries];
    }

    /** Import memories */
    import(entries: MemoryEntry[]): void {
        this.entries.push(...entries);
        if (this.entries.length > this.maxEntries) {
            this.entries.sort((a, b) => b.importance - a.importance);
            this.entries = this.entries.slice(0, this.maxEntries);
        }
    }

    /** Get memory count */
    get size(): number {
        return this.entries.length;
    }

    /** Serialize for persistence */
    serialize(): string {
        return JSON.stringify(this.entries);
    }

    /** Restore from serialized data */
    restore(data: string): void {
        this.entries = JSON.parse(data);
    }
}

function tokenize(text: string): string[] {
    return text.toLowerCase()
        .replace(/[^\w\s]/g, '')
        .split(/\s+/)
        .filter(t => t.length > 2);
}
