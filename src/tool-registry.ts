/**
 * tool-registry.ts — Dynamic Tool Registration & Discovery
 *
 * Register, deregister, and query tools with metadata.
 *
 * Usage:
 *   const registry = new ToolRegistry();
 *   registry.register({ name: 'search', handler: searchFn, description: 'Web search' });
 *   const tool = registry.get('search');
 *   await tool.handler({ query: 'hello' });
 */

export interface ToolDefinition {
    name: string;
    handler: (input: any) => any | Promise<any>;
    description?: string;
    category?: string;
    version?: string;
    schema?: Record<string, any>;
    enabled?: boolean;
    tags?: string[];
}

export interface ToolInfo {
    name: string;
    description?: string;
    category?: string;
    version?: string;
    enabled: boolean;
    tags: string[];
    registeredAt: number;
    invocationCount: number;
}

export class ToolRegistry {
    private tools = new Map<string, ToolDefinition & { registeredAt: number; invocationCount: number }>();

    /** Register a tool */
    register(tool: ToolDefinition): this {
        this.tools.set(tool.name, {
            ...tool,
            enabled: tool.enabled ?? true,
            tags: tool.tags ?? [],
            registeredAt: Date.now(),
            invocationCount: 0,
        });
        return this;
    }

    /** Deregister a tool */
    deregister(name: string): boolean {
        return this.tools.delete(name);
    }

    /** Get a tool by name */
    get(name: string): ToolDefinition | undefined {
        const tool = this.tools.get(name);
        if (!tool || !tool.enabled) return undefined;
        return tool;
    }

    /** Invoke a tool by name */
    async invoke(name: string, input: any): Promise<any> {
        const tool = this.tools.get(name);
        if (!tool) throw new Error(`Tool "${name}" not found`);
        if (!tool.enabled) throw new Error(`Tool "${name}" is disabled`);
        tool.invocationCount++;
        return tool.handler(input);
    }

    /** Check if a tool exists */
    has(name: string): boolean {
        return this.tools.has(name);
    }

    /** Enable/disable a tool */
    setEnabled(name: string, enabled: boolean): boolean {
        const tool = this.tools.get(name);
        if (!tool) return false;
        tool.enabled = enabled;
        return true;
    }

    /** Get all tool names */
    get names(): string[] {
        return [...this.tools.keys()];
    }

    /** Get tools by category */
    getByCategory(category: string): ToolInfo[] {
        return this.list().filter(t => t.category === category);
    }

    /** Get tools by tag */
    getByTag(tag: string): ToolInfo[] {
        return this.list().filter(t => t.tags.includes(tag));
    }

    /** Search tools by name or description */
    search(query: string): ToolInfo[] {
        const q = query.toLowerCase();
        return this.list().filter(t =>
            t.name.toLowerCase().includes(q) ||
            (t.description?.toLowerCase().includes(q) ?? false)
        );
    }

    /** List all tools with info */
    list(): ToolInfo[] {
        return [...this.tools.values()].map(t => ({
            name: t.name,
            description: t.description,
            category: t.category,
            version: t.version,
            enabled: t.enabled ?? true,
            tags: t.tags ?? [],
            registeredAt: t.registeredAt,
            invocationCount: t.invocationCount,
        }));
    }

    /** Get tool count */
    get size(): number {
        return this.tools.size;
    }

    /** Clear all tools */
    clear(): void {
        this.tools.clear();
    }
}
