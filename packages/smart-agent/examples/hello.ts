// smart-agent e2e test — creates a hello.txt file using Gemini 3
import { Agent } from "../src"

const agent = new Agent({
    model: "gemini-3-flash-preview",
    cwd: import.meta.dir,
    objectives: [{
        name: "file_created",
        description: "Create a file called hello.txt containing exactly 'Hello World'",
        validate: async (state) => {
            const file = Bun.file(`${import.meta.dir}/hello.txt`)
            if (!(await file.exists())) return { met: false, reason: "hello.txt does not exist yet" }
            const content = await file.text()
            if (content.trim() === "Hello World") return { met: true, reason: "File exists with correct content" }
            return { met: false, reason: `File exists but content is: "${content.trim()}"` }
        }
    }],
    maxIterations: 5,
})

console.log("Starting smart-agent e2e test...\n")

for await (const event of agent.run("Create a file called hello.txt with the text 'Hello World' in it")) {
    switch (event.type) {
        case "iteration_start":
            console.log(`\n── Iteration ${event.iteration} (${event.elapsed}ms) ──`)
            break
        case "thinking":
            console.log(`💭 ${event.message}`)
            break
        case "tool_start":
            console.log(`🔧 ${event.tool}(${JSON.stringify(event.params)})`)
            break
        case "tool_result":
            console.log(`   ${event.result.success ? "✓" : "✗"} ${event.result.output.substring(0, 200)}`)
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
            console.log(`❌ Error: ${event.error}`)
            break
        case "max_iterations":
            console.log(`⚠️ Max iterations reached`)
            break
    }
}

// Cleanup
const { unlinkSync } = await import("fs")
try { unlinkSync(`${import.meta.dir}/hello.txt`) } catch { }
