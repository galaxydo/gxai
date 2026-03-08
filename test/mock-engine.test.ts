import { test, expect, describe } from "bun:test";
import { Agent } from "../src/agent";
import { AgentMock } from "../src/mock-engine";
import { z } from "zod";

describe("AgentMock", () => {
    test("intercepts agent execution and yields mock result", async () => {
        const agent = new Agent({
            name: "test",
            llm: "claude-3-5-sonnet" as any,
            inputFormat: z.object({ query: z.string() }),
            outputFormat: z.object({ answer: z.string() })
        });

        const mock = new AgentMock(agent, {
            sequence: [
                { matchPrompt: "hello", output: { answer: "mocked hello" } },
                { matchPrompt: "bye", output: { answer: "mocked bye" } }
            ]
        });

        const r1 = await agent.run({ query: "hello there" });
        expect(r1.answer).toBe("mocked hello");

        const r2 = await agent.run({ query: "well bye now" });
        expect(r2.answer).toBe("mocked bye");

        expect(mock.isExhausted()).toBe(true);
    });

    test("throws error when passthrough disabled and no match", async () => {
        const agent = new Agent({
            llm: "claude-3-5-sonnet" as any,
            inputFormat: z.object({ query: z.string() }),
            outputFormat: z.object({ a: z.string() })
        });

        new AgentMock(agent, { sequence: [] });

        expect(agent.run({ query: "test" })).rejects.toThrow(/AgentMock Error/);
    });

    test("simulates tool invocations properly", async () => {
        const agent = new Agent({
            llm: "claude-3-5-sonnet" as any,
            inputFormat: z.object({ query: z.string() }),
            outputFormat: z.object({ a: z.string() }),
            servers: [{ name: "db", url: "http://test", description: "test db" }]
        });

        let toolCbCount = 0;
        agent.onEvent((ev) => {
            if (ev.type === 'tool_complete') {
                toolCbCount++;
            }
        });

        new AgentMock(agent, {
            sequence: [{
                matchPrompt: /.*/,
                output: { a: "done" },
                simulateTools: [
                    { server: "db", tool: "query", result: { rows: 2 } }
                ]
            }]
        });

        const res = await agent.run({ query: "simulate" });
        expect(res.a).toBe("done");
        expect(toolCbCount).toBe(1);
    });
});
