// smart-agent/src/tools.ts
// 6 built-in tools: read_file, write_file, edit_file, exec, list_dir, search
import type { Tool, ToolResult } from "./types"
import { measure, measureSync } from "measure-fn"

function resolvePath(cwd: string, filePath: string): string {
    if (!filePath || typeof filePath !== "string") throw new Error("Path is required")
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
            execute: (params) => measure('tool:read_file', async () => {
                const fullPath = resolvePath(cwd, params.path)
                const file = Bun.file(fullPath)
                if (!(await file.exists())) return { success: false, output: "", error: `File not found: ${fullPath}` }
                const content = await file.text()
                const max = 100_000
                return { success: true, output: content.length > max ? content.substring(0, max) + `\n...[truncated]` : content }
            }, (e: any) => ({ success: false, output: "", error: e.message })) as Promise<ToolResult>,
        },

        // ── write_file ──
        {
            name: "write_file",
            description: "Write content to a file (creates parent dirs). Overwrites existing.",
            parameters: {
                path: { type: "string", description: "File path (relative to cwd or absolute)", required: true },
                content: { type: "string", description: "Content to write", required: true },
            },
            execute: (params) => measure('tool:write_file', async () => {
                const fullPath = resolvePath(cwd, params.path)
                const dir = fullPath.substring(0, Math.max(fullPath.lastIndexOf("/"), fullPath.lastIndexOf("\\")))
                if (dir) {
                    const { mkdirSync } = await import("fs")
                    mkdirSync(dir, { recursive: true })
                }
                await Bun.write(fullPath, params.content)
                return { success: true, output: `Wrote ${params.content.length} chars to ${fullPath}` }
            }, (e: any) => ({ success: false, output: "", error: e.message })) as Promise<ToolResult>,
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
            execute: (params) => measure('tool:edit_file', async () => {
                const fullPath = resolvePath(cwd, params.path)
                const file = Bun.file(fullPath)
                if (!(await file.exists())) return { success: false, output: "", error: `File not found: ${fullPath}` }
                const content = await file.text()
                const count = content.split(params.target).length - 1
                if (count === 0) return { success: false, output: "", error: `Target not found in ${fullPath}` }
                if (count > 1) return { success: false, output: "", error: `Target found ${count} times — must be unique. Provide more context.` }
                await Bun.write(fullPath, content.replace(params.target, params.replacement))
                return { success: true, output: `Replaced in ${fullPath} (${params.target.length} → ${params.replacement.length} chars)` }
            }, (e: any) => ({ success: false, output: "", error: e.message })) as Promise<ToolResult>,
        },

        // ── exec ──
        {
            name: "exec",
            description: "Execute a shell command. Use for running scripts, CLIs, tests, installing deps, etc.",
            parameters: {
                command: { type: "string", description: "Shell command to execute", required: true },
            },
            execute: (params) => measure(`tool:exec`, async () => {
                if (!params.command || typeof params.command !== "string") {
                    return { success: false, output: "", error: "command parameter is required" }
                }
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
            }, (e: any) => ({ success: false, output: "", error: e.message })) as Promise<ToolResult>,
        },

        // ── list_dir ──
        {
            name: "list_dir",
            description: "List files and directories. Supports recursive listing with depth control. Returns type, size, and relative path.",
            parameters: {
                path: { type: "string", description: "Directory path (relative to cwd or absolute)", required: true },
                depth: { type: "number", description: "Max recursion depth. Default: 1 (immediate children only). Use 2-3 for deeper exploration." },
            },
            execute: (params) => measure('tool:list_dir', async () => {
                const { readdirSync, statSync } = await import("fs")
                const { join, relative } = await import("path")
                const fullPath = resolvePath(cwd, params.path || ".")
                const maxDepth = Math.min(params.depth || 1, 5)
                const results: string[] = []
                const maxEntries = 200

                function walk(dir: string, depth: number, prefix: string) {
                    if (depth > maxDepth || results.length >= maxEntries) return
                    try {
                        const entries = readdirSync(dir, { withFileTypes: true })
                        for (const entry of entries) {
                            if (results.length >= maxEntries) break
                            if (entry.name.startsWith(".") || entry.name === "node_modules") continue
                            const entryPath = join(dir, entry.name)
                            const rel = prefix ? `${prefix}/${entry.name}` : entry.name
                            if (entry.isDirectory()) {
                                results.push(`📁 ${rel}/`)
                                walk(entryPath, depth + 1, rel)
                            } else {
                                try {
                                    const stat = statSync(entryPath)
                                    const size = stat.size < 1024 ? `${stat.size}B`
                                        : stat.size < 1048576 ? `${(stat.size / 1024).toFixed(1)}KB`
                                            : `${(stat.size / 1048576).toFixed(1)}MB`
                                    results.push(`  ${rel} (${size})`)
                                } catch {
                                    results.push(`  ${rel}`)
                                }
                            }
                        }
                    } catch (e: any) {
                        results.push(`  ⚠ ${dir}: ${e.message}`)
                    }
                }

                walk(fullPath, 1, "")
                if (results.length >= maxEntries) results.push(`\n...[truncated at ${maxEntries} entries]`)
                return { success: true, output: results.join("\n") || "(empty directory)" }
            }, (e: any) => ({ success: false, output: "", error: e.message })) as Promise<ToolResult>,
        },

        // ── search ──
        {
            name: "search",
            description: "Search for a text pattern across files in a directory. Like grep/ripgrep. Returns matching lines with file paths and line numbers.",
            parameters: {
                pattern: { type: "string", description: "Text or regex pattern to search for", required: true },
                path: { type: "string", description: "Directory or file to search in (relative to cwd or absolute). Default: cwd" },
                include: { type: "string", description: "Glob pattern to filter files, e.g. '*.ts' or '*.{ts,tsx}'" },
            },
            execute: (params) => measure('tool:search', async () => {
                const { readdirSync, readFileSync, statSync } = await import("fs")
                const { join, extname } = await import("path")
                const searchPath = resolvePath(cwd, params.path || ".")
                const pattern = params.pattern
                const includeGlob = params.include || ""
                const matches: string[] = []
                const maxMatches = 50
                const maxFileSize = 500_000

                const includeExts = includeGlob
                    ? includeGlob.replace(/[{}*]/g, "").split(",").map((e: string) => e.startsWith(".") ? e : `.${e}`)
                    : []

                function shouldInclude(file: string): boolean {
                    if (includeExts.length === 0) return true
                    return includeExts.some((ext: string) => file.endsWith(ext))
                }

                const binaryExts = new Set([".png", ".jpg", ".jpeg", ".gif", ".ico", ".woff", ".woff2", ".ttf", ".eot", ".zip", ".tar", ".gz", ".mp3", ".mp4", ".webm", ".webp", ".pdf"])

                function searchFile(filePath: string, relPath: string) {
                    if (matches.length >= maxMatches) return
                    if (binaryExts.has(extname(filePath).toLowerCase())) return
                    if (!shouldInclude(filePath)) return
                    try {
                        const stat = statSync(filePath)
                        if (stat.size > maxFileSize) return
                        const content = readFileSync(filePath, "utf-8")
                        const lines = content.split("\n")
                        for (let i = 0; i < lines.length && matches.length < maxMatches; i++) {
                            if (lines[i].includes(pattern)) {
                                matches.push(`${relPath}:${i + 1}: ${lines[i].trimEnd().substring(0, 200)}`)
                            }
                        }
                    } catch { /* skip unreadable files */ }
                }

                function walk(dir: string, relDir: string) {
                    if (matches.length >= maxMatches) return
                    try {
                        const entries = readdirSync(dir, { withFileTypes: true })
                        for (const entry of entries) {
                            if (matches.length >= maxMatches) break
                            if (entry.name.startsWith(".") || entry.name === "node_modules") continue
                            const full = join(dir, entry.name)
                            const rel = relDir ? `${relDir}/${entry.name}` : entry.name
                            if (entry.isDirectory()) {
                                walk(full, rel)
                            } else {
                                searchFile(full, rel)
                            }
                        }
                    } catch { /* skip unreadable dirs */ }
                }

                const stat = statSync(searchPath)
                if (stat.isFile()) {
                    searchFile(searchPath, params.path || searchPath)
                } else {
                    walk(searchPath, "")
                }

                if (matches.length === 0) return { success: true, output: `No matches for "${pattern}"` }
                const suffix = matches.length >= maxMatches ? `\n...[capped at ${maxMatches} matches]` : ""
                return { success: true, output: matches.join("\n") + suffix }
            }, (e: any) => ({ success: false, output: "", error: e.message })) as Promise<ToolResult>,
        },
    ]
}
