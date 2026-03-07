// @ts-nocheck — depends on planned src/loop.ts module
// examples/self-healing-script.ts
// Demonstrates LoopAgent: create a TypeScript script, run it, self-heal until it works.
import { measure } from "measure-fn";
import { LoopAgent } from "../src/loop";
import type { LoopEvent, LoopState } from "../src/loop";
import path from "path";

// Files get written here — inside the project, not temp
const outputDir = path.resolve(import.meta.dir, "../.output/loop-demo");

const agent = new LoopAgent({
    llm: "gemini-3-flash-preview",
    cwd: path.resolve(import.meta.dir, ".."),
    maxIterations: 10,
    confidenceThreshold: 0.9,
    temperature: 0.3,
    maxTokens: 8000,
    systemPrompt: `You are a TypeScript developer using the Bun runtime on Windows.
Write files to: ${outputDir}
Use forward slashes in all paths. When running scripts use: bun run <path>`,
    outcomes: [
        {
            description: `A working TypeScript script exists at ${outputDir}/hello.ts`,
            validate: async (state: LoopState) => {
                const file = Bun.file(`${outputDir}/hello.ts`);
                const exists = await file.exists();
                return {
                    met: exists,
                    reason: exists ? "Script file exists" : "Script file not found",
                };
            },
        },
        {
            description: "The script produces output containing 'Hello from GXAI!' and a timestamp when executed",
            validate: async (state: LoopState) => {
                const lastExec = state.toolHistory
                    .filter(h => h.tool === "exec" && h.params.command?.includes("hello.ts"))
                    .pop();
                if (!lastExec) return { met: false, reason: "No exec of hello.ts found" };
                const output = lastExec.result?.output ?? "";
                const hasHello = output.includes("Hello from GXAI!");
                const hasTimestamp = /\d{4}-\d{2}-\d{2}/.test(output);
                return {
                    met: hasHello && hasTimestamp,
                    reason: hasHello && hasTimestamp
                        ? "Output contains greeting and timestamp"
                        : `Missing: ${!hasHello ? "'Hello from GXAI!'" : ""}${!hasTimestamp ? " timestamp" : ""}`,
                };
            },
        },
    ],
});

// --- Run ---
await measure("LoopAgent Demo", async (m) => {
    console.log("\n🔁 LoopAgent — Self-Healing Script Demo");
    console.log(`   Output dir: ${outputDir}\n`);

    const { success, iterations, elapsedMs } = await agent.execute(
        `Create a TypeScript script at ${outputDir}/hello.ts that:
1. Prints "Hello from GXAI!"
2. Prints the current date/time as ISO string  
3. Picks a random joke from an array and prints it

Then execute it with "bun run ${outputDir}/hello.ts" to verify it works.`,
        (event: LoopEvent) => {
            switch (event.type) {
                case "iteration_start":
                    console.log(`\n━━━ Iteration ${event.iteration} ━━━━━━━━━━━━━━━━━━━━━━`);
                    break;
                case "tool_start":
                    console.log(`🔧 ${event.tool} ${JSON.stringify(event.params)}`);
                    break;
                case "tool_result":
                    const icon = event.result.success ? "✅" : "❌";
                    const output = event.result.output?.substring(0, 120) || "";
                    console.log(`   ${icon} ${output}`);
                    if (event.result.error) console.log(`   ⚠ ${event.result.error}`);
                    break;
                case "outcome_check":
                    for (const o of event.outcomes) {
                        const check = o.met ? "✅" : "❌";
                        console.log(`${check} ${o.outcome} (${(o.confidence * 100).toFixed(0)}%)`);
                    }
                    break;
                case "complete":
                    console.log(`\n✨ Completed in ${event.iteration + 1} iterations (${(event.totalElapsedMs / 1000).toFixed(1)}s)`);
                    break;
                case "max_iterations_reached":
                    console.log(`\n⚠ Max iterations reached (${event.iteration})`);
                    break;
                case "error":
                    console.log(`\n💥 Error: ${event.error}`);
                    break;
            }
        }
    );

    console.log(`\nSuccess: ${success}, Iterations: ${iterations}, Elapsed: ${elapsedMs}ms`);
});
