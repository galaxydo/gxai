import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { resolveAndValidatePath, createFileSystemTools, serveFileSystemMCP } from "../src/fs-tools";
import * as fs from "fs/promises";
import * as path from "path";
import { fetchWithPayment } from "../src/payments"; // test if fetchWithPayment routes fine manually

describe("Agent File System Tools (MCP)", () => {
    const sandboxDir = path.resolve(path.join(process.cwd(), ".test-sandbox"));
    const outsideDir = path.resolve(process.cwd());

    beforeAll(async () => {
        // Setup sandbox
        await fs.rm(sandboxDir, { recursive: true, force: true }).catch(() => { });
        await fs.mkdir(sandboxDir, { recursive: true });
        await fs.writeFile(path.join(sandboxDir, "hello.txt"), "world", "utf8");
    });

    afterAll(async () => {
        await fs.rm(sandboxDir, { recursive: true, force: true }).catch(() => { });
    });

    describe("Path Resolution & Validation", () => {
        test("allows paths inside sandbox", () => {
            const safe = resolveAndValidatePath(path.join(sandboxDir, "hello.txt"), [sandboxDir]);
            expect(safe).toBe(path.join(sandboxDir, "hello.txt"));
        });

        test("allows exact sandbox dir", () => {
            const safe = resolveAndValidatePath(sandboxDir, [sandboxDir]);
            expect(safe).toBe(sandboxDir);
        });

        test("rejects paths outside sandbox", () => {
            expect(() => {
                resolveAndValidatePath(path.join(outsideDir, "index.ts"), [sandboxDir]);
            }).toThrow('Access denied');
        });

        test("rejects directory traversal attacks", () => {
            expect(() => {
                resolveAndValidatePath(path.join(sandboxDir, "../index.ts"), [sandboxDir]);
            }).toThrow('Access denied');
        });
    });

    describe("Local FileSystem Tools Handlers", () => {
        test("read_file succeeds", async () => {
            const tools = createFileSystemTools({ allowedDirs: [sandboxDir] });
            const readFile = tools.find(t => t.name === "read_file")!;
            const result = await readFile.handler({ path: path.join(sandboxDir, "hello.txt") });
            expect(result.content).toBe("world");
        });

        test("write_file and list_dir", async () => {
            const tools = createFileSystemTools({ allowedDirs: [sandboxDir] });
            const writeFile = tools.find(t => t.name === "write_file")!;
            const newFile = path.join(sandboxDir, "sub", "test.txt");

            await writeFile.handler({ path: newFile, content: "test write" });
            const created = await fs.readFile(newFile, "utf8");
            expect(created).toBe("test write");

            const listDir = tools.find(t => t.name === "list_dir")!;
            const result = await listDir.handler({ path: sandboxDir });
            expect(result.files.find((f: any) => f.name === "sub")?.isDirectory).toBe(true);
        });

        test("search_files", async () => {
            const tools = createFileSystemTools({ allowedDirs: [sandboxDir] });
            const searchFiles = tools.find(t => t.name === "search_files")!;
            const result = await searchFiles.handler({ path: sandboxDir, query: "test write" });

            expect(result.searchCompleted).toBe(true);
            expect(result.matches.length).toBe(1);
            expect(result.matches[0].content).toBe("test write");
            expect(result.matches[0].path.endsWith("test.txt")).toBe(true);
        });
    });

    describe("Local MCP Server (Bun)", () => {
        let serverInfo: ReturnType<typeof serveFileSystemMCP>;

        beforeAll(() => {
            serverInfo = serveFileSystemMCP({ port: 8443, allowedDirs: [sandboxDir] });
        });

        afterAll(() => {
            serverInfo.server.stop(true);
        });

        test("discovers tools over HTTP via GET /tools", async () => {
            const res = await fetch(`${serverInfo.url}/tools`);
            const tools = await res.json();
            expect(Array.isArray(tools)).toBe(true);
            expect(tools.length).toBe(4); // read, write, list, search
            expect(tools.find((t: any) => t.name === "read_file")).toBeDefined();
        });

        test("invokes tool over HTTP via POST /call", async () => {
            const res = await fetch(`${serverInfo.url}/call`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    method: "read_file",
                    params: { path: path.join(sandboxDir, "hello.txt") }
                })
            });

            const data = await res.json();
            expect(data.error).toBeUndefined();
            expect(data.content).toBe("world");
        });

        test("rejects out-of-bounds invocation over HTTP", async () => {
            const res = await fetch(`${serverInfo.url}/call`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    method: "read_file",
                    params: { path: path.join(sandboxDir, "../package.json") }
                })
            });

            expect(res.status).toBe(500);
            const data = await res.json();
            expect(data.error).toContain("Access denied: Path");
        });
    });
});
