import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import type { MCPTool } from './types';

export interface FileSystemConfig {
    /** List of absolute directory paths the tools are allowed to access. Prevents path traversal out of these bounds. */
    allowedDirs: string[];
}

export interface LocalMCPTool extends MCPTool {
    handler: (params: any) => Promise<any>;
}

/**
 * Validates that a requested file path resolves within the allowed sandbox directories.
 * Prevents directory traversal attacks (e.g. `../../../etc/passwd`).
 */
export function resolveAndValidatePath(requestedPath: string, allowedDirs: string[]): string {
    const resolved = path.resolve(requestedPath);

    // Ensure the path strictly falls under at least one allowed directory boundary
    const isAllowed = allowedDirs.some(dir => {
        const allowedResolved = path.resolve(dir);
        return resolved === allowedResolved || resolved.startsWith(allowedResolved + path.sep);
    });

    if (!isAllowed) {
        throw new Error(`Access denied: Path "${requestedPath}" is outside allowed sandbox directories.`);
    }

    return resolved;
}

/**
 * Generates the built-in File System MCP Tool definitions & handlers.
 */
export function createFileSystemTools(config: FileSystemConfig): LocalMCPTool[] {
    const { allowedDirs } = config;

    return [
        {
            name: 'read_file',
            description: 'Read the contents of a file. The path must be within the allowed sandbox directories.',
            inputSchema: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Absolute or relative path to the file to read' }
                },
                required: ['path']
            },
            handler: async (params: { path: string }) => {
                const safePath = resolveAndValidatePath(params.path, allowedDirs);
                if (!existsSync(safePath)) {
                    throw new Error(`File not found: ${params.path}`);
                }
                const content = await fs.readFile(safePath, 'utf8');
                return { content };
            }
        },
        {
            name: 'write_file',
            description: 'Write string content to a file. Overwrites if it exists, creates parent directories if missing. Path must be in allowed sandbox.',
            inputSchema: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Absolute or relative path to write the file' },
                    content: { type: 'string', description: 'The text content to write into the file' }
                },
                required: ['path', 'content']
            },
            handler: async (params: { path: string, content: string }) => {
                const safePath = resolveAndValidatePath(params.path, allowedDirs);
                await fs.mkdir(path.dirname(safePath), { recursive: true });
                await fs.writeFile(safePath, params.content, 'utf8');
                return { success: true, path: safePath };
            }
        },
        {
            name: 'list_dir',
            description: 'List the contents of a directory. Returns an array of files and folders.',
            inputSchema: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'The directory path to list' }
                },
                required: ['path']
            },
            handler: async (params: { path: string }) => {
                const safePath = resolveAndValidatePath(params.path, allowedDirs);
                if (!existsSync(safePath)) {
                    throw new Error(`Directory not found: ${params.path}`);
                }
                const stat = await fs.stat(safePath);
                if (!stat.isDirectory()) {
                    throw new Error(`Path is not a directory: ${params.path}`);
                }

                const entries = await fs.readdir(safePath, { withFileTypes: true });
                const files = entries.map(e => ({
                    name: e.name,
                    isDirectory: e.isDirectory(),
                    isSymbolicLink: e.isSymbolicLink()
                }));

                return { path: safePath, files };
            }
        },
        {
            name: 'search_files',
            description: 'Recursively search for files containing a specific text query within a directory.',
            inputSchema: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Directory path to search in' },
                    query: { type: 'string', description: 'The text to search for within file contents' },
                    extension: { type: 'string', description: 'Optional. Restrict search to specific file extension (e.g. ".ts")' }
                },
                required: ['path', 'query']
            },
            handler: async (params: { path: string, query: string, extension?: string }) => {
                const safePath = resolveAndValidatePath(params.path, allowedDirs);
                if (!existsSync(safePath)) {
                    throw new Error(`Directory not found: ${params.path}`);
                }

                const matches: Array<{ path: string, line: number, content: string }> = [];
                const MAX_RESULTS = 100;

                async function searchRecursive(dir: string) {
                    if (matches.length >= MAX_RESULTS) return;

                    const entries = await fs.readdir(dir, { withFileTypes: true });
                    for (const entry of entries) {
                        if (matches.length >= MAX_RESULTS) break;

                        const fullPath = path.join(dir, entry.name);

                        if (entry.isDirectory()) {
                            // skip common noisy directories
                            if (entry.name === 'node_modules' || entry.name === '.git') continue;
                            await searchRecursive(fullPath);
                        } else if (entry.isFile()) {
                            if (params.extension && !entry.name.endsWith(params.extension)) {
                                continue;
                            }

                            try {
                                const content = await fs.readFile(fullPath, 'utf8');
                                const lines = content.split(/\r?\n/);
                                for (let i = 0; i < lines.length; i++) {
                                    const line = lines[i];
                                    if (line && line.includes(params.query)) {
                                        matches.push({
                                            path: path.relative(safePath, fullPath),
                                            line: i + 1,
                                            content: line.trim()
                                        });
                                        if (matches.length >= MAX_RESULTS) break;
                                    }
                                }
                            } catch (e) {
                                // Skip unreadable or binary files safely
                            }
                        }
                    }
                }

                await searchRecursive(safePath);
                return { searchCompleted: true, matches, limitReached: matches.length >= MAX_RESULTS };
            }
        }
    ];
}

/**
 * Helper to quickly spin up a local Bun standalone MCP server exposing the given filesystem tools.
 * Returns the URL array that can be registered into the Agent Config.
 */
export function serveFileSystemMCP(config: FileSystemConfig & { port: number }) {
    const tools = createFileSystemTools(config);

    const server = Bun.serve({
        port: config.port,
        async fetch(req) {
            const url = new URL(req.url);

            // CORS Preflight
            if (req.method === "OPTIONS") {
                return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" } });
            }

            const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };

            // Discovery endpoint
            if (req.method === "GET" && url.pathname === "/tools") {
                const definitions = tools.map(({ handler, ...def }) => def);
                return new Response(JSON.stringify(definitions), { headers });
            }

            // Invocation endpoint
            if (req.method === "POST" && url.pathname === "/call") {
                try {
                    const body = await req.json();
                    if (!body || typeof body.method !== 'string') {
                        return new Response(JSON.stringify({ error: 'Invalid payload' }), { status: 400, headers });
                    }

                    const tool = tools.find(t => t.name === body.method);
                    if (!tool) {
                        return new Response(JSON.stringify({ error: `Tool "${body.method}" not found` }), { status: 404, headers });
                    }

                    const result = await tool.handler(body.params || {});
                    return new Response(JSON.stringify(result), { headers });
                } catch (error: any) {
                    return new Response(JSON.stringify({ error: error.message || String(error) }), { status: 500, headers });
                }
            }

            return new Response("Not found", { status: 404, headers });
        }
    });

    return {
        url: `http://localhost:${server.port}`,
        server,
        mcpServer: {
            name: `local_fs_mcp`,
            description: `Local FileSystem MCP sandbox via port ${server.port}`,
            url: `http://localhost:${server.port}`
        }
    };
}
