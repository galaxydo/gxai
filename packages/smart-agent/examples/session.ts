// Example: Multi-turn Session with objective confirmation
// Shows the human-in-the-loop pattern: agent proposes → user reviews → agent executes
import { Session } from "../src"
import { join } from "path"
import { mkdirSync, rmSync, existsSync } from "fs"

const dir = join(import.meta.dir, ".session-demo")
if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })

const session = new Session({
    model: "gemini-2.5-flash",
    cwd: dir,
    maxIterations: 5,
    requireConfirmation: true,
})

console.log("💬 Multi-turn Session with Objective Confirmation\n")

// ── Turn 1: Create a project ──
console.log("═══ Turn 1: Create a project ═══")
for await (const event of session.send("Create a simple CLI calculator in TypeScript that handles add, subtract, multiply, divide")) {
    switch (event.type) {
        case "planning":
            console.log("\n📋 Proposed objectives:")
            for (const o of event.objectives) {
                console.log(`   • ${o.name}: ${o.description}`)
            }
            break
        case "awaiting_confirmation":
            console.log("\n⏸  Reviewing objectives...")
            // Simulate user approval after inspection
            console.log("   ✓ Approved — proceeding")
            session.confirmObjectives()
            break
        case "tool_start":
            console.log(`   🔧 ${event.tool}(${JSON.stringify(event.params).substring(0, 80)})`)
            break
        case "complete":
            console.log(`\n   ✅ Turn 1 complete`)
            break
    }
}

// ── Turn 2: Follow-up — add error handling ──
console.log("\n═══ Turn 2: Add error handling ═══")
for await (const event of session.send("Now add division-by-zero error handling and input validation")) {
    switch (event.type) {
        case "planning":
            console.log("\n📋 Updated objectives (planner adjusted based on context):")
            for (const o of event.objectives) {
                console.log(`   • ${o.name}: ${o.description}`)
            }
            break
        case "awaiting_confirmation":
            console.log("\n⏸  Reviewing...")
            session.confirmObjectives()
            break
        case "tool_start":
            console.log(`   🔧 ${event.tool}`)
            break
        case "complete":
            console.log(`\n   ✅ Turn 2 complete`)
            break
    }
}

// ── Turn 3: Reject objectives (demonstrate cancel flow) ──
console.log("\n═══ Turn 3: Reject objectives ═══")
for await (const event of session.send("Rewrite everything in Rust")) {
    switch (event.type) {
        case "planning":
            console.log("\n📋 Proposed objectives:")
            for (const o of event.objectives) {
                console.log(`   • ${o.name}: ${o.description}`)
            }
            break
        case "awaiting_confirmation":
            console.log("\n⏸  Reviewing... nah, let's keep TypeScript")
            session.rejectObjectives()
            break
        case "error":
            console.log(`   ⛔ ${event.error}`)
            break
    }
}

console.log(`\n📜 Session history: ${session.getHistory().length} messages`)
console.log("Done!")

rmSync(dir, { recursive: true, force: true })
