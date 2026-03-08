# gx402 — Tasks & Ideas

## 🟡 Priority: Improve
- [x] **README test count outdated** — Updated: 84 → 285 tests, 559 expect() calls.
- [x] **Export list incomplete** — Updated: added 40+ new modules to Full Export List section.
- [x] **Duplicate module concepts** — Analyzed: they are complementary, not duplicates. `cache.ts` wraps callLLM, `response-cache.ts` is generic. `pipeline.ts` is simple chaining, `pipeline-composer.ts` adds hooks. `memory.ts` is chat history, `conversation-memory.ts` is knowledge store. Updated all doc headers with cross-references.
- [ ] **Version bump** — Many new features added since v1.5.1. Prep a v2.0.0 release with updated changelog.

## 🟢 Priority: Features
- [ ] **Integration test suite** — Current tests are unit-only. Add integration tests that hit real LLM APIs (gated behind env vars) to verify end-to-end flows.
- [ ] **CLI improvements** — `gx` CLI only supports `--analytics`. Add `--health` (runs healthCheck), `--version`, and `--dashboard` commands.
- [ ] **npm publish automation** — Add GitHub Actions workflow for automated npm publishing on tag push.

## 📝 Architecture Notes
- **Core Abstractions**: `Agent` (single-shot/streaming) and `LoopAgent` (iterative tool-use).
- **Inference**: Uses provider-specific APIs with unified streaming output mapped via Zod.
- **Multimodal**: Gemini capabilities (`generateImage`, `generateVideo`, `generateMusic`) integrated directly.
- **Payments**: Auto-pays HTTP 402 responses via Solana (x402 protocol) if a wallet and MCP server are configured.
- **Testing**: Bun-native test runner (`bun test`), 261+ tests across 8+ files.
