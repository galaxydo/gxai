import * as http from 'http';
import * as vm from 'node:vm';
import type { MCPTool } from './types';

export interface LocalMCPTool extends MCPTool {
    handler: (params: any) => Promise<any> | any;
}

export interface SandboxConfig {
    /** Maximum execution time in milliseconds (default: 5000) */
    timeoutMs?: number;
    /** Whether to inject `fetch` API into sandbox (default: false) */
    allowFetch?: boolean;
}

/**
 * Creates the `run_code` MCP tool with a restricted `node:vm` sandbox.
 */
export function createSandboxTools(config: SandboxConfig = {}): LocalMCPTool[] {
    const timeoutMs = config.timeoutMs || 5000;

    return [
        {
            name: 'run_code',
            description: 'Executes JavaScript code in an isolated, secure sandbox. You can use this to perform calculations, data transformations, or logic checks. You MUST return the final result by assigning it to a global variable named `result`, OR by simply logging output. The sandbox captures all console logs and returns them along with the `result` variable.',
            inputSchema: {
                type: 'object',
                properties: {
                    code: { type: 'string', description: 'Raw JavaScript code to execute. Do NOT include markdown codeblocks, just the raw code.' }
                },
                required: ['code']
            },
            handler: async (params: { code: string }) => {
                const logs: string[] = [];
                const errors: string[] = [];

                // Re-route console methods into arrays
                const mockConsole = {
                    log: (...args: any[]) => logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')),
                    error: (...args: any[]) => errors.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')),
                    warn: (...args: any[]) => logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')),
                    info: (...args: any[]) => logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')),
                };

                // The global object inside the sandbox
                const sandboxSandbox: any = {
                    console: mockConsole,
                    result: undefined,
                    setTimeout,
                    clearTimeout,
                    setInterval,
                    clearInterval,
                };

                if (config.allowFetch) {
                    sandboxSandbox.fetch = fetch;
                }

                try {
                    // Create the completely detached context
                    vm.createContext(sandboxSandbox);

                    // Execute with a strict timeout guard to prevent infinite loops (e.g. while(true))
                    const script = new vm.Script(params.code);
                    script.runInContext(sandboxSandbox, { timeout: timeoutMs });

                    return {
                        success: true,
                        result: sandboxSandbox.result,
                        logs: logs.length > 0 ? logs : undefined,
                        errors: errors.length > 0 ? errors : undefined,
                    };

                } catch (err: any) {
                    // Sandbox execution failed (syntax error, runtime error, or timeout)
                    return {
                        success: false,
                        error: err.message || String(err),
                        logs: logs.length > 0 ? logs : undefined,
                        errors: errors.length > 0 ? errors : undefined,
                    };
                }
            }
        }
    ];
}

/**
 * Instantiates a standalone HTTP server exporting the Sandbox MCP over JSON-RPC POST.
 * Agent.run will dynamically fetch and consume this interface if `url` is mapped to this port.
 */
export function serveSandboxMCP(port: number = 3334, config: SandboxConfig = {}): http.Server {
    const tools = createSandboxTools(config);

    const handleRequest = async (req: http.IncomingMessage, res: http.ServerResponse) => {
        if (req.method !== 'POST') {
            res.writeHead(405);
            res.end(JSON.stringify({ error: 'Method not allowed' }));
            return;
        }

        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                const { method, params, id } = data;

                if (method === 'tools/list') {
                    const toolDefinitions = tools.map(t => ({
                        name: t.name,
                        description: t.description,
                        inputSchema: t.inputSchema
                    }));
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ jsonrpc: '2.0', id, result: { tools: toolDefinitions } }));
                    return;
                }

                if (method === 'tools/call') {
                    const toolName = params.name;
                    const toolArgs = params.arguments;

                    const tool = tools.find(t => t.name === toolName);
                    if (!tool) {
                        res.writeHead(404);
                        res.end(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Tool not found' } }));
                        return;
                    }

                    try {
                        const result = await tool.handler(toolArgs);
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({
                            jsonrpc: '2.0',
                            id,
                            result: {
                                content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
                            }
                        }));
                    } catch (err: any) {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({
                            jsonrpc: '2.0',
                            id,
                            result: {
                                isError: true,
                                content: [{ type: 'text', text: `Tool error: ${err.message}` }]
                            }
                        }));
                    }
                    return;
                }

                res.writeHead(400);
                res.end(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32600, message: 'Invalid Request' } }));
            } catch (e: any) {
                res.writeHead(400);
                res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error', details: e.message } }));
            }
        });
    };

    const server = http.createServer(handleRequest);
    server.listen(port, () => {
        console.log(`[gxai] Sandbox MCP tool 'run_code' successfully mounted on port ${port}`);
    });

    return server;
}
