/**
 * plugin.ts — Agent Plugin System
 *
 * Plugins bundle middleware, tools, and config overrides
 * into reusable, named capabilities that can be registered on any Agent.
 *
 * Usage:
 *   const loggingPlugin: AgentPlugin = {
 *     name: 'logging',
 *     middleware: async (ctx) => { console.log(ctx.phase, ctx.agentName); },
 *   };
 *   agent.register(loggingPlugin);
 */

import type { AgentMiddleware } from './agent';
import type { MCPServer } from './types';

export interface AgentPlugin {
    /** Unique plugin name */
    name: string;
    /** Optional description */
    description?: string;
    /** Middleware hooks to register */
    middleware?: AgentMiddleware | AgentMiddleware[];
    /** Additional MCP servers to attach */
    servers?: MCPServer[];
    /** Config overrides (temperature, maxTokens, etc.) */
    config?: Record<string, any>;
    /** Initialization hook — called once when plugin is registered */
    setup?: () => void | Promise<void>;
    /** Teardown hook — called when plugin is removed */
    teardown?: () => void | Promise<void>;
}

export class PluginRegistry {
    private plugins: Map<string, AgentPlugin> = new Map();

    /** Register a plugin */
    async register(plugin: AgentPlugin): Promise<void> {
        if (this.plugins.has(plugin.name)) {
            throw new Error(`Plugin "${plugin.name}" is already registered`);
        }
        if (plugin.setup) await plugin.setup();
        this.plugins.set(plugin.name, plugin);
    }

    /** Unregister a plugin by name */
    async unregister(name: string): Promise<boolean> {
        const plugin = this.plugins.get(name);
        if (!plugin) return false;
        if (plugin.teardown) await plugin.teardown();
        this.plugins.delete(name);
        return true;
    }

    /** Check if a plugin is registered */
    has(name: string): boolean {
        return this.plugins.has(name);
    }

    /** Get a registered plugin */
    get(name: string): AgentPlugin | undefined {
        return this.plugins.get(name);
    }

    /** Get all registered plugin names */
    get names(): string[] {
        return [...this.plugins.keys()];
    }

    /** Get all middleware from all plugins (flattened) */
    getAllMiddleware(): AgentMiddleware[] {
        const result: AgentMiddleware[] = [];
        for (const plugin of this.plugins.values()) {
            if (plugin.middleware) {
                if (Array.isArray(plugin.middleware)) {
                    result.push(...plugin.middleware);
                } else {
                    result.push(plugin.middleware);
                }
            }
        }
        return result;
    }

    /** Get all servers from all plugins */
    getAllServers(): MCPServer[] {
        const result: MCPServer[] = [];
        for (const plugin of this.plugins.values()) {
            if (plugin.servers) result.push(...plugin.servers);
        }
        return result;
    }

    /** Get merged config overrides from all plugins */
    getMergedConfig(): Record<string, any> {
        let merged: Record<string, any> = {};
        for (const plugin of this.plugins.values()) {
            if (plugin.config) merged = { ...merged, ...plugin.config };
        }
        return merged;
    }

    /** Clear all plugins */
    async clear(): Promise<void> {
        for (const plugin of this.plugins.values()) {
            if (plugin.teardown) await plugin.teardown();
        }
        this.plugins.clear();
    }

    /** Number of registered plugins */
    get size(): number {
        return this.plugins.size;
    }
}
