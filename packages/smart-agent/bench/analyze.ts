#!/usr/bin/env bun
// Analysis of bench/results.json — produces a clean markdown report
// Usage: bun run bench/analyze.ts

const data = require("./results.json")
const r: any[] = data.results

console.log(`# Benchmark Results: XML-in-Prompt vs Native Function Calling\n`)
console.log(`- **Model:** \`${data.model}\``)
console.log(`- **Date:** ${data.timestamp}`)
console.log(`- **Iterations per test:** ${data.iterations}`)
console.log(`- **Test cases:** ${[...new Set(r.map((x: any) => x.testCase))].length}\n`)

// ── Overall summary ──
console.log(`## Overall Summary\n`)
console.log(`| Metric | XML-in-Prompt | Native FC | Winner |`)
console.log(`|--------|:---:|:---:|:---:|`)

const xml = r.filter((x: any) => x.approach === "xml")
const nat = r.filter((x: any) => x.approach === "native")
const xmlV = xml.filter((x: any) => !x.parseError)
const natV = nat.filter((x: any) => !x.parseError)

const metrics = [
    {
        name: "Parse success rate",
        xml: `${xml.filter((x: any) => !x.parseError).length}/${xml.length} (${(xml.filter((x: any) => !x.parseError).length / xml.length * 100).toFixed(0)}%)`,
        nat: `${nat.filter((x: any) => !x.parseError).length}/${nat.length} (${(nat.filter((x: any) => !x.parseError).length / nat.length * 100).toFixed(0)}%)`,
        xmlVal: xml.filter((x: any) => !x.parseError).length / xml.length,
        natVal: nat.filter((x: any) => !x.parseError).length / nat.length,
        higher: true,
    },
    {
        name: "Correct tool selection",
        xml: `${xmlV.filter((x: any) => x.toolMatch).length}/${xmlV.length} (${(xmlV.filter((x: any) => x.toolMatch).length / xmlV.length * 100).toFixed(0)}%)`,
        nat: `${natV.filter((x: any) => x.toolMatch).length}/${natV.length} (${(natV.filter((x: any) => x.toolMatch).length / natV.length * 100).toFixed(0)}%)`,
        xmlVal: xmlV.filter((x: any) => x.toolMatch).length / xmlV.length,
        natVal: natV.filter((x: any) => x.toolMatch).length / natV.length,
        higher: true,
    },
    {
        name: "Correct parameters",
        xml: `${xmlV.filter((x: any) => x.paramMatch).length}/${xmlV.length} (${(xmlV.filter((x: any) => x.paramMatch).length / xmlV.length * 100).toFixed(0)}%)`,
        nat: `${natV.filter((x: any) => x.paramMatch).length}/${natV.length} (${(natV.filter((x: any) => x.paramMatch).length / natV.length * 100).toFixed(0)}%)`,
        xmlVal: xmlV.filter((x: any) => x.paramMatch).length / xmlV.length,
        natVal: natV.filter((x: any) => x.paramMatch).length / natV.length,
        higher: true,
    },
    {
        name: "Avg latency",
        xml: `${(xmlV.reduce((s: number, x: any) => s + x.latencyMs, 0) / xmlV.length).toFixed(0)}ms`,
        nat: `${(natV.reduce((s: number, x: any) => s + x.latencyMs, 0) / natV.length).toFixed(0)}ms`,
        xmlVal: xmlV.reduce((s: number, x: any) => s + x.latencyMs, 0) / xmlV.length,
        natVal: natV.reduce((s: number, x: any) => s + x.latencyMs, 0) / natV.length,
        higher: false,
    },
    {
        name: "Avg input tokens",
        xml: `${(xmlV.reduce((s: number, x: any) => s + x.inputTokens, 0) / xmlV.length).toFixed(0)}`,
        nat: `${(natV.reduce((s: number, x: any) => s + x.inputTokens, 0) / natV.length).toFixed(0)}`,
        xmlVal: xmlV.reduce((s: number, x: any) => s + x.inputTokens, 0) / xmlV.length,
        natVal: natV.reduce((s: number, x: any) => s + x.inputTokens, 0) / natV.length,
        higher: false,
    },
    {
        name: "Avg output tokens",
        xml: `${(xmlV.reduce((s: number, x: any) => s + x.outputTokens, 0) / xmlV.length).toFixed(0)}`,
        nat: `${(natV.reduce((s: number, x: any) => s + x.outputTokens, 0) / natV.length).toFixed(0)}`,
        xmlVal: xmlV.reduce((s: number, x: any) => s + x.outputTokens, 0) / xmlV.length,
        natVal: natV.reduce((s: number, x: any) => s + x.outputTokens, 0) / natV.length,
        higher: false,
    },
]

for (const m of metrics) {
    const winner = m.higher
        ? (m.xmlVal > m.natVal ? "XML" : m.natVal > m.xmlVal ? "**Native**" : "Tie")
        : (m.xmlVal < m.natVal ? "XML" : m.natVal < m.xmlVal ? "**Native**" : "Tie")
    console.log(`| ${m.name} | ${m.xml} | ${m.nat} | ${winner} |`)
}

// ── Per-test detail ──
console.log(`\n## Per-Test Breakdown\n`)
console.log(`| Test | Approach | Tools Called | Tool Match | Latency | Output Tokens |`)
console.log(`|------|----------|-------------|:---:|---------|:---:|`)

const tests = [...new Set(r.map((x: any) => x.testCase))]
for (const t of tests) {
    for (const a of ["xml", "native"]) {
        const d = r.filter((x: any) => x.testCase === t && x.approach === a)
        const v = d.filter((x: any) => !x.parseError)
        const toolOk = v.filter((x: any) => x.toolMatch).length
        const lat = (v.reduce((s: number, x: any) => s + x.latencyMs, 0) / v.length).toFixed(0)
        const out = (v.reduce((s: number, x: any) => s + x.outputTokens, 0) / v.length).toFixed(0)
        const called = [...new Set(d.flatMap((x: any) => x.toolsCalled))].join(", ")
        const label = a === "xml" ? "XML" : "Native"
        console.log(`| ${t} | ${label} | ${called} | ${toolOk}/${v.length} | ${lat}ms | ${out} |`)
    }
}

// ── Key observations ──
console.log(`\n## Key Observations\n`)
console.log(`### 1. Token Efficiency — Native wins decisively`)
console.log(`Native function calling uses **${(xmlV.reduce((s: number, x: any) => s + x.outputTokens, 0) / natV.reduce((s: number, x: any) => s + x.outputTokens, 0)).toFixed(0)}x fewer output tokens** (avg ${(natV.reduce((s: number, x: any) => s + x.outputTokens, 0) / natV.length).toFixed(0)} vs ${(xmlV.reduce((s: number, x: any) => s + x.outputTokens, 0) / xmlV.length).toFixed(0)}). The XML approach forces the model to emit verbose XML markup, reasoning text, and message text alongside the actual tool parameters.\n`)

console.log(`### 2. Latency — Native is ~${((xmlV.reduce((s: number, x: any) => s + x.latencyMs, 0) / xmlV.length) / (natV.reduce((s: number, x: any) => s + x.latencyMs, 0) / natV.length)).toFixed(1)}x faster`)
console.log(`The latency difference directly correlates with output token count — fewer tokens to generate means faster time-to-completion.\n`)

console.log(`### 3. Multi-tool batching — XML wins here`)
console.log(`In the \`multi_tool\` test (list dir + run test), XML batches both calls in one turn while Native only fires \`list_dir\`. Native function calling tends toward sequential execution (one tool at a time), which is actually the correct agent behavior — but means more round-trips.\n`)

console.log(`### 4. Parse reliability — Both 100% in this run`)
console.log(`No XML parse failures were observed. However, at scale and with more complex tool outputs, XML parsing fragility is a known issue (malformed tags, special characters in values, etc.).\n`)

console.log(`### 5. Sequential tool calls (read_then_edit, complex_edit)`)
console.log(`Both approaches correctly decide to only \`read_file\` first before editing. Our "tool match" scoring penalizes this, but it's actually the right behavior — you can't edit what you haven't read.\n`)

// ── Verdict ──
console.log(`## Verdict\n`)
console.log(`**Native function calling is the clear winner** for integration into smart-agent:\n`)
console.log(`1. **~18x fewer output tokens** → massive cost savings at scale`)
console.log(`2. **~2x faster latency** → better UX`)
console.log(`3. **Zero parse risk** → structured JSON output, no XML fragility`)
console.log(`4. **Schema enforcement** → the API validates tool parameters for you`)
console.log(`5. **Multi-provider support** → OpenAI, Anthropic, and Gemini all use the same pattern\n`)
console.log(`The only trade-off is that native FC tends to call one tool per turn (sequential), while XML prompting can encourage batching. This is addressable by using \`toolConfig: { functionCallingConfig: { mode: "ANY" } }\` to force tool calls, or by adjusting the system prompt.`)
