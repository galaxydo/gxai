/**
 * Tests for GXAI main module
 */
import { describe, test, expect } from 'bun:test';
import {
    Agent,
    LLM,
    mcp,
    gemini,
    generateImage,
    generateVideo,
    generateMusic,
    deepResearch
} from './main';
import { z } from 'zod';

describe('LLM Definitions', () => {
    test('should have all expected LLM providers', () => {
        expect(LLM['gpt-4o-mini']).toBe('gpt-4o-mini');
        expect(LLM.gpt4o).toBe('gpt-4o');
        expect(LLM.claude).toBe('claude-3-sonnet-20240229');
        expect(LLM.deepseek).toBe('deepseek-chat');
        expect(LLM['gemini-2.0-flash']).toBe('gemini-2.0-flash');
        expect(LLM['gemini-2.5-pro']).toBe('gemini-2.5-pro-preview-05-06');
    });
});

describe('Agent Class', () => {
    test('should create an agent with input/output schemas', () => {
        const inputSchema = z.object({
            query: z.string().describe('The user query'),
        });

        const outputSchema = z.object({
            answer: z.string().describe('The response'),
        });

        const agent = new Agent({
            llm: LLM['gemini-2.0-flash'],
            inputFormat: inputSchema,
            outputFormat: outputSchema,
            systemPrompt: 'You are a helpful assistant.',
        });

        expect(agent).toBeDefined();
        expect(agent.run).toBeDefined();
        expect(typeof agent.run).toBe('function');
    });

    test('should support custom temperature and maxTokens', () => {
        const agent = new Agent({
            llm: LLM['gpt-4o-mini'],
            inputFormat: z.object({ text: z.string() }),
            outputFormat: z.object({ result: z.string() }),
            temperature: 0.7,
            maxTokens: 1000,
        });

        expect(agent).toBeDefined();
    });
});

describe('MCP Helper', () => {
    test('should create server config', () => {
        const server = mcp.server({
            name: 'test-server',
            description: 'A test MCP server',
            url: 'http://localhost:8080',
        });

        expect(server.name).toBe('test-server');
        expect(server.description).toBe('A test MCP server');
        expect(server.url).toBe('http://localhost:8080');
    });
});

describe('Gemini Multimodal Exports', () => {
    test('should export generateImage function', () => {
        expect(generateImage).toBeDefined();
        expect(typeof generateImage).toBe('function');
    });

    test('should export generateVideo function', () => {
        expect(generateVideo).toBeDefined();
        expect(typeof generateVideo).toBe('function');
    });

    test('should export generateMusic function', () => {
        expect(generateMusic).toBeDefined();
        expect(typeof generateMusic).toBe('function');
    });

    test('should export deepResearch function', () => {
        expect(deepResearch).toBeDefined();
        expect(typeof deepResearch).toBe('function');
    });

    test('should export gemini namespace with all functions', () => {
        expect(gemini).toBeDefined();
        expect(gemini.generateImage).toBe(generateImage);
        expect(gemini.generateVideo).toBe(generateVideo);
        expect(gemini.generateMusic).toBe(generateMusic);
        expect(gemini.deepResearch).toBe(deepResearch);
    });
});
