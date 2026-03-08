/**
 * GXAI - AI Agent Framework
 * 
 * Main entry point. All exports from flat src/*.ts files.
 */

// Core types + LLM helpers + MCP helper
export * from './types';

// Agents
export { Agent } from './agent';
export type { MiddlewareContext, AgentMiddleware, RunEvent, RunEventCallback, StreamChunk } from './agent';

// Sandbox Code Execution
export { createSandboxTools, serveSandboxMCP } from './sandbox';
export type { SandboxConfig } from './sandbox';

// Mocking & Testing
export { AgentMock } from './mock-engine';
export type { AgentMockConfig, MockSequenceItem } from './mock-engine';

// Errors
export { GxaiError, BudgetExceededError, ValidationError, ProviderError, AuthorizationError, MaxIterationsError, TimeoutError } from './errors';

// Inference
export { callLLM, lastTokenUsage, callLLMWithFallback } from './inference';
export type { FallbackConfig } from './inference';

// Cache
export { cachedCallLLM, clearCache, getCacheSize, getCacheStats } from './cache';
export type { CacheConfig } from './cache';

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

// Pricing
export { getModelPricing, calculateCost, estimateInputCost } from './pricing';
export type { ModelPricing, CostEstimate } from './pricing';

// Gemini multimodal
export { gemini, generateImage, generateVideo, generateMusic, deepResearch } from './gemini/multimodal';

// Loop Agent
export { LoopAgent } from './loop';
export type { LoopConfig, LoopOutcome, LoopState, LoopEvent, LoopEventCallback, LoopResult, ToolCall, ToolResult, OutcomeResult } from './loop';

// Conversation Memory
export { ConversationMemory } from './memory';
export type { ConversationMemoryConfig, MemoryMessage } from './memory';

// Audit Log
export { AuditLog, auditLog } from './audit';
export type { AuditEntry, AuditQuery, AuditStats } from './audit';

// Context Window Tracking
export { ContextTracker, getContextWindowSize } from './context';
export type { ContextUsage } from './context';

// Plugin System
export { PluginRegistry } from './plugin';
export type { AgentPlugin } from './plugin';

// OpenTelemetry
export { createOtelCallback } from './otel';
export type { OtelConfig } from './otel';

// Cost Tracking
export { CostTracker, costTracker } from './cost-tracker';
export type { CostRecord, CostSummary } from './cost-tracker';

// Prompt Templates
export { createTemplate, composeTemplates, TEMPLATES } from './templates';
export type { PromptTemplate, TemplateConfig } from './templates';

// Tool Authorization
export { ToolAuthorizer, allowAllTools, onlyTools, blockTools } from './tool-auth';
export type { ToolAuthConfig, ToolAuthDecision } from './tool-auth';

// Retry Strategies
export { linearRetry, exponentialBackoff, fullJitter, noRetry, withRetry } from './retry';
export type { RetryStrategy, RetryConfig } from './retry';

// Event Bus
export { EventBus, globalBus } from './event-bus';
export type { EventHandler, EventMeta, EventBusConfig } from './event-bus';

// Pipeline
export { Pipeline, PipelineError, createPipeline, fanOut } from './pipeline';
export type { PipelineStep, PipelineResult } from './pipeline';

// Health Check
export { healthCheck, formatHealthReport } from './health';
export type { HealthReport } from './health';

// Schema Evolution
export { SchemaEvolutionBuilder, createSchemaEvolution } from './schema-evolution';
export type { Migration, SchemaVersion, SchemaEvolution } from './schema-evolution';

// Middleware Ordering
export { MiddlewareChain } from './middleware-order';
export type { NamedMiddleware, MiddlewareChainResult } from './middleware-order';

// Input Preprocessors
export { chainPreprocessors, trimStrings, validateLength, addTimestamp, stripFields, withDefaults, renameFields, customPreprocessor } from './preprocessors';
export type { Preprocessor } from './preprocessors';

// Rate Limiter
export { RateLimiter } from './rate-limiter';
export type { RateLimiterConfig, RateLimiterStats } from './rate-limiter';

// Context Window
export { ContextWindow } from './context-window';
export type { ContextWindowConfig, ContextMessage, ContextWindowStats } from './context-window';

// Structured Logging
export { StructuredLogger, consoleTransport, jsonTransport, bufferTransport } from './structured-log';
export type { LogLevel, LogRecord, LogTransport, StructuredLoggerConfig } from './structured-log';

// Config Profiles
export { ConfigProfileManager, createProfileManager } from './config-profiles';
export type { ConfigProfile } from './config-profiles';

// Response Cache
export { ResponseCache } from './response-cache';
export type { ResponseCacheConfig, CacheStats } from './response-cache';

// Batch Processor
export { batchProcess, chunk, sequentialProcess } from './batch-processor';
export type { BatchConfig, BatchResult } from './batch-processor';

// Dependency Injection
export { DIContainer } from './di';
export type { Factory, Registration } from './di';

// Output Formatters
export { formatOutput, templateFormatter } from './output-formatters';
export type { OutputFormat, OutputFormatter } from './output-formatters';

// Guardrails
export { Guardrails, maxLengthRule, noPIIRule, blockKeywords, nonEmptyRule } from './guardrails';
export type { GuardrailRule, GuardrailResult, GuardrailViolation, GuardrailAction } from './guardrails';

// Session Manager
export { SessionManager } from './session';
export type { SessionConfig, SessionSnapshot } from './session';

// Prompt Templates V2 (with conditionals & loops)
export { createTemplate as createPromptTemplate, renderTemplate, composeTemplates as composePromptTemplates, systemPrompt, userPrompt } from './prompt-templates';
export type { PromptTemplate as PromptTemplateV2 } from './prompt-templates';

// State Machine
export { StateMachine } from './state-machine';
export type { Transition, StateMachineSnapshot } from './state-machine';

// Long-term Memory (semantic retrieval)
export { ConversationMemory as LongTermMemory } from './conversation-memory';
export type { MemoryEntry, MemoryConfig, SearchResult } from './conversation-memory';

// Tool Registry
export { ToolRegistry } from './tool-registry';
export type { ToolDefinition, ToolInfo } from './tool-registry';

// Pipeline Composer
export { PipelineComposer, compose } from './pipeline-composer';
export type { PipeStep, PipeContext, PipeResult } from './pipeline-composer';

// Metrics Collector
export { MetricsCollector } from './metrics';
export type { MetricStats, MetricEntry } from './metrics';

// Webhook Handler
export { WebhookHandler, hmacSha256, simpleHash } from './webhook';
export type { WebhookConfig, WebhookResult, WebhookMeta } from './webhook';

// Schema Validator
export { string as schemaString, number as schemaNumber, boolean as schemaBoolean, array as schemaArray, object as schemaObject, ObjectSchema } from './schema-validator';
export type { ValidationError as SchemaValidationError, ValidationResult as SchemaValidationResult } from './schema-validator';

// Agent WebSocket Client
export { AgentWebSocketClient } from './websocket-client';
export type { WsClientConfig, JsonRpcRequest, JsonRpcResponse } from './websocket-client';

// File System Tools (MCP)
export { createFileSystemTools, resolveAndValidatePath, serveFileSystemMCP } from './fs-tools';
export type { FileSystemConfig, LocalMCPTool } from './fs-tools';

// Dashboard Web UI
export { serveAgentDashboard } from './dashboard';
export type { DashboardOptions } from './dashboard';
