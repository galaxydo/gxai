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
- [ ] **CI integration test with real API** — Add a separate GitHub Actions workflow that runs `test/integration.test.ts` with a real `GEMINI_API_KEY` secret on a schedule (e.g., nightly) to catch provider API changes early.
- [ ] **Provider response format validation** — Add Zod schemas to validate raw LLM API responses before extracting content, to get better error messages when providers change their response format.

## 🟢 Priority: New Features
- [ ] **OpenAI o4-mini reasoning model support** — The `o4-` model prefix is detected but untested with integration tests. Add specific tests for reasoning model parameters (`max_completion_tokens` instead of `max_tokens`).
- [ ] **Multi-turn Agent sessions** — `SessionManager` exists but has no integration test coverage. Add tests for multi-turn conversations with memory persistence.

## 📝 Architecture Notes
- **Core Abstractions**: `Agent` (single-shot/streaming) and `LoopAgent` (iterative tool-use).
- **Inference**: Uses provider-specific APIs with unified streaming output mapped via Zod.
- **Multimodal**: Gemini capabilities (`generateImage`, `generateVideo`, `generateMusic`) integrated directly.
- **Payments**: Auto-pays HTTP 402 responses via Solana (x402 protocol) if a wallet and MCP server are configured.
- **Testing**: Bun-native test runner (`bun test`), 261+ tests across 8+ files.
