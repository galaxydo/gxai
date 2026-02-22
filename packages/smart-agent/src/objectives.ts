// smart-agent/src/objectives.ts
// Built-in objective templates — the planner generates these as data, we hydrate them into real Objective objects
import type { Objective, PlannedObjective } from "./types"

/**
 * Hydrate a PlannedObjective (data) into a real Objective (with validate function).
 * The planner agent outputs PlannedObjective[] as structured data, and we convert them here.
 */
export function hydrateObjective(planned: PlannedObjective, cwd: string): Objective {
    switch (planned.type) {
        case "file_exists":
            return {
                name: planned.name,
                description: planned.description,
                validate: async () => {
                    const path = resolvePath(cwd, planned.params.path!)
                    const file = Bun.file(path)
                    if (!(await file.exists())) return { met: false, reason: `File not found: ${planned.params.path}` }
                    // Optionally check content substring
                    if (planned.params.contains) {
                        const content = await file.text()
                        if (!content.includes(planned.params.contains)) {
                            return { met: false, reason: `File exists but missing: "${planned.params.contains}"` }
                        }
                    }
                    return { met: true, reason: `File exists: ${planned.params.path}` }
                },
            }

        case "file_contains":
            return {
                name: planned.name,
                description: planned.description,
                validate: async () => {
                    const path = resolvePath(cwd, planned.params.path!)
                    const file = Bun.file(path)
                    if (!(await file.exists())) return { met: false, reason: `File not found: ${planned.params.path}` }
                    const content = await file.text()
                    if (!content.includes(planned.params.text!)) {
                        return { met: false, reason: `File missing content: "${planned.params.text}"` }
                    }
                    return { met: true, reason: `File contains required content` }
                },
            }

        case "command_succeeds":
            return {
                name: planned.name,
                description: planned.description,
                validate: (state) => {
                    const cmd = planned.params.command!
                    const match = state.toolHistory.findLast(
                        t => t.tool === "exec" && t.params.command?.includes(cmd)
                    )
                    if (!match) return { met: false, reason: `Command "${cmd}" not executed yet` }
                    return {
                        met: match.result.success,
                        reason: match.result.success ? `Command succeeded` : `Command failed: ${match.result.error}`,
                    }
                },
            }

        case "command_output_contains":
            return {
                name: planned.name,
                description: planned.description,
                validate: (state) => {
                    const cmd = planned.params.command!
                    const text = planned.params.text!
                    const match = state.toolHistory.findLast(
                        t => t.tool === "exec" && t.params.command?.includes(cmd)
                    )
                    if (!match) return { met: false, reason: `Command "${cmd}" not executed yet` }
                    if (!match.result.output.includes(text)) {
                        return { met: false, reason: `Output missing: "${text}"` }
                    }
                    return { met: true, reason: `Output contains "${text}"` }
                },
            }

        case "custom_check":
            // Custom check — the description tells the LLM what to verify, and we check
            // if any successful tool execution happened (generic fallback)
            return {
                name: planned.name,
                description: planned.description,
                validate: (state) => {
                    const hasRecentSuccess = state.toolHistory.some(
                        t => t.iteration === state.iteration && t.result.success
                    )
                    return {
                        met: hasRecentSuccess,
                        reason: hasRecentSuccess ? "Recent tool succeeded" : "No successful tool execution this iteration",
                    }
                },
            }

        default:
            throw new Error(`Unknown objective type: ${(planned as any).type}`)
    }
}

function resolvePath(cwd: string, filePath: string): string {
    if (filePath.startsWith("/") || /^[A-Za-z]:[/\\]/.test(filePath)) return filePath
    const sep = cwd.includes("\\") ? "\\" : "/"
    return `${cwd}${sep}${filePath}`
}

/** The system prompt the planner agent uses to generate objectives */
export const PLANNER_SYSTEM_PROMPT = `You are a planning agent. Your job is to analyze a user request and generate specific, verifiable objectives.

For each objective, choose one of these types:
- file_exists: Check that a file exists (optionally with specific content)
  params: { path: "file/path", contains?: "optional content to check" }
- file_contains: Check that a file contains specific text
  params: { path: "file/path", text: "required text" }
- command_succeeds: Check that a command exits with code 0
  params: { command: "the command to check" }
- command_output_contains: Check that a command's output contains text
  params: { command: "the command", text: "expected output" }
- custom_check: Generic check (least preferred — use specific types when possible)
  params: { check: "description of what to verify" }

Respond with a JSON array of objectives. Each objective has: name, description, type, params.

RESPOND WITH ONLY VALID JSON. No markdown, no explanation, just a JSON array.

Example response:
[
  {
    "name": "package_json_exists",
    "description": "Project has a package.json file",
    "type": "file_exists",
    "params": { "path": "package.json" }
  },
  {
    "name": "tests_pass",
    "description": "All unit tests pass successfully",
    "type": "command_succeeds",
    "params": { "command": "bun test" }
  }
]`
