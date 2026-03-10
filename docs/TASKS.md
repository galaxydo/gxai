# gx402 — Tasks & Ideas

## 🟡 Priority: Improve
- [x] **README test count outdated** — Updated: 84 → 285 tests, 559 expect() calls.
- [x] **Export list incomplete** — Updated: added 40+ new modules to Full Export List section.
- [x] **Duplicate module concepts** — Analyzed: they are complementary, not duplicates. `cache.ts` wraps callLLM, `response-cache.ts` is generic. `pipeline.ts` is simple chaining, `pipeline-composer.ts` adds hooks. `memory.ts` is chat history, `conversation-memory.ts` is knowledge store. Updated all doc headers with cross-references.
- [x] **Version bump** — v2.0.0 released. CHANGELOG.md created with 11 new features, docs updates, and type fixes documented.

## 🟢 Priority: Features
- [x] ~~**Integration test suite**~~ — ✅ DONE. 30 integration tests across 10 describe blocks: callLLM (all 4 providers), Agent.run() with Zod schemas, streaming with field extraction, middleware, cost estimation, LoopAgent with real tool execution, runStream async generator, token usage tracking, system prompts, and error handling. All gated behind env vars (`OPENAI_API_KEY`, `GEMINI_API_KEY`, etc.) — skip gracefully when keys not set. Total suite: 303 tests, 559 expect() calls.
- [x] **CLI improvements** — Added `--health` (checks runtime, deps, API keys, analytics queue), `--version`/`-v` (prints version+runtime+platform). Updated help text with examples.
- [x] **npm publish automation** — GitHub Actions workflow (`.github/workflows/publish.yml`). On `v*` tag push: install deps → run tests → publish with provenance to npm. Requires `NPM_TOKEN` secret.

## 🟡 Priority: Improve
- [x] ~~**CI integration test with real API**~~ — ✅ DONE. Created `integration.yml` workflow: nightly at 03:00 UTC + manual trigger, gated by `HAS_INTEGRATION_KEYS` repo variable, uses `GEMINI_API_KEY` secret. Also fixed `ci.yml` — removed `|| true` that was swallowing all test failures. Pushed to master.
- [x] ~~**Provider response format validation**~~ — ✅ DONE. Added `OpenAIResponseSchema`, `AnthropicResponseSchema`, `GeminiResponseSchema` Zod schemas. `validateProviderResponse()` replaces inline optional chaining — now gives descriptive errors when providers change formats. Also fixed silent empty-string bug: switched `measure()` to `measure.assert()` for non-streaming path. 7 new inline tests. Total: 310 tests, 567 expect() calls.

## 🟢 Priority: New Features
- [x] ~~**OpenAI o4-mini reasoning model support**~~ — ✅ DONE. 3 inline tests verifying `max_completion_tokens` (not `max_tokens`), forced `temperature: 1.0`, and response parsing. 2 integration tests (non-streaming + streaming with field extraction) gated behind `OPENAI_API_KEY`. Total: 315 tests, 575 expect() calls.
- [x] ~~**Multi-turn Agent sessions**~~ — N/A. `SessionManager` is a standalone utility (not wired into Agent). Already has 5 unit tests covering set/get, snapshot, serialize/restore, has/delete, and expiration. No integration test needed — it doesn't hit LLM APIs.

## 🟢 Priority: Backlog
- [x] ~~**Wire SessionManager into Agent**~~ — ✅ DONE. Added optional `session` field to AgentConfig. Agent auto-restores ConversationMemory from session on first run, auto-saves memory + usage + lastRunAt after each successful run. Non-fatal error handling. 3 new tests. Total: 323 tests, 593 expect() calls.
- [x] ~~**Response caching in callLLM**~~ — ✅ Already existed as `cachedCallLLM()` in `cache.ts`, exported from index. Added 5 inline tests: cache hit/miss, streaming bypass, TTL expiry, clearCache, different-input isolation. Total: 320 tests, 586 expect() calls.
- [x] ~~**npm version bump + publish**~~ — ✅ DONE. Published gx402@2.1.0 to npm.
- [x] ~~**LoopAgent checkpoint persistence**~~ — ✅ DONE. Added optional `session` field to LoopConfig. `LoopAgent.fromSession()` restores iteration state from SessionManager. `saveCheckpoint()` writes to both file and session (coexist). `removeCheckpoint()` clears session on success, sets `completedAt`. 4 new tests. Total: 327 tests, 603 expect() calls.
- [x] ~~**Vision / image input**~~ — ✅ DONE. Messages now accept optional `images: ImageContent[]` for multimodal content. Per-provider conversion: OpenAI uses `image_url` content parts (URL or data URI), Anthropic uses `image` source blocks (base64 or URL), Gemini uses `inlineData` parts. DeepSeek strips images silently. Helper constructors: `imageFromUrl()`, `imageFromBase64()`, `imageFromFile()`. Backwards compatible — text-only messages unchanged. 4 new tests. Total: 331 tests, 617 expect() calls.
- [x] ~~**Gemini structured output**~~ — ✅ DONE. When Agent uses a Gemini model, the Zod output schema is now converted to Gemini's `responseSchema` in `generationConfig` with `responseMimeType: 'application/json'`. This gives reliable JSON parsing matching OpenAI's JSON mode. Agent response parsing updated to JSON.parse for Gemini (was XML-only). 1 new test. Total: 332 tests, 620 expect() calls.
- [x] ~~**Gemini streaming**~~ — ✅ DONE. Gemini now uses `:streamGenerateContent?alt=sse` when `streamingCallback` is provided. SSE chunks parsed for text deltas + usage metadata. Previously Gemini silently ignored streaming requests. 2 new tests verifying URL routing and delta delivery. Total: 334 tests, 631 expect() calls.

## 📝 Architecture Notes
- **Core Abstractions**: `Agent` (single-shot/streaming) and `LoopAgent` (iterative tool-use).
- **Inference**: Uses provider-specific APIs with unified streaming output mapped via Zod.
- **Multimodal**: Gemini capabilities (`generateImage`, `generateVideo`, `generateMusic`) integrated directly.
- **Payments**: Auto-pays HTTP 402 responses via Solana (x402 protocol) if a wallet and MCP server are configured.
- **Testing**: Bun-native test runner (`bun test`), 334 tests across 14 files, 631 expect() calls.
