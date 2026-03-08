/**
 * tool-auth.ts — Agent Tool Authorization
 *
 * Whitelist/blacklist tool permissions per agent with granular control.
 * Determines which MCP tools an agent is allowed to invoke.
 *
 * Usage:
 *   const auth = new ToolAuthorizer({
 *     mode: 'whitelist',
 *     tools: ['read_file', 'search'],
 *   });
 *   auth.isAllowed('read_file');  // true
 *   auth.isAllowed('delete_all'); // false
 */

export interface ToolAuthConfig {
    /** Authorization mode */
    mode: 'whitelist' | 'blacklist';
    /** Tool names to whitelist or blacklist */
    tools: string[];
    /** Optional server-level filtering (server:tool format) */
    serverTools?: string[];
    /** Whether to log denied tool attempts */
    logDenied?: boolean;
}

export interface ToolAuthDecision {
    allowed: boolean;
    reason?: string;
}

export class ToolAuthorizer {
    private config: ToolAuthConfig;
    private toolSet: Set<string>;
    private serverToolSet: Set<string>;
    private deniedLog: Array<{ tool: string; server?: string; timestamp: number }> = [];

    constructor(config: ToolAuthConfig) {
        this.config = config;
        this.toolSet = new Set(config.tools);
        this.serverToolSet = new Set(config.serverTools || []);
    }

    /** Check if a tool is allowed */
    isAllowed(toolName: string, serverName?: string): ToolAuthDecision {
        // Check server:tool specific rules first
        if (serverName) {
            const serverTool = `${serverName}:${toolName}`;
            if (this.config.mode === 'whitelist') {
                if (this.serverToolSet.has(serverTool)) {
                    return { allowed: true };
                }
            } else {
                if (this.serverToolSet.has(serverTool)) {
                    this.logDenied(toolName, serverName);
                    return { allowed: false, reason: `Server tool ${serverTool} is blacklisted` };
                }
            }
        }

        // Check tool-level rules
        if (this.config.mode === 'whitelist') {
            if (this.toolSet.has(toolName)) {
                return { allowed: true };
            }
            this.logDenied(toolName, serverName);
            return { allowed: false, reason: `Tool ${toolName} is not in whitelist` };
        }

        // Blacklist mode
        if (this.toolSet.has(toolName)) {
            this.logDenied(toolName, serverName);
            return { allowed: false, reason: `Tool ${toolName} is blacklisted` };
        }
        return { allowed: true };
    }

    /** Add a tool to the list */
    addTool(toolName: string): void {
        this.toolSet.add(toolName);
    }

    /** Remove a tool from the list */
    removeTool(toolName: string): void {
        this.toolSet.delete(toolName);
    }

    /** Get all denied attempts */
    getDeniedLog(): typeof this.deniedLog {
        return [...this.deniedLog];
    }

    /** Clear the denied log */
    clearDeniedLog(): void {
        this.deniedLog = [];
    }

    /** Get the current tool list */
    get tools(): string[] {
        return [...this.toolSet];
    }

    /** Get the authorization mode */
    get mode(): 'whitelist' | 'blacklist' {
        return this.config.mode;
    }

    private logDenied(tool: string, server?: string): void {
        if (this.config.logDenied !== false) {
            this.deniedLog.push({ tool, server, timestamp: Date.now() });
        }
    }
}

/**
 * Create a permissive authorizer that allows all tools
 */
export function allowAllTools(): ToolAuthorizer {
    return new ToolAuthorizer({ mode: 'blacklist', tools: [] });
}

/**
 * Create a restrictive authorizer from a whitelist
 */
export function onlyTools(...tools: string[]): ToolAuthorizer {
    return new ToolAuthorizer({ mode: 'whitelist', tools });
}

/**
 * Create an authorizer that blocks specific tools
 */
export function blockTools(...tools: string[]): ToolAuthorizer {
    return new ToolAuthorizer({ mode: 'blacklist', tools });
}
