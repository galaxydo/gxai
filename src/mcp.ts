// src/mcp.ts
import { measure } from "measure-fn";
import type { MCPServer, MCPTool } from './types';
import { fetchWithPayment } from './payments';

export async function discoverTools(server: MCPServer): Promise<MCPTool[]> {
  return await measure(`Discover tools from ${server.name}`, async (m) => {
    const response = await fetchWithPayment(
      `${server.url}/tools`,
      { method: "GET", headers: { "Content-Type": "application/json" } },
      `HTTP GET ${server.url}/tools`
    );
    const tools = await response.json() as MCPTool[];
    return tools;
  }) ?? [];
}

export async function invokeTool(server: MCPServer, toolName: string, parameters: any): Promise<any> {
  const body = JSON.stringify({ method: toolName, params: parameters });
  return await measure(`Invoke ${server.name}.${toolName}`, async () => {
    const response = await fetchWithPayment(
      `${server.url}/call`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body },
      `HTTP POST ${server.url}/call — ${toolName}`
    );
    return await response.json();
  });
}

export const mcpServer = (config: Omit<MCPServer, "name"> & { name: string }): MCPServer => config;

if (import.meta.env.NODE_ENV === "test") {
  const { test, expect } = await import('bun:test');

  test('discoverTools mock', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(JSON.stringify([{ name: 'tool1', description: 'desc', inputSchema: {} }])) as any;
    try {
      const tools = await discoverTools({ name: 'test', description: 'test', url: 'https://test.com' });
      expect(tools).toBeArrayOfSize(1);
      expect(tools[0].name).toBe('tool1');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('invokeTool mock', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ result: 'success' })) as any;
    try {
      const result = await invokeTool({ name: 'test', description: 'test', url: 'https://test.com' }, 'tool1', {});
      expect(result).toEqual({ result: 'success' });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}
