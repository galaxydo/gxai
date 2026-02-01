/**
 * MCP (Model Context Protocol) types and utilities
 */

export interface MCPServer {
    name: string;
    description: string;
    url: string;
}

export interface MCPTool {
    name: string;
    description: string;
    inputSchema: any; // JSON schema for tool parameters
}

/**
 * Helper to create an MCP server configuration
 */
export const mcp = {
    server: (config: Omit<MCPServer, "name"> & { name: string }): MCPServer => config,
};
