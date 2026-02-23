// Example: Agent reviews buggy code, finds the bug, fixes it, and verifies tests pass
import { Agent } from "../src"
import { join } from "path"
import { mkdirSync, rmSync, existsSync } from "fs"

const dir = join(import.meta.dir, ".code-review")
if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })

// Write a deliberately buggy module
await Bun.write(join(dir, "math.ts"), `
export function fibonacci(n: number): number {
    if (n <= 0) return 0
    if (n === 1) return 1
    // Bug: should be fibonacci(n-1) + fibonacci(n-2)
    return fibonacci(n - 1) * fibonacci(n - 2)
}

export function isPrime(n: number): boolean {
    if (n < 2) return false
    // Bug: should check up to sqrt(n), and i starts at 2
    for (let i = 2; i < n; i++) {
        if (n % i === 0) return false
    }
    return true
}
`)

// Write tests that expose the bugs
await Bun.write(join(dir, "math.test.ts"), `
import { expect, test } from "bun:test"
import { fibonacci, isPrime } from "./math"

test("fibonacci(0) = 0", () => expect(fibonacci(0)).toBe(0))
test("fibonacci(1) = 1", () => expect(fibonacci(1)).toBe(1))
test("fibonacci(6) = 8", () => expect(fibonacci(6)).toBe(8))
test("fibonacci(10) = 55", () => expect(fibonacci(10)).toBe(55))

test("isPrime(2)", () => expect(isPrime(2)).toBe(true))
test("isPrime(7)", () => expect(isPrime(7)).toBe(true))
test("isPrime(4)", () => expect(isPrime(4)).toBe(false))
test("isPrime(1)", () => expect(isPrime(1)).toBe(false))
`)

const agent = new Agent({
    model: "gemini-2.5-flash",
    cwd: dir,
    maxIterations: 6,
    objectives: [
        {
            name: "tests_pass",
            description: "All tests in math.test.ts must pass",
            validate: (state) => {
                const last = state.toolHistory.findLast(
                    t => t.tool === "exec" && t.params.command?.includes("bun test")
                )
                if (!last) return { met: false, reason: "Haven't run tests yet" }
                return {
                    met: last.result.success,
                    reason: last.result.success ? "All tests pass" : "Tests still failing",
                }
            },
        },
    ],
})

console.log("🔍 Code Review: agent finds and fixes bugs in math.ts\n")

for await (const event of agent.run(
    "Read math.ts and math.test.ts. Run the tests — they'll fail. Find the bugs, fix them, and make all tests pass."
)) {
    switch (event.type) {
        case "iteration_start":
            console.log(`\n── Iteration ${event.iteration} ──`)
            break
        case "thinking":
            console.log(`💭 ${event.message.substring(0, 300)}`)
            break
        case "tool_start":
            console.log(`🔧 ${event.tool}(${JSON.stringify(event.params).substring(0, 120)})`)
            break
        case "tool_result":
            console.log(`   ${event.result.success ? "✓" : "✗"} ${event.result.output.substring(0, 200)}`)
            break
        case "objective_check":
            for (const r of event.results) console.log(`   ${r.met ? "✅" : "❌"} ${r.name}: ${r.reason}`)
            break
        case "complete":
            console.log(`\n🎉 Bugs fixed in ${event.iteration + 1} iterations`)
            break
        case "error":
            console.log(`❌ ${event.error.substring(0, 200)}`)
            break
    }
}

// Show the fixed code
const fixed = await Bun.file(join(dir, "math.ts")).text()
console.log("\n📄 Fixed math.ts:\n" + fixed)

rmSync(dir, { recursive: true, force: true })
