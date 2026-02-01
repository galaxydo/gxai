/**
 * Geeksy Core - Unified exports
 */

// New v2 Architecture
export * from './core/schemas';
export * from './core/auth-manager';
export * from './core/contact-manager';
export * from './core/agent-manager';
export * from './core/job-executor';

// Legacy (backwards compatibility)
export * from './core/message-bus';
export * from './core/agent-registry';
export * from './core/activity-stream';
export * from './core/response-channel';
export * from './core/job-manager';
export * from './core/channel-manager';
export * from './core/orchestrator';
export * from './core/builtin-agents';
export * from './core/onboarding';

// Server
export * from './server';
