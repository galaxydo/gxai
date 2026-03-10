# Changelog

## [2.17.0] — 2026-03-10

### ⚡ Improvements

- **Options-object API for `callLLM`** — `streaming`, `progress`, and `customFetch` can now be passed as fields on the options object instead of positional params. Eliminates the `callLLM(model, msgs, opts, null, undefined, cb, fetch)` pattern. Old positional params still work (backwards compatible, marked `@deprecated`). All internal call sites migrated.
- **Streaming token usage fallback** — Both Gemini and OpenAI/Claude streaming paths now estimate token usage via character-count heuristic (~4 chars/token) when providers omit usage metadata from SSE chunks. Prevents silent null `lastTokenUsage` that broke cost tracking.

### 🔧 Fixes

- **`callLLMWithFallback` signal/timeout** — Options type now includes `signal` and `timeoutMs`, matching `callLLM`. Previously these were silently dropped through the fallback chain.

### 📊 Tests

- 354 tests, 684 expect() calls across 14 files (up from 349/670).

---

## [2.0.0] — 2026-03-09

### ⚡ New Features

- **Agent Global ToolAuthorizer** — Centralized tool authorization via `AgentConfig.toolAuthorizer`. Denied tools are gracefully logged without throwing errors, enabling sandboxed execution policies.
- **Agent Swarm Orchestrator** — Multi-agent coordination with `createSwarm()` for parallel fan-out and sequential handoff patterns. Includes native local tool hooks for agent-to-agent communication.
- **Isolated Code Sandbox** — MCP-based sandboxed code execution tool (`sandbox_eval`) with configurable timeout and memory limits.
- **Anthropic Prompt Caching** — Automatic cache point injection for Anthropic models, reducing input token costs by up to 90% for repeated system prompts.
- **Deterministic Mock Engine** — `MockEngine` for unit testing agents without hitting real LLM APIs. Supports canned responses, assertion hooks, and streaming simulation.
- **WebSocket MCP Multiplexing** — `fetchWithPayment` now supports WebSocket-based MCP connections for persistent, low-latency tool invocations.
- **Parallel Tool Execution** — `LoopAgent` can now execute multiple independent tool calls simultaneously, improving throughput for multi-tool workflows.
- **Advanced Tool Auth Hooks** — Per-tool `authorize` lifecycle hooks with tool-level audit logging and `LoopAgent` serialization/deserialization.
- **x402 Server Identity Validation** — Spoofing prevention for x402 payment flows. Validates server identity before signing Solana transactions.
- **CLI Offline Analytics** — `gx --analytics` now works offline, reading from local analytics queue files.
- **OpenAI Native Structured Output** — Uses OpenAI's `response_format` parameter for native JSON mode, improving output reliability.

### 📝 Documentation

- Clarified 6 "duplicate" module pairs as complementary (cache vs response-cache, pipeline vs pipeline-composer, memory vs conversation-memory) with cross-references.
- Updated README: 285 tests, 559 expect() calls, full export list with 40+ modules.

### 🔧 Fixes

- Strict-mode type safety across `xml.ts`, `validation.ts`, and other modules (22 type errors resolved).

---

## [1.5.1] — 2026-03-01

- Previous release (see git history for details).
