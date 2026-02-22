/**
 * GXAI - AI Agent Framework
 * 
 * This is the main entry point for the modular package.
 * Re-exports all modules for convenience.
 */

// Core types (canonical source — includes LLM, ProgressUpdate, etc.)
export * from './types';

// MCP Types (MCPServer, MCPTool) 
export { MCPServer, MCPTool } from './mcp/types';

// LLM utilities (isGeminiModel, getLLMBaseUrl, getLLMApiKey)
export { isGeminiModel, getLLMBaseUrl, getLLMApiKey } from './llm/types';

// Agent (from existing structure)
export * from './agent';

// Utils (from existing structure)
export { generateRequestId } from './utils';
export * from './xml';

// Gemini multimodal (from new modular structure)
export * from './gemini/multimodal';

// Validation
export * from './validation';

// Loop Agent (agentic loop with tool use)
export * from './loop';
