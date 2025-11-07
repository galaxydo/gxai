// src/mcp.ts
import { expect, test } from 'bun:test';
import { MCPServer, MCPTool } from './types';
import { measure } from "@ments/utils";
import { fetchWithPayment } from './payments';

export async function discoverTools(server: MCPServer, measureFn: any): Promise<MCPTool[]> {
  return await measureFn(
    async (measure: any) => {
      const response = await fetchWithPayment(
        `${server.url}/tools`,
        {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        },
        measure,
        `HTTP GET ${server.url}/tools`
      );
      const tools = await response.json();
      return await measure(
        async () => tools,
        `Discovered ${tools.length} tools from ${server.name}`
      );
    },
    `Discover tools from ${server.name}`
  );
}

export async function invokeTool(server: MCPServer, toolName: string, parameters: any, measureFn: any): Promise<any> {
  const body = JSON.stringify({ method: toolName, params: parameters });
  return await measureFn(
    async (measure: any) => {
      const response = await fetchWithPayment(
        `${server.url}/call`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        },
        measure,
        `HTTP POST ${server.url}/call - Tool: ${toolName}, Params: ${body.substring(0, 200)}...`
      );
      const result = await response.json();
      return await measure(
        async () => result,
        `Tool ${toolName} returned: ${typeof result === "object" ? JSON.stringify(result).substring(0, 100) + "..." : result}`
      );
    },
    `Invoke ${server.name}.${toolName}`
  );
}

export const mcpServer = (config: Omit<MCPServer, "name"> & { name: string }): MCPServer => config;

if (import.meta.env.NODE_ENV === "test") {
  const { test, expect } = await import('bun:test');
  const { measure } = await import('@ments/utils');

  test('discoverTools mock', async () => {
    const mockFetchWithPayment = async () => new Response(JSON.stringify([{ name: 'tool1', description: 'desc', inputSchema: {} }]));
    const mockMeasure = async (fn: any, desc: string) => fn(mockMeasure);
    const tools = await discoverTools({ name: 'test', description: 'test', url: 'http://test.com' }, mockMeasure);
    expect(tools).toBeArrayOfSize(1);
    expect(tools[0].name).toBe('tool1');
  });

  test('invokeTool mock', async () => {
    const mockFetchWithPayment = async () => new Response(JSON.stringify({ result: 'success' }));
    const mockMeasure = async (fn: any, desc: string) => fn(mockMeasure);
    const result = await invokeTool({ name: 'test', description: 'test', url: 'http://test.com' }, 'tool1', {}, mockMeasure);
    expect(result).toEqual({ result: 'success' });
  });
}
