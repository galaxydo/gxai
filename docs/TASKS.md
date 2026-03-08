# gx402 — Tasks & Ideas

## 🟡 Priority: Improve
- [ ] **README test count outdated** — README says "84 tests, 0 failures" but the actual count is 261+. Update the badge and test section.
- [ ] **Export list incomplete** — README's "Full Export List" section only covers ~30 exports, but 40+ new modules were added (EventBus, Pipeline, Guardrails, etc.). Update to reflect full API surface.
- [ ] **Duplicate module concepts** — `src/cache.ts` and `src/response-cache.ts` overlap, as do `src/pipeline.ts` and `src/pipeline-composer.ts`, and `src/memory.ts` and `src/conversation-memory.ts`. Consolidate or clearly differentiate.
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
