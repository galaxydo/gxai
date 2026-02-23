// Example: Skills-driven agent — skills provide CLI context, agent uses exec to achieve objectives
// This is the canonical smart-agent pattern:
//   - Objectives = WHAT to achieve (with validation)
//   - Skills = WHAT CLIs/APIs are available (context for the LLM)
//   - Tools = HOW to interact with the system (exec, read_file, write_file)
//   - agent.run() = the trigger/prompt
//
// The agent doesn't "know" git or bun — the skills teach it.

import { Agent } from "../src"
import { join } from "path"
import { mkdirSync, rmSync, existsSync } from "fs"

const dir = join(import.meta.dir, ".skill-demo")
if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })

// ── Define a custom skill inline (alternative to YAML files) ──
// This teaches the agent about a hypothetical project's CLI
const projectSkill = {
    name: "project",
    description: "Project management commands for this TypeScript monorepo",
    commands: [
        {
            name: "lint",
            description: "Run the linter to check code quality",
            usage: "bun run lint",
        },
        {
            name: "format",
            description: "Auto-format all source files",
            usage: "bun run format",
        },
        {
            name: "typecheck",
            description: "Run TypeScript type checking without emitting",
            usage: "bun run typecheck",
        },
    ],
}

// ── Pre-seed the project with files that need fixing ──

// package.json with lint/format/typecheck scripts
await Bun.write(join(dir, "package.json"), JSON.stringify({
    name: "skill-demo",
    scripts: {
        lint: "bun run lint.ts",
        format: "bun run format.ts",
        typecheck: "bun --bun tsc --noEmit",
    },
    devDependencies: {
        "typescript": "latest",
    },
}, null, 2))

// tsconfig.json
await Bun.write(join(dir, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
        strict: true,
        target: "ESNext",
        module: "ESNext",
        moduleResolution: "bundler",
        noEmit: true,
    },
    include: ["src/**/*.ts"],
}, null, 2))

// A simple lint script (checks for console.log and any)
await Bun.write(join(dir, "lint.ts"), `
import { readdirSync, readFileSync } from "fs"
import { join } from "path"

const issues: string[] = []
const files = readdirSync(join(import.meta.dir, "src")).filter(f => f.endsWith(".ts"))

for (const file of files) {
    const content = readFileSync(join(import.meta.dir, "src", file), "utf-8")
    const lines = content.split("\\n")
    lines.forEach((line, i) => {
        if (line.includes("console.log")) issues.push(\`src/\${file}:\${i+1}: no console.log in library code\`)
        if (line.match(/:\\s*any\\b/)) issues.push(\`src/\${file}:\${i+1}: avoid 'any' type\`)
    })
}

if (issues.length > 0) {
    console.error("Lint errors found:")
    issues.forEach(i => console.error("  " + i))
    process.exit(1)
} else {
    console.log("✓ No lint issues")
}
`)

// A format script (just validates formatting — tabs vs spaces)
await Bun.write(join(dir, "format.ts"), `
import { readdirSync, readFileSync } from "fs"
import { join } from "path"

const issues: string[] = []
const files = readdirSync(join(import.meta.dir, "src")).filter(f => f.endsWith(".ts"))

for (const file of files) {
    const content = readFileSync(join(import.meta.dir, "src", file), "utf-8")
    const lines = content.split("\\n")
    lines.forEach((line, i) => {
        if (line.match(/^\\t/)) issues.push(\`src/\${file}:\${i+1}: use spaces, not tabs\`)
    })
}

if (issues.length > 0) {
    console.error("Format errors found:")
    issues.forEach(i => console.error("  " + i))
    process.exit(1)
} else {
    console.log("✓ Formatting OK")
}
`)

// Source file with deliberate lint + format issues
mkdirSync(join(dir, "src"), { recursive: true })
await Bun.write(join(dir, "src/utils.ts"), `export function greet(name: any): string {
\tconsole.log("greeting", name)
\treturn \`Hello, \${name}!\`
}

export function add(a: any, b: any): any {
\tconsole.log("adding", a, b)
\treturn a + b
}

export function multiply(a: number, b: number): number {
\treturn a * b
}
`)

const agent = new Agent({
    model: "gemini-2.5-flash",
    cwd: dir,
    maxIterations: 8,
    // Skills teach the agent what CLIs are available
    skills: [
        join(import.meta.dir, "../skills/bun.yaml"),  // knows about 'bun test', 'bun run'
        projectSkill,                                   // knows about 'bun run lint', 'bun run format'
    ],
    objectives: [
        {
            name: "lint_passes",
            description: "All lint checks pass (no console.log, no 'any' type annotations)",
            validate: (state) => {
                const last = state.toolHistory.findLast(
                    t => t.tool === "exec" && t.params.command?.includes("bun run lint")
                )
                if (!last) return { met: false, reason: "Run 'bun run lint' to check" }
                return {
                    met: last.result.success,
                    reason: last.result.success ? "Lint passes" : `Lint errors: ${last.result.output.substring(0, 200)}`,
                }
            },
        },
        {
            name: "format_passes",
            description: "Code formatting passes (spaces, not tabs)",
            validate: (state) => {
                const last = state.toolHistory.findLast(
                    t => t.tool === "exec" && t.params.command?.includes("bun run format")
                )
                if (!last) return { met: false, reason: "Run 'bun run format' to check" }
                return {
                    met: last.result.success,
                    reason: last.result.success ? "Formatting OK" : `Format errors: ${last.result.output.substring(0, 200)}`,
                }
            },
        },
        {
            name: "types_correct",
            description: "TypeScript compiles with no type errors (no 'any' types, strict mode)",
            validate: (state) => {
                const last = state.toolHistory.findLast(
                    t => t.tool === "exec" && t.params.command?.includes("typecheck")
                )
                if (!last) return { met: false, reason: "Run 'bun run typecheck' to verify types" }
                return {
                    met: last.result.success,
                    reason: last.result.success ? "Types OK" : `Type errors: ${last.result.output.substring(0, 200)}`,
                }
            },
        },
    ],
})

console.log("🧰 Skills-driven agent: fix lint, format, and type errors\n")
console.log("The agent knows these CLIs via skills:")
console.log("  • bun run lint   — checks for console.log and 'any' types")
console.log("  • bun run format — checks tabs vs spaces")
console.log("  • bun run typecheck — runs tsc --noEmit\n")

for await (const event of agent.run(
    "Read the source files, then run the project's lint, format, and typecheck commands. Fix all issues and re-run until everything passes."
)) {
    switch (event.type) {
        case "iteration_start":
            console.log(`\n── Iteration ${event.iteration} ──`)
            break
        case "thinking":
            console.log(`💭 ${event.message.substring(0, 250)}`)
            break
        case "tool_start":
            console.log(`🔧 ${event.tool}(${JSON.stringify(event.params).substring(0, 120)})`)
            break
        case "tool_result": {
            const out = event.result.output.substring(0, 200)
            console.log(`   ${event.result.success ? "✓" : "✗"} ${out}`)
            break
        }
        case "objective_check":
            for (const r of event.results) console.log(`   ${r.met ? "✅" : "❌"} ${r.name}: ${r.reason}`)
            break
        case "complete":
            console.log(`\n🎉 All checks pass in ${event.iteration + 1} iterations`)
            break
        case "error":
            console.log(`❌ ${event.error.substring(0, 200)}`)
            break
    }
}

// Show the fixed code
console.log("\n📄 Fixed src/utils.ts:")
console.log(await Bun.file(join(dir, "src/utils.ts")).text())

rmSync(dir, { recursive: true, force: true })
