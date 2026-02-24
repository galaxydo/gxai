#!/usr/bin/env bun
// Benchmark: XML-in-prompt vs Native Function Calling
//
// Tests both approaches on identical tasks and compares:
//   1. Reliability — does the response always parse correctly?
//   2. Latency — time to first useful response
//   3. Token usage — input/output tokens consumed
//   4. Correctness — are the right tools called with right params?
//
// Usage: GEMINI_API_KEY=xxx bun run bench/tool-calling.ts

import { xmlToObj } from "../src/xml"

// ── Tool definitions (shared by both approaches) ──

const TOOLS = [
    {
        name: "read_file",
        description: "Read the contents of a file at the given path",
        parameters: {
            type: "object" as const,
            properties: {
                path: { type: "string", description: "Absolute or relative path to the file" },
            },
            required: ["path"],
        },
    },
    {
        name: "write_file",
        description: "Write content to a file, creating it if it doesn't exist",
        parameters: {
            type: "object" as const,
            properties: {
                path: { type: "string", description: "Path to write the file" },
                content: { type: "string", description: "Content to write" },
            },
            required: ["path", "content"],
        },
    },
    {
        name: "exec",
        description: "Execute a shell command and return its output",
        parameters: {
            type: "object" as const,
            properties: {
                command: { type: "string", description: "The command to execute" },
            },
            required: ["command"],
        },
    },
    {
        name: "edit_file",
        description: "Replace a specific string in a file with new content",
        parameters: {
            type: "object" as const,
            properties: {
                path: { type: "string", description: "Path to the file" },
                search: { type: "string", description: "Exact string to find" },
                replace: { type: "string", description: "Replacement string" },
            },
            required: ["path", "search", "replace"],
        },
    },
    {
        name: "list_dir",
        description: "List files and directories at the given path",
        parameters: {
            type: "object" as const,
            properties: {
                path: { type: "string", description: "Directory path to list" },
            },
            required: ["path"],
        },
    },
    {
        name: "search",
        description: "Search for files matching a pattern using glob syntax",
        parameters: {
            type: "object" as const,
            properties: {
                pattern: { type: "string", description: "Glob pattern (e.g. **/*.ts)" },
                path: { type: "string", description: "Directory to search in" },
            },
            required: ["pattern"],
        },
    },
]

// ── Test cases — each has a prompt and expected tool calls ──

interface TestCase {
    name: string
    prompt: string
    expectedTools: string[] // tool names that should be invoked
    expectedParams: Record<string, string>[] // key params to verify
}

const TEST_CASES: TestCase[] = [
    {
        name: "simple_write",
        prompt: "Create a file called hello.txt with the content 'Hello World'",
        expectedTools: ["write_file"],
        expectedParams: [{ path: "hello.txt", content: "Hello World" }],
    },
    {
        name: "read_then_edit",
        prompt: "Read src/utils.ts and then replace console.log with logger.info in it",
        expectedTools: ["read_file", "edit_file"],
        expectedParams: [
            { path: "src/utils.ts" },
            { path: "src/utils.ts", search: "console.log", replace: "logger.info" },
        ],
    },
    {
        name: "multi_tool",
        prompt: "List the files in the src directory, then run bun test",
        expectedTools: ["list_dir", "exec"],
        expectedParams: [
            { path: "src" },
            { command: "bun test" },
        ],
    },
    {
        name: "search_and_read",
        prompt: "Find all TypeScript files in src/ and read the package.json",
        expectedTools: ["search", "read_file"],
        expectedParams: [
            { pattern: "**/*.ts" },
            { path: "package.json" },
        ],
    },
    {
        name: "complex_edit",
        prompt: `The file src/app.ts has a bug. Read it, then fix the bug by replacing the line:
const result = a + b;
with:
const result = Number(a) + Number(b);`,
        expectedTools: ["read_file", "edit_file"],
        expectedParams: [
            { path: "src/app.ts" },
            { search: "const result = a + b;", replace: "const result = Number(a) + Number(b);" },
        ],
    },
]

// ── Approach A: XML-in-prompt ──

function buildXMLSystemPrompt(): string {
    const toolDescriptions = TOOLS
        .map(t => {
            const params = Object.entries(t.parameters.properties)
                .map(([name, p]: [string, any]) => `    - ${name} (${p.type}): ${p.description}`)
                .join("\n")
            return `  ${t.name}: ${t.description}\n    Parameters:\n${params}`
        })
        .join("\n\n")

    return `You are an autonomous agent that works toward objectives using tools.
You operate in a loop: analyze state → invoke tools → repeat until all objectives are met.

AVAILABLE TOOLS:
${toolDescriptions}

RESPONSE FORMAT (XML):
<response>
  <message>What you're doing and why</message>
  <tool_invocations>
    <invocation>
      <tool>tool_name</tool>
      <params>
        <param_name>value</param_name>
      </params>
      <reasoning>Why this tool call</reasoning>
    </invocation>
  </tool_invocations>
</response>

RULES:
1. Use available tools to make progress toward objectives
2. You can invoke multiple tools per turn
3. Be precise with file paths and command syntax`
}

interface ParsedToolCall {
    tool: string
    params: Record<string, any>
}

function parseXMLResponse(raw: string): { message: string; tools: ParsedToolCall[]; parseError: boolean } {
    try {
        const parsed = xmlToObj(raw)
        const root = parsed.response || parsed
        const tools: ParsedToolCall[] = []

        const toolSection = root.tool_invocations
        if (toolSection) {
            const invocations = toolSection.invocation
                ? (Array.isArray(toolSection.invocation) ? toolSection.invocation : [toolSection.invocation])
                : []
            for (const inv of invocations) {
                const params: Record<string, any> = {}
                if (inv.params && typeof inv.params === "object") {
                    for (const [k, v] of Object.entries(inv.params)) {
                        params[k] = v
                    }
                }
                tools.push({ tool: String(inv.tool || ""), params })
            }
        }
        return { message: String(root.message || ""), tools, parseError: false }
    } catch {
        return { message: "", tools: [], parseError: true }
    }
}

// ── Approach B: Native Function Calling ──

function buildNativeFunctionDeclarations() {
    return TOOLS.map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
    }))
}

function parseNativeResponse(data: any): { message: string; tools: ParsedToolCall[]; parseError: boolean } {
    const tools: ParsedToolCall[] = []
    let message = ""

    const parts = data.candidates?.[0]?.content?.parts || []
    for (const part of parts) {
        if (part.text) message += part.text
        if (part.functionCall) {
            tools.push({
                tool: part.functionCall.name,
                params: part.functionCall.args || {},
            })
        }
    }

    return { message, tools, parseError: false }
}

// ── Load config ──

function loadApiKey(): string {
    // 1. Env vars
    if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY
    if (process.env.GOOGLE_API_KEY) return process.env.GOOGLE_API_KEY

    // 2. .config.toml
    try {
        const toml = require("fs").readFileSync(
            require("path").resolve(__dirname, "../.config.toml"), "utf-8"
        )
        const match = toml.match(/api_key\s*=\s*"([^"]+)"/)
        if (match) return match[1]
    } catch { }

    console.error("No API key found. Set GEMINI_API_KEY, GOOGLE_API_KEY, or add to .config.toml")
    process.exit(1)
}

const API_KEY = loadApiKey()

const MODEL = process.env.BENCH_MODEL || "gemini-2.5-flash"

async function callGeminiXML(prompt: string): Promise<{
    raw: string
    parsed: ReturnType<typeof parseXMLResponse>
    latencyMs: number
    inputTokens: number
    outputTokens: number
}> {
    const systemPrompt = buildXMLSystemPrompt()
    const body = {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: { temperature: 0.1, maxOutputTokens: 4000 },
    }

    const start = performance.now()
    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": API_KEY },
            body: JSON.stringify(body),
        },
    )
    const data = await res.json() as any
    const latencyMs = performance.now() - start

    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || ""
    const usage = data.usageMetadata || {}

    return {
        raw,
        parsed: parseXMLResponse(raw),
        latencyMs,
        inputTokens: usage.promptTokenCount || 0,
        outputTokens: usage.candidatesTokenCount || 0,
    }
}

async function callGeminiNative(prompt: string): Promise<{
    raw: any
    parsed: ReturnType<typeof parseNativeResponse>
    latencyMs: number
    inputTokens: number
    outputTokens: number
}> {
    const body = {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        systemInstruction: { parts: [{ text: "You are an autonomous coding agent. Use the available tools to accomplish the user's request. You can invoke multiple tools in a single turn." }] },
        tools: [{ functionDeclarations: buildNativeFunctionDeclarations() }],
        toolConfig: { functionCallingConfig: { mode: "AUTO" } },
        generationConfig: { temperature: 0.1, maxOutputTokens: 4000 },
    }

    const start = performance.now()
    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": API_KEY },
            body: JSON.stringify(body),
        },
    )
    const data = await res.json() as any
    const latencyMs = performance.now() - start

    const usage = data.usageMetadata || {}

    return {
        raw: data,
        parsed: parseNativeResponse(data),
        latencyMs,
        inputTokens: usage.promptTokenCount || 0,
        outputTokens: usage.candidatesTokenCount || 0,
    }
}

// ── Scoring ──

function scoreToolCalls(
    actual: ParsedToolCall[],
    expectedTools: string[],
    expectedParams: Record<string, string>[],
): { toolMatch: boolean; paramMatch: boolean; details: string } {
    const actualToolNames = actual.map(t => t.tool)

    // Check if all expected tools are present (order doesn't matter)
    const toolMatch = expectedTools.every(et => actualToolNames.includes(et))

    // Check if key params are present with matching values
    let paramMatchCount = 0
    let totalParams = 0
    const details: string[] = []

    for (let i = 0; i < expectedParams.length; i++) {
        const expected = expectedParams[i]
        const expectedTool = expectedTools[i]
        const actualCall = actual.find(a => a.tool === expectedTool)

        for (const [key, expectedValue] of Object.entries(expected)) {
            totalParams++
            const actualValue = String(actualCall?.params?.[key] || "")
            // Flexible match — the actual value should contain the expected value
            if (actualValue.includes(expectedValue) || expectedValue.includes(actualValue)) {
                paramMatchCount++
            } else {
                details.push(`${expectedTool}.${key}: expected "${expectedValue}" got "${actualValue}"`)
            }
        }
    }

    const paramMatch = totalParams > 0 ? paramMatchCount >= totalParams * 0.7 : true
    return { toolMatch, paramMatch, details: details.join("; ") || "OK" }
}

// ── Run benchmark ──

const ITERATIONS = parseInt(process.env.BENCH_ITERATIONS || "3")

interface BenchResult {
    approach: "xml" | "native"
    testCase: string
    iteration: number
    latencyMs: number
    inputTokens: number
    outputTokens: number
    parseError: boolean
    toolMatch: boolean
    paramMatch: boolean
    toolsCalled: string[]
    details: string
}

async function runBenchmark() {
    console.log(`\n${"═".repeat(70)}`)
    console.log(`  BENCHMARK: XML-in-prompt vs Native Function Calling`)
    console.log(`  Model: ${MODEL} | Iterations: ${ITERATIONS} | Tests: ${TEST_CASES.length}`)
    console.log(`${"═".repeat(70)}\n`)

    const results: BenchResult[] = []
    const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

    for (const tc of TEST_CASES) {
        console.log(`\n── Test: ${tc.name} ──`)
        console.log(`   Prompt: "${tc.prompt.substring(0, 80)}..."`)
        console.log(`   Expected: [${tc.expectedTools.join(", ")}]\n`)

        for (let iter = 0; iter < ITERATIONS; iter++) {
            // ── XML approach ──
            try {
                const xmlResult = await callGeminiXML(tc.prompt)
                const xmlScore = scoreToolCalls(xmlResult.parsed.tools, tc.expectedTools, tc.expectedParams)
                results.push({
                    approach: "xml",
                    testCase: tc.name,
                    iteration: iter,
                    latencyMs: xmlResult.latencyMs,
                    inputTokens: xmlResult.inputTokens,
                    outputTokens: xmlResult.outputTokens,
                    parseError: xmlResult.parsed.parseError,
                    toolMatch: xmlScore.toolMatch,
                    paramMatch: xmlScore.paramMatch,
                    toolsCalled: xmlResult.parsed.tools.map(t => t.tool),
                    details: xmlScore.details,
                })
                console.log(`   [xml  #${iter + 1}] ${xmlResult.latencyMs.toFixed(0)}ms | tokens: ${xmlResult.inputTokens}→${xmlResult.outputTokens} | tools: [${xmlResult.parsed.tools.map(t => t.tool).join(",")}] | parse:${xmlResult.parsed.parseError ? "✗" : "✓"} | match:${xmlScore.toolMatch ? "✓" : "✗"} | params:${xmlScore.paramMatch ? "✓" : "✗"}`)
                if (xmlScore.details !== "OK") console.log(`           ${xmlScore.details}`)
            } catch (e: any) {
                console.log(`   [xml  #${iter + 1}] ERROR: ${e.message}`)
                results.push({
                    approach: "xml", testCase: tc.name, iteration: iter,
                    latencyMs: 0, inputTokens: 0, outputTokens: 0,
                    parseError: true, toolMatch: false, paramMatch: false,
                    toolsCalled: [], details: e.message,
                })
            }

            // Small delay to avoid rate limit
            await delay(500)

            // ── Native approach ──
            try {
                const nativeResult = await callGeminiNative(tc.prompt)
                const nativeScore = scoreToolCalls(nativeResult.parsed.tools, tc.expectedTools, tc.expectedParams)
                results.push({
                    approach: "native",
                    testCase: tc.name,
                    iteration: iter,
                    latencyMs: nativeResult.latencyMs,
                    inputTokens: nativeResult.inputTokens,
                    outputTokens: nativeResult.outputTokens,
                    parseError: nativeResult.parsed.parseError,
                    toolMatch: nativeScore.toolMatch,
                    paramMatch: nativeScore.paramMatch,
                    toolsCalled: nativeResult.parsed.tools.map(t => t.tool),
                    details: nativeScore.details,
                })
                console.log(`   [natv #${iter + 1}] ${nativeResult.latencyMs.toFixed(0)}ms | tokens: ${nativeResult.inputTokens}→${nativeResult.outputTokens} | tools: [${nativeResult.parsed.tools.map(t => t.tool).join(",")}] | parse:✓ | match:${nativeScore.toolMatch ? "✓" : "✗"} | params:${nativeScore.paramMatch ? "✓" : "✗"}`)
                if (nativeScore.details !== "OK") console.log(`           ${nativeScore.details}`)
            } catch (e: any) {
                console.log(`   [natv #${iter + 1}] ERROR: ${e.message}`)
                results.push({
                    approach: "native", testCase: tc.name, iteration: iter,
                    latencyMs: 0, inputTokens: 0, outputTokens: 0,
                    parseError: true, toolMatch: false, paramMatch: false,
                    toolsCalled: [], details: e.message,
                })
            }

            await delay(500)
        }
    }

    // ── Aggregate results ──
    console.log(`\n${"═".repeat(70)}`)
    console.log(`  RESULTS SUMMARY`)
    console.log(`${"═".repeat(70)}\n`)

    for (const approach of ["xml", "native"] as const) {
        const data = results.filter(r => r.approach === approach)
        const valid = data.filter(r => !r.parseError)

        const avgLatency = valid.length > 0 ? valid.reduce((s, r) => s + r.latencyMs, 0) / valid.length : 0
        const avgInputTokens = valid.length > 0 ? valid.reduce((s, r) => s + r.inputTokens, 0) / valid.length : 0
        const avgOutputTokens = valid.length > 0 ? valid.reduce((s, r) => s + r.outputTokens, 0) / valid.length : 0
        const parseSuccessRate = data.length > 0 ? (data.filter(r => !r.parseError).length / data.length * 100) : 0
        const toolMatchRate = valid.length > 0 ? (valid.filter(r => r.toolMatch).length / valid.length * 100) : 0
        const paramMatchRate = valid.length > 0 ? (valid.filter(r => r.paramMatch).length / valid.length * 100) : 0

        const label = approach === "xml" ? "XML-in-prompt" : "Native function calling"
        console.log(`  ${label}:`)
        console.log(`    Parse success: ${parseSuccessRate.toFixed(0)}% (${data.filter(r => !r.parseError).length}/${data.length})`)
        console.log(`    Tool match:    ${toolMatchRate.toFixed(0)}% (${valid.filter(r => r.toolMatch).length}/${valid.length})`)
        console.log(`    Param match:   ${paramMatchRate.toFixed(0)}% (${valid.filter(r => r.paramMatch).length}/${valid.length})`)
        console.log(`    Avg latency:   ${avgLatency.toFixed(0)}ms`)
        console.log(`    Avg tokens:    ${avgInputTokens.toFixed(0)} input → ${avgOutputTokens.toFixed(0)} output`)
        console.log()
    }

    // ── Per-test comparison ──
    console.log(`  Per-test breakdown:`)
    console.log(`  ${"─".repeat(66)}`)
    console.log(`  ${"Test".padEnd(20)} ${"Approach".padEnd(10)} ${"Parse".padEnd(7)} ${"Tools".padEnd(7)} ${"Params".padEnd(7)} ${"Latency".padEnd(10)} ${"Tokens"}`)
    console.log(`  ${"─".repeat(66)}`)

    for (const tc of TEST_CASES) {
        for (const approach of ["xml", "native"] as const) {
            const data = results.filter(r => r.testCase === tc.name && r.approach === approach)
            const valid = data.filter(r => !r.parseError)
            const parseOk = data.filter(r => !r.parseError).length
            const toolOk = valid.filter(r => r.toolMatch).length
            const paramOk = valid.filter(r => r.paramMatch).length
            const avgLat = valid.length > 0 ? valid.reduce((s, r) => s + r.latencyMs, 0) / valid.length : 0
            const avgOut = valid.length > 0 ? valid.reduce((s, r) => s + r.outputTokens, 0) / valid.length : 0

            const label = approach === "xml" ? "xml" : "native"
            console.log(`  ${tc.name.padEnd(20)} ${label.padEnd(10)} ${(parseOk + "/" + data.length).padEnd(7)} ${(toolOk + "/" + valid.length).padEnd(7)} ${(paramOk + "/" + valid.length).padEnd(7)} ${(avgLat.toFixed(0) + "ms").padEnd(10)} ${avgOut.toFixed(0)}`)
        }
    }

    // ── Verdict ──
    const xmlData = results.filter(r => r.approach === "xml" && !r.parseError)
    const nativeData = results.filter(r => r.approach === "native" && !r.parseError)

    const xmlScore = {
        parse: results.filter(r => r.approach === "xml" && !r.parseError).length / results.filter(r => r.approach === "xml").length,
        tools: xmlData.filter(r => r.toolMatch).length / Math.max(xmlData.length, 1),
        params: xmlData.filter(r => r.paramMatch).length / Math.max(xmlData.length, 1),
        latency: xmlData.reduce((s, r) => s + r.latencyMs, 0) / Math.max(xmlData.length, 1),
        tokens: xmlData.reduce((s, r) => s + r.outputTokens, 0) / Math.max(xmlData.length, 1),
    }
    const nativeScore = {
        parse: results.filter(r => r.approach === "native" && !r.parseError).length / results.filter(r => r.approach === "native").length,
        tools: nativeData.filter(r => r.toolMatch).length / Math.max(nativeData.length, 1),
        params: nativeData.filter(r => r.paramMatch).length / Math.max(nativeData.length, 1),
        latency: nativeData.reduce((s, r) => s + r.latencyMs, 0) / Math.max(nativeData.length, 1),
        tokens: nativeData.reduce((s, r) => s + r.outputTokens, 0) / Math.max(nativeData.length, 1),
    }

    console.log(`\n  ${"─".repeat(66)}`)
    console.log(`  VERDICT:`)

    const wins = { xml: 0, native: 0 }
    const compare = (metric: string, xmlVal: number, nativeVal: number, lowerIsBetter = false) => {
        const xmlBetter = lowerIsBetter ? xmlVal < nativeVal : xmlVal > nativeVal
        const winner = xmlBetter ? "xml" : "native"
        wins[winner]++
        const arrow = xmlBetter ? "←" : "→"
        console.log(`    ${metric.padEnd(16)} xml: ${xmlVal.toFixed(1).padStart(8)} | native: ${nativeVal.toFixed(1).padStart(8)}  ${arrow} ${winner}`)
    }

    compare("Parse rate %", xmlScore.parse * 100, nativeScore.parse * 100)
    compare("Tool match %", xmlScore.tools * 100, nativeScore.tools * 100)
    compare("Param match %", xmlScore.params * 100, nativeScore.params * 100)
    compare("Latency ms", xmlScore.latency, nativeScore.latency, true)
    compare("Output tokens", xmlScore.tokens, nativeScore.tokens, true)

    const overall = wins.xml > wins.native ? "XML-in-prompt" : wins.native > wins.xml ? "Native function calling" : "TIE"
    console.log(`\n  🏆 Winner: ${overall} (${wins.xml} vs ${wins.native} metrics won)`)
    console.log()

    // Save raw results
    const outPath = "bench/results.json"
    await Bun.write(outPath, JSON.stringify({ model: MODEL, iterations: ITERATIONS, timestamp: new Date().toISOString(), results }, null, 2))
    console.log(`  Raw results saved to ${outPath}`)
}

runBenchmark().catch(console.error)
