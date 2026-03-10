# gx402

[![npm version](https://badge.fury.io/js/gx402.svg)](https://badge.fury.io/js/gx402)
[![Bun](https://img.shields.io/badge/Bun-tested-blueviolet)](https://bun.sh/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/tests-343%20pass-brightgreen)](https://bun.sh/)

**Agentic AI framework for TypeScript.** Structured I/O via Zod, real-time streaming, multi-provider LLM support, tool orchestration via MCP, automatic Solana x402 payments, and production-grade safeguards — all in a single package.

## Why gx402?

- **Structured I/O** — Zod schemas for input validation and output parsing. Type-safe end-to-end.
- **4 LLM Providers** — OpenAI, Anthropic, Google Gemini, DeepSeek. Switch models with one line.
- **Streaming** — Token-by-token field updates with progressive content building.
- **LoopAgent** — Self-healing iterative agent with built-in file/exec tools and outcome predicates.
- **MCP Tool Orchestration** — Auto-discover and invoke tools from MCP servers with parallel execution.
- **Cost Controls** — Per-model pricing, budget guards, token tracking, and cost estimation.
- **Production Safeguards** — Middleware hooks, audit logging, retry with backoff, response caching, fallback chains.
- **Multimodal** — Gemini image/video/music generation and deep research built-in.
- **x402 Payments** — Auto-pay HTTP 402 responses via Solana when calling paid APIs.

## Installation

```bash
npm install gx402 zod
```

Set your provider API key:

```bash
export OPENAI_API_KEY=sk-...      # OpenAI
export GEMINI_API_KEY=...          # Google Gemini
export ANTHROPIC_API_KEY=...       # Anthropic
export DEEPSEEK_API_KEY=...        # DeepSeek
```

### Supported Models

| Provider | Models | Env Variable |
|----------|--------|--------------|
| OpenAI | `gpt-4o-mini`, `gpt-4o`, `gpt-4`, `o4-mini-*` | `OPENAI_API_KEY` |
| Google | `gemini-2.0-flash`, `gemini-2.5-pro` | `GEMINI_API_KEY` |
| Anthropic | `claude-3-sonnet`, `claude-3-5-sonnet` | `ANTHROPIC_API_KEY` |
| DeepSeek | `deepseek-chat` | `DEEPSEEK_API_KEY` |

## Quick Start

```typescript
import { z } from 'zod';
import { Agent } from 'gx402';

const agent = new Agent({
  llm: 'gpt-4o-mini',
  inputFormat: z.object({ question: z.string() }),
  outputFormat: z.object({
    answer: z.string().describe('The answer'),
    confidence: z.string().describe('high, medium, or low'),
  }),
});

const result = await agent.run(
  { question: 'What causes aurora borealis?' },
  (update) => {
    if (update.stage === 'streaming') {
      console.log(`${update.field}: ${update.value}`);
    }
  }
);

console.log(result.answer);     // "Aurora borealis is caused by..."
console.log(result.confidence); // "high"
```

## Agent API

### Constructor

```typescript
new Agent<I, O>(config: AgentConfig<I, O>)
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `llm` | `string` | required | Model identifier |
| `inputFormat` | `ZodObject` | required | Input validation schema |
| `outputFormat` | `ZodObject` | required | Output parsing schema |
| `name` | `string` | `'unnamed-agent'` | Agent name for logging/analytics |
| `temperature` | `number` | `0.5` | Sampling temperature |
| `maxTokens` | `number` | `4000` | Max response tokens |
| `systemPrompt` | `string` | auto | Custom system prompt |
| `maxCostUSD` | `number` | — | Budget guard: reject if estimated cost exceeds |
| `memory` | `ConversationMemory` | — | Multi-turn conversation memory |
| `servers` | `MCPServer[]` | — | MCP servers for tool discovery |
| `solanaWallet` | `object` | — | Solana wallet for x402 payments |
| `analyticsUrl` | `string` | — | Endpoint for telemetry |

### `agent.run(input, callback?)`

Execute the agent. Returns parsed output matching `outputFormat`.

```typescript
const result = await agent.run(input, (update) => {
  // update.stage: 'starting' | 'streaming' | 'completing' | 'error'
  // For streaming: update.field, update.value (grows token-by-token)
});
```

### `agent.runBatch(inputs, options?)`

Process multiple inputs in parallel with concurrency control.

```typescript
const { results, errors } = await agent.runBatch(
  [{ question: 'Q1' }, { question: 'Q2' }, { question: 'Q3' }],
  { concurrency: 5 }
);
// results: successful outputs, errors: { input, error }[]
```

### `agent.runWithRetry(input, options?)`

Retry with exponential backoff on failure. Smart non-retry for budget/validation/parse errors.

```typescript
const result = await agent.runWithRetry(input, {
  maxRetries: 3,
  retryDelayMs: 1000,
  maxDelayMs: 30000,
});
```

### `agent.clone(overrides?)`

Create a variant with different config. Middleware is preserved.

```typescript
const creative = agent.clone({ temperature: 0.9 });
const precise = agent.clone({ temperature: 0.1, llm: 'gemini-2.5-pro' });
```

### `agent.estimateCost(input, estimatedOutputTokens?)`

Estimate USD cost before running.

```typescript
const estimate = agent.estimateCost(input, 2000);
console.log(estimate.totalCost); // 0.001234 USD
```

### `agent.use(middleware)`

Register lifecycle hooks. Chainable.

```typescript
agent
  .use(async (ctx) => {
    if (ctx.phase === 'before') console.log('Starting:', ctx.agentName);
    if (ctx.phase === 'after') console.log(`Done in ${ctx.durationMs}ms, cost: $${ctx.cost?.totalCost}`);
    if (ctx.phase === 'error') console.error('Failed:', ctx.error);
  })
  .use(async (ctx) => {
    // Multiple middleware execute in registration order
  });
```

## LoopAgent — Iterative Tool Use

Self-healing agentic loop with built-in tools and outcome predicates.

```typescript
import { LoopAgent } from 'gx402';

const loop = new LoopAgent({
  llm: 'gemini-2.0-flash',
  maxIterations: 10,
  outcomes: [
    {
      description: 'A working hello.ts script exists',
      validate: async (state) => {
        const exists = await Bun.file('./hello.ts').exists();
        return { met: exists, reason: exists ? 'File exists' : 'Not found' };
      },
    },
  ],
});

const result = await loop.execute('Create a TypeScript hello world script', (event) => {
  if (event.type === 'tool_start') console.log(`🔧 ${event.tool}`);
  if (event.type === 'complete') console.log(`✨ Done in ${event.iteration + 1} iterations`);
});
```

### Built-in Tools

| Tool | Description |
|------|-------------|
| `write_file(path, content)` | Write file (auto-creates directories) |
| `read_file(path)` | Read file (truncated to 10KB) |
| `exec(command)` | Run shell command (cross-platform) |

### SSE Streaming

Stream LoopAgent events as Server-Sent Events for dashboard integration:

```typescript
// In an API route handler:
return loop.createSSEResponse('Build a REST API');
// Returns Response with text/event-stream, JSON-encoded LoopEvents
```

### Checkpointing

Persist loop state to disk for crash recovery:

```typescript
const loop = new LoopAgent({
  // ...config
  checkpointPath: './checkpoints/my-task.json',
});

// Resume from checkpoint:
const resumed = LoopAgent.fromCheckpoint('./checkpoints/my-task.json', config);
```

### State Serialization

```typescript
const json = loop.state.toJSON(); // { iteration, toolHistory, ... }
const restored = LoopAgent.fromJSON(json, config);
```

### Session Persistence

Persist loop state via SessionManager (alternative to file checkpoints):

```typescript
import { LoopAgent, SessionManager } from 'gx402';

const session = new SessionManager();
const loop = new LoopAgent({
  llm: 'gpt-4o-mini',
  session,
  // ...config
});

// State auto-saved to session after each iteration
await loop.execute('Build a script');

// Resume from session:
const resumed = LoopAgent.fromSession(session, config);
```

## Vision / Image Input

Send images to vision-capable models (GPT-4o, Gemini, Claude):

```typescript
import { callLLM, imageFromUrl, imageFromBase64, imageFromFile } from 'gx402';

// From URL
const result = await callLLM('gpt-4o', [
  { role: 'user', content: 'What is in this image?', images: [imageFromUrl('https://example.com/photo.jpg')] }
]);

// From base64
const b64 = '...';
await callLLM('gemini-2.0-flash', [
  { role: 'user', content: 'Describe this', images: [imageFromBase64(b64, 'image/png')] }
]);

// From local file
await callLLM('claude-3-5-sonnet-20241022', [
  { role: 'user', content: 'Analyze', images: [imageFromFile('./screenshot.png')] }
]);

// Multiple images
await callLLM('gpt-4o', [
  { role: 'user', content: 'Compare these two images', images: [
    imageFromUrl('https://example.com/before.jpg'),
    imageFromUrl('https://example.com/after.jpg'),
  ]}
]);
```

Images are automatically converted to each provider's native format. Text-only messages work exactly as before.

## Cost Controls

### Budget Guard

Reject runs that exceed a cost threshold:

```typescript
const agent = new Agent({
  llm: 'gpt-4o',
  maxCostUSD: 0.05, // Max 5 cents per run
  // ...schemas
});

try {
  await agent.run(largeInput); // Throws BudgetExceededError if estimate > $0.05
} catch (e) {
  if (e instanceof BudgetExceededError) {
    console.log(`Too expensive: $${e.estimatedCost} > $${e.maxCostUSD}`);
  }
}
```

### Token Tracking

```typescript
await agent.run(input);
console.log(agent.lastUsage);  // { inputTokens, outputTokens, totalTokens }
console.log(agent.lastCost);   // { inputCost, outputCost, totalCost, currency: 'USD' }
```

### Pricing API

```typescript
import { getModelPricing, calculateCost, estimateInputCost } from 'gx402';

getModelPricing('gpt-4o-mini');        // { inputPerMillion: 0.15, outputPerMillion: 0.60 }
calculateCost('gpt-4o-mini', usage);   // { inputCost, outputCost, totalCost, currency }
estimateInputCost('gpt-4o', 10000);    // Estimate from character count (~4 chars/token)
```

## Conversation Memory

Multi-turn interactions with automatic pruning:

```typescript
import { ConversationMemory, Agent } from 'gx402';

const memory = new ConversationMemory({ maxTurns: 20, systemMessage: 'You are helpful' });

const agent = new Agent({
  llm: 'gpt-4o-mini',
  memory,
  // ...schemas
});

// Each run() auto-appends input/output to memory
await agent.run({ question: 'What is TypeScript?' });
await agent.run({ question: 'How does it compare to JavaScript?' }); // Remembers previous turn
```

## Response Cache

In-memory LRU cache to save cost on repeated inputs:

```typescript
import { cachedCallLLM, clearCache, getCacheStats } from 'gx402';

const response = await cachedCallLLM('gpt-4o-mini', messages, options, {
  ttlMs: 300_000,  // 5 minute TTL
  maxEntries: 100, // LRU eviction
});

getCacheStats(); // { size: 42, keys: [...] }
clearCache();    // Reset
```

## Provider Fallback

Automatically try backup providers on failure:

```typescript
import { callLLMWithFallback } from 'gx402';

const response = await callLLMWithFallback(
  {
    providers: ['gpt-4o-mini', 'gemini-2.0-flash', 'deepseek-chat'],
    onFallback: (from, to, error) => console.warn(`Falling back: ${from} → ${to}`),
  },
  messages,
  options
);
```

## Error Handling

Structured error hierarchy for programmatic handling:

```typescript
import {
  BudgetExceededError,  // estimatedCost, maxCostUSD, model
  ValidationError,      // zodErrors
  ProviderError,        // provider, statusCode, retryable
  AuthorizationError,   // tool, server
  MaxIterationsError,   // iterations
} from 'gx402';

try {
  await agent.run(input);
} catch (e) {
  if (e instanceof ProviderError && e.retryable) {
    // 429 rate limit or 5xx — safe to retry
  }
  if (e instanceof ValidationError) {
    console.log('Schema mismatch:', e.zodErrors);
  }
}
```

## Audit Log

Track every tool authorization decision:

```typescript
import { auditLog } from 'gx402';

// Automatically populated during agent.run() when tools have authorize hooks
const entries = auditLog.getEntries({ decision: 'deny', limit: 10 });
const stats = auditLog.getStats();
// { totalEntries: 150, allowCount: 142, denyCount: 8, deniedTools: { 'web.exec': 5 } }
```

## Gemini Multimodal

First-class Gemini capabilities:

```typescript
import { gemini } from 'gx402';

// Image generation (Imagen 4)
const images = await gemini.generateImage({
  prompt: 'A futuristic city at sunset',
  aspectRatio: '16:9',
  imageSize: '2K',
});

// Video generation (Veo 3.1)
const video = await gemini.generateVideo({
  prompt: 'A drone flying over mountains',
  videoResolution: '1080p',
  onProgress: (status) => console.log(status),
});

// Music generation (Lyria)
const music = await gemini.generateMusic({
  prompt: 'Upbeat electronic with synth leads',
  bpm: 128,
  durationSeconds: 30,
});

// Deep Research
const research = await gemini.deepResearch({
  query: 'Latest advances in quantum computing',
  onProgress: (status) => console.log(status),
});
```

## x402 Payments

Auto-pay MCP servers requiring Solana payments:

```typescript
const agent = new Agent({
  llm: 'gpt-4o-mini',
  solanaWallet: {
    privateKey: process.env.SOLANA_PRIVATE_KEY!,
    rpcUrl: 'https://api.mainnet-beta.solana.com',
    allowedRecipients: ['recipient-pubkey'], // Optional whitelist
  },
  servers: [{ name: 'paid-api', description: 'Premium data', url: 'https://api.example.com' }],
  // ...schemas
});
// When a server returns HTTP 402, gx402 auto-sends SOL and retries with exponential backoff
```

## Analytics

Built-in telemetry with offline queue:

```typescript
const agent = new Agent({
  analyticsUrl: 'http://localhost:3001/api/record',
  // ...config
});
// Each run() records: timing, I/O, tool invocations, token usage, cost, success/failure
// Offline queue persists to ~/.gxai/analytics_queue.json and auto-flushes
```

View queued analytics: `bun run analytics` or `gx --analytics`

## Testing

```bash
bun test   # 343 tests, 0 failures, 657 expect() calls
```

## Full Export List

```typescript
// Agents
Agent, LoopAgent

// Testing & Mocking
AgentMock

// Errors
GxaiError, BudgetExceededError, ValidationError, ProviderError,
AuthorizationError, MaxIterationsError, TimeoutError

// Inference
callLLM, callLLMWithFallback, lastTokenUsage

// Cache
cachedCallLLM, clearCache, getCacheSize, getCacheStats
ResponseCache

// Pricing
getModelPricing, calculateCost, estimateInputCost

// Memory
ConversationMemory, LongTermMemory

// Audit
AuditLog, auditLog

// MCP
discoverTools, invokeTool

// Payments
fetchWithPayment

// Multimodal
gemini, generateImage, generateVideo, generateMusic, deepResearch

// Tool Orchestration
ToolAuthorizer, allowAllTools, onlyTools, blockTools
ToolRegistry

// Pipeline & Composition
Pipeline, createPipeline, fanOut
PipelineComposer, compose

// Multi-Agent
AgentSwarm

// State Machine
StateMachine

// Prompt Templates
createTemplate, composeTemplates, TEMPLATES
createPromptTemplate, renderTemplate, composePromptTemplates, systemPrompt, userPrompt

// Middleware & Preprocessors
MiddlewareChain
chainPreprocessors, trimStrings, validateLength, addTimestamp, stripFields,
withDefaults, renameFields, customPreprocessor

// Guardrails
Guardrails, maxLengthRule, noPIIRule, blockKeywords, nonEmptyRule

// Context & Sessions
ContextTracker, getContextWindowSize
ContextWindow
SessionManager

// Retry & Rate Limiting
linearRetry, exponentialBackoff, fullJitter, noRetry, withRetry
RateLimiter

// Event Bus
EventBus, globalBus

// Observability
CostTracker, costTracker
MetricsCollector
StructuredLogger, consoleTransport, jsonTransport, bufferTransport
createOtelCallback
healthCheck, formatHealthReport

// Batch Processing
batchProcess, chunk, sequentialProcess

// Configuration
ConfigProfileManager, createProfileManager

// Dependency Injection
DIContainer

// Schema
SchemaEvolutionBuilder, createSchemaEvolution
schemaString, schemaNumber, schemaBoolean, schemaArray, schemaObject

// Output
formatOutput, templateFormatter

// Networking
WebhookHandler, hmacSha256, simpleHash
AgentWebSocketClient

// Sandbox
createSandboxTools, serveSandboxMCP

// File System Tools
createFileSystemTools, resolveAndValidatePath, serveFileSystemMCP

// Dashboard
serveAgentDashboard

// Plugin System
PluginRegistry

// Utilities
objToXml, xmlToObj, validateUrl, validateNoArrays, getSchemaTypeName,
generateRequestId
```

## License

MIT. See [LICENSE](LICENSE).

Built with ❤️ for structured AI workflows. Questions? Ping `@galaxydoxyz` on X.
