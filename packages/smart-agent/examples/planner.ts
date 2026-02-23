// smart-agent e2e — Agent.plan() dynamically generates objectives from user prompt
import { Agent } from "../src"
import { join } from "path"
import { mkdirSync, rmSync, existsSync } from "fs"

const tmpDir = join(import.meta.dir, ".plan-test")
if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true })
mkdirSync(tmpDir, { recursive: true })

console.log("🧠 Planner e2e: Agent.plan() generates objectives dynamically\n")

for await (const event of Agent.plan(
    "Create a file called greeting.txt containing 'Hello from the planner agent!'",
    {
        model: "gemini-2.5-flash",
        cwd: tmpDir,
        maxIterations: 5,
    }
)) {
    switch (event.type) {
        case "planning":
            console.log("📋 Generated objectives:")
            for (const obj of event.objectives) {
                console.log(`   ${obj.type}: ${obj.name} — ${obj.description}`)
                console.log(`   params: ${JSON.stringify(obj.params)}`)
            }
            break
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

// Verify
const resultFile = Bun.file(join(tmpDir, "greeting.txt"))
if (await resultFile.exists()) {
    console.log(`\n📄 greeting.txt: "${await resultFile.text()}"`)
} else {
    console.log("\n❌ greeting.txt was not created!")
}

// Cleanup
rmSync(tmpDir, { recursive: true, force: true })
