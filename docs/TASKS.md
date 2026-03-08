# gx402 — Tasks & Ideas

## 🔴 Priority: Fix
- [x] ~~**Test coverage for LoopAgent**~~ — ✅ DONE. Added `test/loop.test.ts` to test `write_file`, `read_file`, and `exec` tools along with outcome predicate logic, simulating multi-step reasoning natively.
- [x] ~~**Validate Provider API Keys**~~ — ✅ DONE. Explicit API key existence checks have been added for Anthropic, DeepSeek, Google, and OpenAI in `inference.ts`. Additionally, I moved the input `Zod` validation outside of `measure.assert` in `Agent.run` to guarantee early rejection before attempting inference, which also fixed 3 currently failing unit tests.

## 🟡 Priority: Improve
- [x] ~~**Analytics Dashboard Polish**~~ — ✅ DONE. The `sendAnalytics` function in `agent.ts` now uses an offline queue (`~/.gxai/analytics_queue.json`) to persist inference telemetry if the `analyticsUrl` endpoint is unreachable. The queue is automatically flushed on the next successful telemetry request, ensuring no data loss during network outages or dashboard downtime. Tests are running cleanly in `test/analytics.test.ts`.
- [x] ~~**Streaming nested object support**~~ — ✅ DONE. Verified engine perfectly handles arbitrary deep object nesting (> 3 levels) thanks to `tagStack.join("_")` inside the realtime XML progressive chunk parser, and added an explicit recursive boundary mock test in `test/streaming.test.ts` to guarantee it never regresses.

## 🟢 Priority: Features
- [x] ~~**Claude 3.5 Sonnet Support**~~ — ✅ DONE. Explicitly added `claude35Sonnet` and `claude35SonnetLatest` into the global `LLM` exported types. Furthermore, refactored Anthropic inference adapter in `src/inference.ts` to properly segregate the `.find(m => m.role === "system")` prompt out of the `messages` array into the root `system` string parameter as demanded by the Anthropic message API spec.
- [x] ~~**Solana Transaction Retries for 402**~~ — ✅ DONE. Upgraded the static `connection.sendTransaction` logic in `src/payments.ts` to use `measure.retry` wrapping blockhash extraction, submission, and confirmation into one self-repairing chunk that automatically triggers `exponential backoff` (3 attempts, 2-second base delay, 2x scaling per iteration).

## 📝 Architecture Notes
- **Core Abstractions**: `Agent` (single-shot/streaming) and `LoopAgent` (iterative tool-use).
- **Inference**: Uses provider-specific APIs with unified streaming output mapped via Zod.
- **Multimodal**: Gemini capabilities (`generateImage`, `generateVideo`, `generateMusic`) integrated directly.
- **Payments**: Auto-pays HTTP 402 responses via Solana (x402 protocol) if a wallet and MCP server are configured.
- **Testing**: Bun-native test runner (`bun test`).
