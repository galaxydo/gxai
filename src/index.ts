/**
 * GXAI - AI Agent Framework
 * 
 * Main entry point. All exports from flat src/*.ts files.
 */

// Core types + LLM helpers + MCP helper
export * from './types';

// Agents
export { Agent } from './agent';

// Inference
export { callLLM } from './inference';

// MCP
export { discoverTools, invokeTool } from './mcp';

// Payments
export { fetchWithPayment } from './payments';

// XML
export { objToXml, xmlToObj } from './xml';

// Validation
export { validateUrl, validateNoArrays, getSchemaTypeName } from './validation';

// Utils
export { generateRequestId } from './utils';

// Gemini multimodal
export { gemini, generateImage, generateVideo, generateMusic, deepResearch } from './gemini/multimodal';

// Loop Agent
export * from './loop';
