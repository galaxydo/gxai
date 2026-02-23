// smart-agent/src/index.test.ts
import { test, expect, describe, mock } from "bun:test"
import { Agent } from "./agent"
import { objToXml, xmlToObj } from "./xml"
import { loadSkills, formatSkillsForPrompt } from "./skills"
import { createBuiltinTools } from "./tools"
import type { Skill } from "./types"
import { writeFileSync, mkdirSync, rmSync } from "fs"
import { join } from "path"

// ── XML Tests ──

describe("XML", () => {
    test("round-trip simple object", () => {
        const obj = { name: "Alice", age: 30 }
        const xml = objToXml(obj)
        expect(xml).toContain("<name>Alice</name>")
        expect(xml).toContain("<age>30</age>")
        const parsed = xmlToObj(xml)
        expect(parsed.name).toBe("Alice")
        expect(parsed.age).toBe(30)
    })

    test("round-trip nested object", () => {
        const obj = { user: { name: "Bob", active: true } }
        const xml = objToXml(obj)
        const parsed = xmlToObj(xml)
        expect(parsed.user.name).toBe("Bob")
        expect(parsed.user.active).toBe(true)
    })

    test("round-trip array", () => {
        const obj = { items: ["a", "b", "c"] }
        const xml = objToXml(obj)
        const parsed = xmlToObj(xml)
        expect(parsed.items).toEqual(["a", "b", "c"])
    })

    test("handles plain text (no XML)", () => {
        expect(xmlToObj("just text")).toBe("just text")
    })

    test("parses agent response format", () => {
        const xml = `<response>
      <message>Creating a file</message>
      <tool_invocations>
        <invocation>
          <tool>write_file</tool>
          <params><path>test.txt</path><content>hello</content></params>
          <reasoning>Need to create the file</reasoning>
        </invocation>
      </tool_invocations>
    </response>`
        const parsed = xmlToObj(xml)
        expect(parsed.response.message).toBe("Creating a file")
        expect(parsed.response.tool_invocations.invocation.tool).toBe("write_file")
        expect(parsed.response.tool_invocations.invocation.params.path).toBe("test.txt")
    })
})

// ── Skills Tests ──

describe("Skills", () => {
    const tmpDir = join(process.cwd(), ".test-skills-tmp")

    test("loads inline skill", async () => {
        const skill: Skill = {
            name: "docker",
            description: "Docker management",
            commands: [{ name: "build", description: "Build image", usage: "docker build -t {tag} .", params: { tag: "Image tag" } }],
        }
        const loaded = await loadSkills([skill])
        expect(loaded).toHaveLength(1)
        expect(loaded[0].name).toBe("docker")
    })

    test("loads YAML skill file", async () => {
        mkdirSync(tmpDir, { recursive: true })
        const yamlContent = `name: git
description: Git version control
commands:
  - name: commit
    description: Create a commit
    usage: "git commit -m {message}"
    params:
      message: Commit message`
        const path = join(tmpDir, "git.yaml")
        writeFileSync(path, yamlContent)

        const loaded = await loadSkills([path])
        expect(loaded).toHaveLength(1)
        expect(loaded[0].name).toBe("git")
        expect(loaded[0].commands[0].name).toBe("commit")

        rmSync(tmpDir, { recursive: true, force: true })
    })

    test("formats skills for prompt", () => {
        const skills: Skill[] = [{
            name: "npm",
            description: "Node package manager",
            commands: [
                { name: "install", description: "Install packages", usage: "npm install {pkg}" },
                { name: "test", description: "Run tests", usage: "npm test" },
            ],
        }]
        const prompt = formatSkillsForPrompt(skills)
        expect(prompt).toContain("npm")
        expect(prompt).toContain("npm install {pkg}")
        expect(prompt).toContain("AVAILABLE SKILLS")
    })

    test("formats empty skills", () => {
        expect(formatSkillsForPrompt([])).toBe("")
    })
})

// ── Tools Tests ──

describe("Tools", () => {
    const tmpDir = join(process.cwd(), ".test-tools-tmp")

    test("creates 7 built-in tools", () => {
        const tools = createBuiltinTools("/tmp", 5000)
        expect(tools.length).toBe(7)
        expect(tools.map(t => t.name)).toEqual(["read_file", "write_file", "edit_file", "exec", "list_dir", "search", "schedule"])
    })

    test("read_file reads existing file", async () => {
        mkdirSync(tmpDir, { recursive: true })
        writeFileSync(join(tmpDir, "hello.txt"), "world")

        const tools = createBuiltinTools(tmpDir, 5000)
        const readFile = tools.find(t => t.name === "read_file")!
        const result = await readFile.execute({ path: "hello.txt" })
        expect(result.success).toBe(true)
        expect(result.output).toBe("world")

        rmSync(tmpDir, { recursive: true, force: true })
    })

    test("read_file fails on missing file", async () => {
        const tools = createBuiltinTools(".", 5000)
        const readFile = tools.find(t => t.name === "read_file")!
        const result = await readFile.execute({ path: "nonexistent-file-12345.txt" })
        expect(result.success).toBe(false)
        expect(result.error).toContain("not found")
    })

    test("write_file creates and reads back", async () => {
        mkdirSync(tmpDir, { recursive: true })
        const tools = createBuiltinTools(tmpDir, 5000)
        const writeFile = tools.find(t => t.name === "write_file")!
        const readFile = tools.find(t => t.name === "read_file")!

        await writeFile.execute({ path: "new.txt", content: "test content" })
        const result = await readFile.execute({ path: "new.txt" })
        expect(result.success).toBe(true)
        expect(result.output).toBe("test content")

        rmSync(tmpDir, { recursive: true, force: true })
    })

    test("edit_file replaces content", async () => {
        mkdirSync(tmpDir, { recursive: true })
        writeFileSync(join(tmpDir, "edit.txt"), "hello world")

        const tools = createBuiltinTools(tmpDir, 5000)
        const editFile = tools.find(t => t.name === "edit_file")!
        const readFile = tools.find(t => t.name === "read_file")!

        const editResult = await editFile.execute({ path: "edit.txt", target: "hello", replacement: "goodbye" })
        expect(editResult.success).toBe(true)

        const readResult = await readFile.execute({ path: "edit.txt" })
        expect(readResult.output).toBe("goodbye world")

        rmSync(tmpDir, { recursive: true, force: true })
    })

    test("edit_file fails on missing target", async () => {
        mkdirSync(tmpDir, { recursive: true })
        writeFileSync(join(tmpDir, "edit2.txt"), "hello world")

        const tools = createBuiltinTools(tmpDir, 5000)
        const editFile = tools.find(t => t.name === "edit_file")!
        const result = await editFile.execute({ path: "edit2.txt", target: "xyz", replacement: "abc" })
        expect(result.success).toBe(false)
        expect(result.error).toContain("not found")

        rmSync(tmpDir, { recursive: true, force: true })
    })

    test("exec runs command", async () => {
        const tools = createBuiltinTools(".", 5000)
        const exec = tools.find(t => t.name === "exec")!
        const result = await exec.execute({ command: "echo hello" })
        expect(result.success).toBe(true)
        expect(result.output).toContain("hello")
    })

    test("exec reports failed commands", async () => {
        const tools = createBuiltinTools(".", 5000)
        const exec = tools.find(t => t.name === "exec")!
        const result = await exec.execute({ command: "exit 1" })
        expect(result.success).toBe(false)
    })

    test("list_dir lists directory contents", async () => {
        mkdirSync(join(tmpDir, "sub"), { recursive: true })
        writeFileSync(join(tmpDir, "file1.txt"), "hello")
        writeFileSync(join(tmpDir, "sub", "file2.ts"), "world")

        const tools = createBuiltinTools(tmpDir, 5000)
        const listDir = tools.find(t => t.name === "list_dir")!
        const result = await listDir.execute({ path: "." })
        expect(result.success).toBe(true)
        expect(result.output).toContain("file1.txt")
        expect(result.output).toContain("sub/")

        rmSync(tmpDir, { recursive: true, force: true })
    })

    test("list_dir with depth 2 shows nested files", async () => {
        mkdirSync(join(tmpDir, "deep"), { recursive: true })
        writeFileSync(join(tmpDir, "deep", "nested.txt"), "deep content")

        const tools = createBuiltinTools(tmpDir, 5000)
        const listDir = tools.find(t => t.name === "list_dir")!
        const result = await listDir.execute({ path: ".", depth: 2 })
        expect(result.success).toBe(true)
        expect(result.output).toContain("nested.txt")

        rmSync(tmpDir, { recursive: true, force: true })
    })

    test("search finds pattern in files", async () => {
        mkdirSync(tmpDir, { recursive: true })
        writeFileSync(join(tmpDir, "code.ts"), "function greet() {\n  return 'hello'\n}")
        writeFileSync(join(tmpDir, "readme.md"), "# Project\nSome docs about greet function")

        const tools = createBuiltinTools(tmpDir, 5000)
        const search = tools.find(t => t.name === "search")!
        const result = await search.execute({ pattern: "greet", path: "." })
        expect(result.success).toBe(true)
        expect(result.output).toContain("code.ts")
        expect(result.output).toContain("greet")

        rmSync(tmpDir, { recursive: true, force: true })
    })

    test("search with include filter", async () => {
        mkdirSync(tmpDir, { recursive: true })
        writeFileSync(join(tmpDir, "app.ts"), "const x = 'target'")
        writeFileSync(join(tmpDir, "app.css"), ".target { color: red }")

        const tools = createBuiltinTools(tmpDir, 5000)
        const search = tools.find(t => t.name === "search")!
        const result = await search.execute({ pattern: "target", path: ".", include: "*.ts" })
        expect(result.success).toBe(true)
        expect(result.output).toContain("app.ts")
        expect(result.output).not.toContain("app.css")

        rmSync(tmpDir, { recursive: true, force: true })
    })

    test("search returns no matches message", async () => {
        mkdirSync(tmpDir, { recursive: true })
        writeFileSync(join(tmpDir, "empty.txt"), "nothing here")

        const tools = createBuiltinTools(tmpDir, 5000)
        const search = tools.find(t => t.name === "search")!
        const result = await search.execute({ pattern: "xyznonexistent", path: "." })
        expect(result.success).toBe(true)
        expect(result.output).toContain("No matches")

        rmSync(tmpDir, { recursive: true, force: true })
    })
})

// ── Agent Tests ──

describe("Agent", () => {
    test("constructor allows empty objectives for plan()", () => {
        const agent = new Agent({ model: "test" })
        expect(agent).toBeDefined()
    })

    test("run() throws without objectives", async () => {
        const agent = new Agent({ model: "test" })
        const gen = agent.run("hello")
        await expect(gen.next()).rejects.toThrow("No objectives defined")
    })

    test("constructor accepts valid config with objectives", () => {
        const agent = new Agent({
            model: "gemini-3-flash-preview",
            objectives: [{
                name: "test",
                description: "A test objective",
                validate: () => ({ met: true, reason: "always" }),
            }],
        })
        expect(agent).toBeDefined()
    })

    test("constructor accepts inline skills", () => {
        const agent = new Agent({
            model: "test",
            skills: [{
                name: "docker",
                description: "Docker",
                commands: [{ name: "build", description: "Build", usage: "docker build" }],
            }],
            objectives: [{
                name: "done",
                description: "Finish",
                validate: () => ({ met: true, reason: "ok" }),
            }],
        })
        expect(agent).toBeDefined()
    })
})

// ── Objectives Tests ──

describe("Objectives", () => {
    const { hydrateObjective } = require("./objectives")
    const tmpDir = join(process.cwd(), ".test-obj-tmp")

    test("file_exists — met when file exists", async () => {
        mkdirSync(tmpDir, { recursive: true })
        writeFileSync(join(tmpDir, "check.txt"), "hello")

        const obj = hydrateObjective({
            name: "file_check",
            description: "Check file",
            type: "file_exists",
            params: { path: "check.txt" },
        }, tmpDir)

        const result = await obj.validate({
            messages: [], iteration: 0, toolHistory: [], touchedFiles: new Set(),
        })
        expect(result.met).toBe(true)
        rmSync(tmpDir, { recursive: true, force: true })
    })

    test("file_exists — not met when missing", async () => {
        const obj = hydrateObjective({
            name: "missing",
            description: "Missing file",
            type: "file_exists",
            params: { path: "nonexistent-12345.txt" },
        }, ".")

        const result = await obj.validate({
            messages: [], iteration: 0, toolHistory: [], touchedFiles: new Set(),
        })
        expect(result.met).toBe(false)
    })

    test("command_succeeds — met when last exec succeeded", () => {
        const obj = hydrateObjective({
            name: "cmd",
            description: "Command check",
            type: "command_succeeds",
            params: { command: "bun test" },
        }, ".")

        const result = obj.validate({
            messages: [],
            iteration: 0,
            toolHistory: [{
                iteration: 0,
                tool: "exec",
                params: { command: "bun test" },
                result: { success: true, output: "pass" },
            }],
            touchedFiles: new Set(),
        })
        expect(result.met).toBe(true)
    })

    test("command_succeeds — not met when not run", () => {
        const obj = hydrateObjective({
            name: "cmd",
            description: "Command check",
            type: "command_succeeds",
            params: { command: "bun test" },
        }, ".")

        const result = obj.validate({
            messages: [], iteration: 0, toolHistory: [], touchedFiles: new Set(),
        })
        expect(result.met).toBe(false)
    })

    test("command_output_contains — checks output text", () => {
        const obj = hydrateObjective({
            name: "output",
            description: "Output check",
            type: "command_output_contains",
            params: { command: "echo", text: "hello" },
        }, ".")

        const met = obj.validate({
            messages: [],
            iteration: 0,
            toolHistory: [{
                iteration: 0,
                tool: "exec",
                params: { command: "echo hello" },
                result: { success: true, output: "hello world" },
            }],
            touchedFiles: new Set(),
        })
        expect(met.met).toBe(true)

        const notMet = obj.validate({
            messages: [],
            iteration: 0,
            toolHistory: [{
                iteration: 0,
                tool: "exec",
                params: { command: "echo bye" },
                result: { success: true, output: "bye world" },
            }],
            touchedFiles: new Set(),
        })
        expect(notMet.met).toBe(false)
    })
})

