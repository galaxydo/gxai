// Example: Agent with custom tools — web fetcher + JSON transformer
// Shows how to extend smart-agent with your own tools
import { Agent } from "../src"
import type { Tool } from "../src"
import { join } from "path"
import { mkdirSync, rmSync, existsSync } from "fs"

const dir = join(import.meta.dir, ".custom-tools")
if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })

// ── Custom tool: fetch a URL ──
const fetchTool: Tool = {
    name: "http_get",
    description: "Fetch a URL and return its text content (max 5000 chars)",
    parameters: {
        url: { type: "string", description: "URL to fetch", required: true },
    },
    execute: async (params) => {
        try {
            const res = await fetch(params.url, {
                headers: { "User-Agent": "smart-agent/0.1" },
                signal: AbortSignal.timeout(10000),
            })
            if (!res.ok) return { success: false, output: "", error: `HTTP ${res.status}` }
            const text = await res.text()
            return { success: true, output: text.substring(0, 5000) }
        } catch (e: any) {
            return { success: false, output: "", error: e.message }
        }
    },
}

// ── Custom tool: parse and transform JSON ──
const jsonTransformTool: Tool = {
    name: "json_transform",
    description: "Parse JSON text, apply a jq-like path to extract fields. Path uses dot notation: 'items.0.name' or 'count'",
    parameters: {
        json: { type: "string", description: "JSON string to parse", required: true },
        path: { type: "string", description: "Dot-notation path to extract (e.g. 'data.items')", required: false },
    },
    execute: async (params) => {
        try {
            let obj = JSON.parse(params.json)
            if (params.path) {
                for (const key of params.path.split(".")) {
                    obj = obj?.[isNaN(Number(key)) ? key : Number(key)]
                }
            }
            return { success: true, output: JSON.stringify(obj, null, 2).substring(0, 3000) }
        } catch (e: any) {
            return { success: false, output: "", error: e.message }
        }
    },
}

const agent = new Agent({
    model: "gemini-2.5-flash",
    cwd: dir,
    maxIterations: 5,
    tools: [fetchTool, jsonTransformTool],
    objectives: [
        {
            name: "report_saved",
            description: "Save a markdown report file summarizing the fetched data",
            validate: async () => {
                const f = Bun.file(join(dir, "report.md"))
                if (!(await f.exists())) return { met: false, reason: "report.md doesn't exist yet" }
                const text = await f.text()
                if (text.length < 100) return { met: false, reason: "Report too short" }
                return { met: true, reason: "Report file saved" }
            },
        },
    ],
})

console.log("🌐 Custom Tools: fetch data from an API and generate a report\n")

for await (const event of agent.run(
    "Fetch https://api.github.com/repos/oven-sh/bun and create a report.md with: repo name, description, stars, language, license, and latest topics. Format it nicely in markdown."
)) {
    switch (event.type) {
        case "iteration_start":
            console.log(`\n── Iteration ${event.iteration} ──`)
            break
        case "thinking":
            console.log(`💭 ${event.message.substring(0, 200)}`)
            break
        case "tool_start":
            console.log(`🔧 ${event.tool}(${JSON.stringify(event.params).substring(0, 100)})`)
            break
        case "tool_result":
            console.log(`   ${event.result.success ? "✓" : "✗"} ${event.result.output.substring(0, 150)}`)
            break
        case "objective_check":
            for (const r of event.results) console.log(`   ${r.met ? "✅" : "❌"} ${r.name}: ${r.reason}`)
            break
        case "complete":
            console.log(`\n🎉 Done in ${event.iteration + 1} iterations`)
            break
    }
}

const report = await Bun.file(join(dir, "report.md")).text()
console.log("\n📄 Generated report:\n" + report)

rmSync(dir, { recursive: true, force: true })
