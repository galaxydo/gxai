// smart-agent e2e — multi-iteration: scaffold a project, write tests, make them pass
import { Agent } from "../src"
import { join } from "path"
import { mkdirSync, rmSync, existsSync } from "fs"

const tmpDir = join(import.meta.dir, ".scaffold-test")
if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true })
mkdirSync(tmpDir, { recursive: true })

const agent = new Agent({
    model: "gemini-3-flash-preview",
    cwd: tmpDir,
    skills: [join(import.meta.dir, "../skills/bun.yaml")],
    maxIterations: 8,
    objectives: [
        {
            name: "has_package_json",
            description: "Create a package.json for a TypeScript project using Bun",
            validate: async () => {
                const f = Bun.file(join(tmpDir, "package.json"))
                if (!(await f.exists())) return { met: false, reason: "package.json missing" }
                return { met: true, reason: "package.json exists" }
            },
        },
        {
            name: "has_source_file",
            description: "Create src/add.ts exporting a function: export function add(a: number, b: number): number",
            validate: async () => {
                const f = Bun.file(join(tmpDir, "src/add.ts"))
                if (!(await f.exists())) return { met: false, reason: "src/add.ts missing" }
                const content = await f.text()
                if (!content.includes("export function add")) return { met: false, reason: "add function not exported" }
                return { met: true, reason: "src/add.ts with add() exists" }
            },
        },
        {
            name: "has_tests",
            description: "Create src/add.test.ts with tests: add(1,2)===3, add(-1,1)===0, add(0,0)===0",
            validate: async () => {
                const f = Bun.file(join(tmpDir, "src/add.test.ts"))
                if (!(await f.exists())) return { met: false, reason: "src/add.test.ts missing" }
                const content = await f.text()
                if (!content.includes("expect")) return { met: false, reason: "No expect() calls found" }
                return { met: true, reason: "Test file with assertions exists" }
            },
        },
        {
            name: "tests_pass",
            description: "Run 'bun test' and ensure all tests pass with exit code 0",
            validate: (state) => {
                const lastExec = state.toolHistory.findLast(
                    t => t.tool === "exec" && t.params.command?.includes("bun test")
                )
                if (!lastExec) return { met: false, reason: "No 'bun test' execution found yet" }
                return {
                    met: lastExec.result.success,
                    reason: lastExec.result.success ? "Tests passed" : `Tests failed: ${lastExec.result.error}`,
                }
            },
        },
    ],
})

console.log("🚀 Multi-iteration e2e: scaffold project + write tests + make them pass\n")

for await (const event of agent.run(
    "Create a minimal TypeScript project with a add(a,b) function and tests. Make sure tests pass."
)) {
    switch (event.type) {
        case "iteration_start":
            console.log(`\n── Iteration ${event.iteration} (${event.elapsed}ms) ──`)
            break
        case "thinking":
            console.log(`💭 ${event.message.substring(0, 200)}`)
            break
        case "tool_start":
            console.log(`🔧 ${event.tool}(${JSON.stringify(event.params).substring(0, 150)})`)
            break
        case "tool_result":
            const icon = event.result.success ? "✓" : "✗"
            console.log(`   ${icon} ${event.result.output.substring(0, 200)}`)
            break
        case "objective_check":
            for (const r of event.results) {
                console.log(`   ${r.met ? "✅" : "❌"} ${r.name}: ${r.reason}`)
            }
            break
        case "complete":
            console.log(`\n🎉 Complete in ${event.iteration + 1} iterations (${event.elapsed}ms)`)
            break
        case "error":
            console.log(`❌ Error: ${event.error.substring(0, 300)}`)
            break
        case "max_iterations":
            console.log(`⚠️ Max iterations reached`)
            break
    }
}

// Cleanup
rmSync(tmpDir, { recursive: true, force: true })
