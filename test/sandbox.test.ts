import { test, expect, describe } from "bun:test";
import { createSandboxTools } from "../src/sandbox";

describe("Isolated Sandbox", () => {
    test("runs simple math", async () => {
        const tools = createSandboxTools();
        const runCode = tools[0]!;

        const res = await runCode.handler({ code: "result = 1 + 2;" });
        expect(res.success).toBe(true);
        expect(res.result).toBe(3);
        expect(res.logs).toBeUndefined();
    });

    test("captures console.log", async () => {
        const tools = createSandboxTools();
        const runCode = tools[0]!;

        const res = await runCode.handler({ code: "console.log('hello', 'world'); result = 42;" });
        expect(res.success).toBe(true);
        expect(res.logs).toEqual(["hello world"]);
        expect(res.result).toBe(42);
    });

    test("handles syntax errors gracefully", async () => {
        const tools = createSandboxTools();
        const runCode = tools[0]!;

        const res = await runCode.handler({ code: "const x = ;" });
        expect(res.success).toBe(false);
        expect(res.error).toBeDefined();
        expect(res.error).toContain("Unexpected token");
    });

    test("timeout kills infinite loops", async () => {
        const tools = createSandboxTools({ timeoutMs: 100 });
        const runCode = tools[0]!;

        const start = Date.now();
        const res = await runCode.handler({ code: "while(true){}" });
        expect(res.success).toBe(false);
        expect(res.error).toContain("Script execution timed out");
        expect(Date.now() - start).toBeLessThan(1000); // Guarded
    });

    test("cannot access host process variables natively", async () => {
        const tools = createSandboxTools();
        const runCode = tools[0]!;

        // Try to access Bun or process
        let res = await runCode.handler({ code: "try { result = process.env } catch(e) { result = 'blocked' }" });
        expect(res.result).toBe('blocked');

        res = await runCode.handler({ code: "try { result = Bun.version } catch(e) { result = 'blocked' }" });
        expect(res.result).toBe('blocked');
    });
});
