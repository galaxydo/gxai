// Example: Agent generates a REST API from a spec, then tests it
// Shows skill usage (bun skill) + multi-step objective chain
import { Agent } from "../src"
import { join } from "path"
import { mkdirSync, rmSync, existsSync } from "fs"

const dir = join(import.meta.dir, ".api-gen")
if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })

// Write a simple API spec as context
await Bun.write(join(dir, "SPEC.md"), `
# Todo API Specification

## Endpoints

### GET /todos
Returns all todos as JSON array.
Response: \`[{ "id": 1, "title": "...", "done": false }]\`

### POST /todos
Creates a new todo. Body: \`{ "title": "..." }\`
Response: \`{ "id": 2, "title": "...", "done": false }\`

### PATCH /todos/:id
Toggle done status.
Response: updated todo object.

### DELETE /todos/:id
Delete a todo.
Response: \`{ "ok": true }\`

## Requirements
- Use Bun.serve() (no frameworks)
- Port 4567
- In-memory storage (no database)
- TypeScript only
`)

const agent = new Agent({
    model: "gemini-2.5-flash",
    cwd: dir,
    skills: [join(import.meta.dir, "../skills/bun.yaml")],
    maxIterations: 10,
    objectives: [
        {
            name: "server_file",
            description: "server.ts exists with Bun.serve on port 4567",
            validate: async () => {
                const f = Bun.file(join(dir, "server.ts"))
                if (!(await f.exists())) return { met: false, reason: "server.ts missing" }
                const t = await f.text()
                if (!t.includes("Bun.serve") || !t.includes("4567"))
                    return { met: false, reason: "Missing Bun.serve or port 4567" }
                return { met: true, reason: "server.ts with Bun.serve on port 4567" }
            },
        },
        {
            name: "test_file",
            description: "server.test.ts exists with tests for all 4 endpoints",
            validate: async () => {
                const f = Bun.file(join(dir, "server.test.ts"))
                if (!(await f.exists())) return { met: false, reason: "server.test.ts missing" }
                const t = await f.text()
                const endpoints = ["GET", "POST", "PATCH", "DELETE"]
                const missing = endpoints.filter(e => !t.includes(e))
                if (missing.length > 0) return { met: false, reason: `Missing tests for: ${missing.join(", ")}` }
                return { met: true, reason: "Tests cover all endpoints" }
            },
        },
        {
            name: "tests_pass",
            description: "Run 'bun test server.test.ts' — all tests must pass",
            validate: (state) => {
                const last = state.toolHistory.findLast(
                    t => t.tool === "exec" && t.params.command?.includes("bun test")
                )
                if (!last) return { met: false, reason: "Haven't run tests yet" }
                return {
                    met: last.result.success,
                    reason: last.result.success ? "All API tests pass" : `Tests failed: ${last.result.error}`,
                }
            },
        },
    ],
})

console.log("🚀 API Generator: build a REST API from spec, write tests, make them pass\n")

for await (const event of agent.run(
    "Read SPEC.md. Implement the Todo API in server.ts using Bun.serve(). Then write server.test.ts with tests for every endpoint. Run the tests."
)) {
    switch (event.type) {
        case "iteration_start":
            console.log(`\n── Iteration ${event.iteration} ──`)
            break
        case "thinking":
            console.log(`💭 ${event.message.substring(0, 250)}`)
            break
        case "tool_start":
            console.log(`🔧 ${event.tool}(${JSON.stringify(event.params).substring(0, 100)})`)
            break
        case "tool_result":
            console.log(`   ${event.result.success ? "✓" : "✗"} ${event.result.output.substring(0, 200)}`)
            break
        case "objective_check":
            for (const r of event.results) console.log(`   ${r.met ? "✅" : "❌"} ${r.name}: ${r.reason}`)
            break
        case "complete":
            console.log(`\n🎉 API generated and tested in ${event.iteration + 1} iterations`)
            break
        case "error":
            console.log(`❌ ${event.error.substring(0, 200)}`)
            break
    }
}

rmSync(dir, { recursive: true, force: true })
