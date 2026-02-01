/**
 * Tests for GXAI modular structure
 */
import { describe, test, expect } from 'bun:test';

// LLM Module
import { LLM, isGeminiModel } from './llm/types';

// MCP Module  
import { mcp, type MCPServer, type MCPTool } from './mcp/types';

// Utils (existing structure)
import { validateUrl, generateRequestId } from './utils';
import { objToXml, xmlToObj } from './xml';

// Gemini Module
import { gemini, generateImage, generateVideo, generateMusic, deepResearch } from './gemini/multimodal';

describe('LLM Module', () => {
    test('should export all LLM model IDs', () => {
        expect(LLM['gpt-4o-mini']).toBe('gpt-4o-mini');
        expect(LLM['gemini-2.0-flash']).toBe('gemini-2.0-flash');
        expect(LLM['gemini-2.5-pro']).toBe('gemini-2.5-pro-preview-05-06');
    });

    test('isGeminiModel should correctly identify Gemini models', () => {
        expect(isGeminiModel(LLM['gemini-2.0-flash'])).toBe(true);
        expect(isGeminiModel(LLM['gemini-2.5-pro'])).toBe(true);
        expect(isGeminiModel(LLM['gpt-4o-mini'])).toBe(false);
        expect(isGeminiModel(LLM.claude)).toBe(false);
    });
});

describe('MCP Module', () => {
    test('mcp.server should create valid server config', () => {
        const server = mcp.server({
            name: 'test-server',
            description: 'A test server',
            url: 'http://localhost:8080'
        });

        expect(server.name).toBe('test-server');
        expect(server.description).toBe('A test server');
        expect(server.url).toBe('http://localhost:8080');
    });
});

describe('Utils Module', () => {
    test('validateUrl should accept valid URLs', () => {
        expect(validateUrl('https://example.com')).toBe('https://example.com/');
    });

    test('validateUrl should reject invalid schemes', () => {
        expect(() => validateUrl('ftp://example.com')).toThrow('Invalid scheme');
    });

    test('generateRequestId should return unique IDs', () => {
        const id1 = generateRequestId();
        const id2 = generateRequestId();

        expect(id1).not.toBe(id2);
        expect(id1.length).toBeGreaterThan(5);
    });
});

describe('XML Utils', () => {
    test('objToXml should convert object to XML', () => {
        const obj = { name: 'test', value: 42 };
        const xml = objToXml(obj);

        expect(xml).toContain('<name>test</name>');
        expect(xml).toContain('<value>42</value>');
    });

    test('xmlToObj should parse XML to object', () => {
        const xml = '<name>test</name><value>42</value>';
        const obj = xmlToObj(xml);

        expect(obj.name).toBe('test');
        expect(obj.value).toBe(42); // Should be number now
    });
});

describe('Gemini Module', () => {
    test('should export generateImage function', () => {
        expect(typeof generateImage).toBe('function');
    });

    test('should export generateVideo function', () => {
        expect(typeof generateVideo).toBe('function');
    });

    test('should export generateMusic function', () => {
        expect(typeof generateMusic).toBe('function');
    });

    test('should export deepResearch function', () => {
        expect(typeof deepResearch).toBe('function');
    });

    test('gemini namespace should contain all functions', () => {
        expect(gemini.generateImage).toBe(generateImage);
        expect(gemini.generateVideo).toBe(generateVideo);
        expect(gemini.generateMusic).toBe(generateMusic);
        expect(gemini.deepResearch).toBe(deepResearch);
    });
});
