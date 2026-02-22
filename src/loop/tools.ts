// src/loop/tools.ts
// Built-in tools for the LoopAgent: read_file, write_file, edit_file, exec
import { z } from "zod";
import type { LoopTool, ToolResult } from "./types";

/**
 * Creates the 4 default tools scoped to a working directory.
 */
export function createDefaultTools(cwd: string, timeoutMs: number = 30000): LoopTool[] {
    return [
        createReadFileTool(cwd),
        createWriteFileTool(cwd),
        createEditFileTool(cwd),
        createExecTool(cwd, timeoutMs),
    ];
}

// ============================================
// read_file
// ============================================

function createReadFileTool(cwd: string): LoopTool {
    return {
        name: "read_file",
        description: "Read the contents of a file. Returns the file content as a string.",
        parameters: z.object({
            path: z.string().describe("File path relative to working directory, or absolute path"),
        }),
        async execute(params): Promise<ToolResult> {
            try {
                const fullPath = resolvePath(cwd, params.path);
                const file = Bun.file(fullPath);
                if (!(await file.exists())) {
                    return { success: false, output: "", error: `File not found: ${fullPath}` };
                }
                const content = await file.text();
                // Truncate extremely large files
                const maxLen = 100_000;
                const truncated = content.length > maxLen
                    ? content.substring(0, maxLen) + `\n...[truncated, ${content.length - maxLen} chars remaining]`
                    : content;
                return { success: true, output: truncated };
            } catch (e: any) {
                return { success: false, output: "", error: e.message };
            }
        },
    };
}

// ============================================
// write_file
// ============================================

function createWriteFileTool(cwd: string): LoopTool {
    return {
        name: "write_file",
        description: "Write content to a file. Creates the file and parent directories if they don't exist. Overwrites existing content.",
        parameters: z.object({
            path: z.string().describe("File path relative to working directory, or absolute path"),
            content: z.string().describe("Content to write to the file"),
        }),
        async execute(params): Promise<ToolResult> {
            try {
                const fullPath = resolvePath(cwd, params.path);
                // Ensure parent directory exists
                const dir = fullPath.substring(0, Math.max(fullPath.lastIndexOf("/"), fullPath.lastIndexOf("\\")));
                if (dir) {
                    const { mkdirSync } = await import("fs");
                    mkdirSync(dir, { recursive: true });
                }
                await Bun.write(fullPath, params.content);
                return { success: true, output: `Wrote ${params.content.length} chars to ${fullPath}` };
            } catch (e: any) {
                return { success: false, output: "", error: e.message };
            }
        },
    };
}

// ============================================
// edit_file
// ============================================

function createEditFileTool(cwd: string): LoopTool {
    return {
        name: "edit_file",
        description: "Edit an existing file by replacing a target string with replacement content. The target must be an exact substring match.",
        parameters: z.object({
            path: z.string().describe("File path relative to working directory, or absolute path"),
            target: z.string().describe("Exact string to find and replace (must be unique in the file)"),
            replacement: z.string().describe("String to replace the target with"),
        }),
        async execute(params): Promise<ToolResult> {
            try {
                const fullPath = resolvePath(cwd, params.path);
                const file = Bun.file(fullPath);
                if (!(await file.exists())) {
                    return { success: false, output: "", error: `File not found: ${fullPath}` };
                }
                const content = await file.text();
                const count = content.split(params.target).length - 1;
                if (count === 0) {
                    return { success: false, output: "", error: `Target string not found in ${fullPath}. File contents may differ from expected.` };
                }
                if (count > 1) {
                    return { success: false, output: "", error: `Target string found ${count} times in ${fullPath}. Must be unique. Provide a larger context.` };
                }
                const newContent = content.replace(params.target, params.replacement);
                await Bun.write(fullPath, newContent);
                return { success: true, output: `Replaced target in ${fullPath} (${params.target.length} chars → ${params.replacement.length} chars)` };
            } catch (e: any) {
                return { success: false, output: "", error: e.message };
            }
        },
    };
}

// ============================================
// exec
// ============================================

function createExecTool(cwd: string, timeoutMs: number): LoopTool {
    return {
        name: "exec",
        description: "Execute a shell command and return stdout/stderr. Commands run in the working directory. Use for running scripts, checking process status, installing dependencies, etc.",
        parameters: z.object({
            command: z.string().describe("Shell command to execute"),
            timeout_ms: z.number().optional().describe(`Timeout in milliseconds (default: ${timeoutMs})`),
        }),
        async execute(params): Promise<ToolResult> {
            try {
                const effectiveTimeout = params.timeout_ms || timeoutMs;
                // Cross-platform shell invocation
                const isWin = process.platform === "win32";
                const shellArgs = isWin
                    ? ["cmd", "/c", params.command]
                    : ["bash", "-c", params.command];
                const proc = Bun.spawn(shellArgs, {
                    cwd,
                    stdout: "pipe",
                    stderr: "pipe",
                    env: { ...process.env },
                });

                // Race between process completion and timeout
                const timeoutPromise = new Promise<"timeout">((resolve) =>
                    setTimeout(() => resolve("timeout"), effectiveTimeout)
                );

                const result = await Promise.race([
                    (async () => {
                        const exitCode = await proc.exited;
                        const stdout = await new Response(proc.stdout).text();
                        const stderr = await new Response(proc.stderr).text();
                        return { exitCode, stdout, stderr };
                    })(),
                    timeoutPromise,
                ]);

                if (result === "timeout") {
                    proc.kill();
                    return { success: false, output: "", error: `Command timed out after ${effectiveTimeout}ms` };
                }

                const { exitCode, stdout, stderr } = result;
                const output = [
                    stdout ? `stdout:\n${stdout}` : "",
                    stderr ? `stderr:\n${stderr}` : "",
                    `exit code: ${exitCode}`,
                ].filter(Boolean).join("\n");

                // Truncate long output
                const maxLen = 50_000;
                const truncated = output.length > maxLen
                    ? output.substring(0, maxLen) + `\n...[truncated]`
                    : output;

                return { success: exitCode === 0, output: truncated, error: exitCode !== 0 ? `Command exited with code ${exitCode}` : undefined };
            } catch (e: any) {
                return { success: false, output: "", error: e.message };
            }
        },
    };
}

// ============================================
// Helpers
// ============================================

function resolvePath(cwd: string, filePath: string): string {
    // If absolute (Unix or Windows), use as-is
    if (filePath.startsWith("/") || /^[A-Za-z]:[\\/]/.test(filePath)) {
        return filePath;
    }
    // Otherwise resolve relative to cwd
    const sep = cwd.includes("\\") ? "\\" : "/";
    return `${cwd}${sep}${filePath}`;
}
