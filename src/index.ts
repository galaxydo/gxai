/**
 * GXAI - AI Agent Framework
 * 
 * This is the main entry point for the modular package.
 * Re-exports all modules for convenience.
 */

// LLM Types (from new modular structure)
export * from './llm/types';

// MCP Types (from new modular structure)  
export * from './mcp/types';

// Agent (from existing structure)
export * from './agent';

// Utils (from existing structure)
export * from './utils';
export * from './xml';

// Gemini multimodal (from new modular structure)
export * from './gemini/multimodal';

// Validation
export * from './validation';

// Types
export * from './types';
