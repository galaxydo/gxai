# Benchmark Results: XML-in-Prompt vs Native Function Calling

- **Model:** `gemini-2.5-flash`
- **Date:** 2026-02-23T14:20:10.421Z
- **Iterations per test:** 3
- **Test cases:** 5

## Overall Summary

| Metric | XML-in-Prompt | Native FC | Winner |
|--------|:---:|:---:|:---:|
| Parse success rate | 15/15 (100%) | 15/15 (100%) | Tie |
| Correct tool selection | 9/15 (60%) | 6/15 (40%) | XML |
| Correct parameters | 15/15 (100%) | 15/15 (100%) | Tie |
| Avg latency | 2856ms | 1311ms | **Native** |
| Avg input tokens | 431 | 384 | **Native** |
| Avg output tokens | 389 | 22 | **Native** |

## Per-Test Breakdown

| Test | Approach | Tools Called | Tool Match | Latency | Output Tokens |
|------|----------|-------------|:---:|---------|:---:|
| simple_write | XML | write_file | 3/3 | 1581ms | 132 |
| simple_write | Native | write_file | 3/3 | 1122ms | 23 |
| read_then_edit | XML | read_file | 0/3 | 1754ms | 141 |
| read_then_edit | Native | read_file | 0/3 | 1609ms | 19 |
| multi_tool | XML | list_dir, exec | 3/3 | 1668ms | 173 |
| multi_tool | Native | list_dir | 0/3 | 1092ms | 15 |
| search_and_read | XML | search, read_file | 3/3 | 7448ms | 1337 |
| search_and_read | Native | search, read_file | 3/3 | 1345ms | 36 |
| complex_edit | XML | read_file | 0/3 | 1832ms | 159 |
| complex_edit | Native | read_file | 0/3 | 1389ms | 19 |

## Key Observations

### 1. Token Efficiency — Native wins decisively
Native function calling uses **17x fewer output tokens** (avg 22 vs 389). The XML approach forces the model to emit verbose XML markup, reasoning text, and message text alongside the actual tool parameters.

### 2. Latency — Native is ~2.2x faster
The latency difference directly correlates with output token count — fewer tokens to generate means faster time-to-completion.

### 3. Multi-tool batching — XML wins here
In the `multi_tool` test (list dir + run test), XML batches both calls in one turn while Native only fires `list_dir`. Native function calling tends toward sequential execution (one tool at a time), which is actually the correct agent behavior — but means more round-trips.

### 4. Parse reliability — Both 100% in this run
No XML parse failures were observed. However, at scale and with more complex tool outputs, XML parsing fragility is a known issue (malformed tags, special characters in values, etc.).

### 5. Sequential tool calls (read_then_edit, complex_edit)
Both approaches correctly decide to only `read_file` first before editing. Our "tool match" scoring penalizes this, but it's actually the right behavior — you can't edit what you haven't read.

## Verdict

**Native function calling is the clear winner** for integration into smart-agent:

1. **~18x fewer output tokens** → massive cost savings at scale
2. **~2x faster latency** → better UX
3. **Zero parse risk** → structured JSON output, no XML fragility
4. **Schema enforcement** → the API validates tool parameters for you
5. **Multi-provider support** → OpenAI, Anthropic, and Gemini all use the same pattern

The only trade-off is that native FC tends to call one tool per turn (sequential), while XML prompting can encourage batching. This is addressable by using `toolConfig: { functionCallingConfig: { mode: "ANY" } }` to force tool calls, or by adjusting the system prompt.
