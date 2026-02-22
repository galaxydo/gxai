// src/loop/loop.test.ts
// Tests for the LoopAgent agentic loop
import { test, expect, describe } from "bun:test";
import { z } from "zod";
import { LoopAgent } from "./agent";
import type { LoopEvent, LoopTool, ToolResult } from "./types";
import { createDefaultTools } from "./tools";
import { unlink, existsSync } from "fs";

const tmpDir = process.platform === "win32" ? "C:\\temp" : "/tmp";

describe("LoopAgent", () => {
    // Helper: create a mock tool
    function mockTool(name: string, result: ToolResult): LoopTool {
        return {
            name,
            description: `Mock tool: ${name}`,
            parameters: z.object({ input: z.string().optional() }),
            execute: async () => result,
        };
    }

    test("creates with default tools", () => {
        const agent = new LoopAgent({
            llm: "gpt-4o-mini",
            outcomes: [{ description: "test outcome" }],
        });
        expect(agent).toBeDefined();
    });

    test("creates with custom tools only", () => {
        const agent = new LoopAgent({
            llm: "gpt-4o-mini",
            outcomes: [{ description: "test outcome" }],
            includeDefaultTools: false,
            tools: [mockTool("custom", { success: true, output: "ok" })],
        });
        expect(agent).toBeDefined();
    });

    test("creates with both default and custom tools", () => {
        const agent = new LoopAgent({
            llm: "gpt-4o-mini",
            outcomes: [{ description: "test outcome" }],
            tools: [mockTool("custom", { success: true, output: "ok" })],
        });
        expect(agent).toBeDefined();
    });

    test("respects maxIterations config", () => {
        const agent = new LoopAgent({
            llm: "gpt-4o-mini",
            outcomes: [{ description: "test" }],
            maxIterations: 5,
        });
        expect(agent).toBeDefined();
    });
});

describe("Default Tools", () => {
    const cwd = process.cwd();
    const tools = createDefaultTools(cwd);

    function cleanup(path: string) {
        try { if (existsSync(path)) unlink(path, () => { }); } catch { }
    }

    test("creates 4 default tools", () => {
        expect(tools).toHaveLength(4);
        expect(tools.map(t => t.name)).toEqual(["read_file", "write_file", "edit_file", "exec"]);
    });

    test("read_file reads existing file", async () => {
        const readTool = tools.find(t => t.name === "read_file")!;
        const result = await readTool.execute({ path: "package.json" });
        expect(result.success).toBe(true);
        expect(result.output).toContain("gx402");
    });

    test("read_file fails on missing file", async () => {
        const readTool = tools.find(t => t.name === "read_file")!;
        const result = await readTool.execute({ path: "definitely_not_a_file_12345.txt" });
        expect(result.success).toBe(false);
        expect(result.error).toContain("not found");
    });

    test("write_file creates and reads back", async () => {
        const writeTool = tools.find(t => t.name === "write_file")!;
        const readTool = tools.find(t => t.name === "read_file")!;
        const testPath = `${tmpDir}/gxai-test-${Date.now()}.txt`;
        const testContent = "hello from loop agent test";

        try {
            const writeResult = await writeTool.execute({ path: testPath, content: testContent });
            expect(writeResult.success).toBe(true);

            const readResult = await readTool.execute({ path: testPath });
            expect(readResult.success).toBe(true);
            expect(readResult.output).toBe(testContent);
        } finally {
            cleanup(testPath);
        }
    });

    test("edit_file replaces content", async () => {
        const writeTool = tools.find(t => t.name === "write_file")!;
        const editTool = tools.find(t => t.name === "edit_file")!;
        const readTool = tools.find(t => t.name === "read_file")!;
        const testPath = `${tmpDir}/gxai-edit-test-${Date.now()}.txt`;

        try {
            await writeTool.execute({ path: testPath, content: "hello world foo bar" });

            const editResult = await editTool.execute({
                path: testPath,
                target: "foo bar",
                replacement: "baz qux",
            });
            expect(editResult.success).toBe(true);

            const readResult = await readTool.execute({ path: testPath });
            expect(readResult.output).toBe("hello world baz qux");
        } finally {
            cleanup(testPath);
        }
    });

    test("edit_file fails on missing target", async () => {
        const writeTool = tools.find(t => t.name === "write_file")!;
        const editTool = tools.find(t => t.name === "edit_file")!;
        const testPath = `${tmpDir}/gxai-edit-miss-${Date.now()}.txt`;

        try {
            await writeTool.execute({ path: testPath, content: "hello world" });

            const editResult = await editTool.execute({
                path: testPath,
                target: "nonexistent content",
                replacement: "something",
            });
            expect(editResult.success).toBe(false);
            expect(editResult.error).toContain("not found");
        } finally {
            cleanup(testPath);
        }
    });

    test("exec runs command and returns output", async () => {
        const execTool = tools.find(t => t.name === "exec")!;
        // Use cross-platform echo
        const cmd = process.platform === "win32" ? "echo hello from exec" : "echo 'hello from exec'";
        const result = await execTool.execute({ command: cmd });
        expect(result.success).toBe(true);
        expect(result.output).toContain("hello from exec");
    });

    test("exec reports failed commands", async () => {
        const execTool = tools.find(t => t.name === "exec")!;
        const result = await execTool.execute({ command: "exit 1" });
        expect(result.success).toBe(false);
    });
});
