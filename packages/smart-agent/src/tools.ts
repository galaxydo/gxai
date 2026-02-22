// smart-agent/src/tools.ts
// 4 built-in tools: read_file, write_file, edit_file, exec
import type { Tool, ToolResult } from "./types"

function resolvePath(cwd: string, filePath: string): string {
    if (filePath.startsWith("/") || /^[A-Za-z]:[/\\]/.test(filePath)) return filePath
    const sep = cwd.includes("\\") ? "\\" : "/"
    return `${cwd}${sep}${filePath}`
}

export function createBuiltinTools(cwd: string, timeoutMs: number): Tool[] {
    return [
        // ── read_file ──
        {
            name: "read_file",
            description: "Read contents of a file",
            parameters: {
                path: { type: "string", description: "File path (relative to cwd or absolute)", required: true },
            },
            async execute(params): Promise<ToolResult> {
                try {
                    const fullPath = resolvePath(cwd, params.path)
                    const file = Bun.file(fullPath)
                    if (!(await file.exists())) return { success: false, output: "", error: `File not found: ${fullPath}` }
                    const content = await file.text()
                    const max = 100_000
                    return { success: true, output: content.length > max ? content.substring(0, max) + `\n...[truncated]` : content }
                } catch (e: any) {
                    return { success: false, output: "", error: e.message }
                }
            },
        },

        // ── write_file ──
        {
            name: "write_file",
            description: "Write content to a file (creates parent dirs). Overwrites existing.",
            parameters: {
                path: { type: "string", description: "File path (relative to cwd or absolute)", required: true },
                content: { type: "string", description: "Content to write", required: true },
            },
            async execute(params): Promise<ToolResult> {
                try {
                    const fullPath = resolvePath(cwd, params.path)
                    const dir = fullPath.substring(0, Math.max(fullPath.lastIndexOf("/"), fullPath.lastIndexOf("\\")))
                    if (dir) {
                        const { mkdirSync } = await import("fs")
                        mkdirSync(dir, { recursive: true })
                    }
                    await Bun.write(fullPath, params.content)
                    return { success: true, output: `Wrote ${params.content.length} chars to ${fullPath}` }
                } catch (e: any) {
                    return { success: false, output: "", error: e.message }
                }
            },
        },

        // ── edit_file ──
        {
            name: "edit_file",
            description: "Edit a file by replacing an exact target string with replacement content. Target must be unique.",
            parameters: {
                path: { type: "string", description: "File path", required: true },
                target: { type: "string", description: "Exact string to find (must be unique in file)", required: true },
                replacement: { type: "string", description: "Replacement string", required: true },
            },
            async execute(params): Promise<ToolResult> {
                try {
                    const fullPath = resolvePath(cwd, params.path)
                    const file = Bun.file(fullPath)
                    if (!(await file.exists())) return { success: false, output: "", error: `File not found: ${fullPath}` }
                    const content = await file.text()
                    const count = content.split(params.target).length - 1
                    if (count === 0) return { success: false, output: "", error: `Target not found in ${fullPath}` }
                    if (count > 1) return { success: false, output: "", error: `Target found ${count} times — must be unique. Provide more context.` }
                    await Bun.write(fullPath, content.replace(params.target, params.replacement))
                    return { success: true, output: `Replaced in ${fullPath} (${params.target.length} → ${params.replacement.length} chars)` }
                } catch (e: any) {
                    return { success: false, output: "", error: e.message }
                }
            },
        },

        // ── exec ──
        {
            name: "exec",
            description: "Execute a shell command. Use for running scripts, CLIs, tests, installing deps, etc.",
            parameters: {
                command: { type: "string", description: "Shell command to execute", required: true },
            },
            async execute(params): Promise<ToolResult> {
                try {
                    const isWin = process.platform === "win32"
                    const shellArgs = isWin ? ["cmd", "/c", params.command] : ["bash", "-c", params.command]
                    const proc = Bun.spawn(shellArgs, {
                        cwd,
                        stdout: "pipe",
                        stderr: "pipe",
                        env: { ...process.env },
                    })

                    const timeout = new Promise<"timeout">(r => setTimeout(() => r("timeout"), timeoutMs))
                    const result = await Promise.race([
                        (async () => {
                            const exitCode = await proc.exited
                            const stdout = await new Response(proc.stdout).text()
                            const stderr = await new Response(proc.stderr).text()
                            return { exitCode, stdout, stderr }
                        })(),
                        timeout,
                    ])

                    if (result === "timeout") {
                        proc.kill()
                        return { success: false, output: "", error: `Timed out after ${timeoutMs}ms` }
                    }

                    const { exitCode, stdout, stderr } = result
                    const output = [
                        stdout ? `stdout:\n${stdout}` : "",
                        stderr ? `stderr:\n${stderr}` : "",
                        `exit code: ${exitCode}`,
                    ].filter(Boolean).join("\n")

                    const max = 50_000
                    const truncated = output.length > max ? output.substring(0, max) + "\n...[truncated]" : output
                    return {
                        success: exitCode === 0,
                        output: truncated,
                        error: exitCode !== 0 ? `Exit code ${exitCode}` : undefined,
                    }
                } catch (e: any) {
                    return { success: false, output: "", error: e.message }
                }
            },
        },
    ]
}
