// examples/self-healing-script.ts
// Demonstrates the LoopAgent creating a script that must produce expected output
// 
// Usage: GEMINI_API_KEY=xxx bun run examples/self-healing-script.ts
//
import { LoopAgent } from "../src/loop";
import type { LoopEvent } from "../src/loop";

const demoDir = "C:/temp/gxai-demo";

const agent = new LoopAgent({
    llm: "gemini-3-flash-preview",
    cwd: "C:/temp",
    maxIterations: 10,
    confidenceThreshold: 0.9,

    systemPrompt: `You are a senior developer. Write clean, production-quality Bun/TypeScript code.
When creating scripts, always make them executable and self-contained.
After writing a script, always execute it to verify it works correctly.
If execution fails, read the error, fix the code, and try again.
You are running on Windows. Use Windows-compatible paths (forward slashes work in Bun).`,

    outcomes: [
        {
            description: `A working TypeScript script exists at ${demoDir}/hello.ts`,
            validate: async (state) => {
                const file = Bun.file(`${demoDir}/hello.ts`);
                const exists = await file.exists();
                return { met: exists, reason: exists ? "File exists" : "File does not exist" };
            },
        },
        {
            description: "The script produces output containing 'Hello from GXAI!' and a timestamp when executed with 'bun run'",
            validate: async (state) => {
                const execResults = state.toolHistory
                    .filter(t => t.tool === "exec" && t.result.success)
                    .filter(t => t.params.command?.includes("hello.ts"));

                if (execResults.length === 0) {
                    return { met: false, reason: "Script has not been executed successfully yet" };
                }

                const lastExec = execResults[execResults.length - 1];
                const hasGreeting = lastExec.result.output.includes("Hello from GXAI!");
                const hasTimestamp = /\d{4}-\d{2}-\d{2}/.test(lastExec.result.output);

                if (!hasGreeting) return { met: false, reason: "Output missing 'Hello from GXAI!'" };
                if (!hasTimestamp) return { met: false, reason: "Output missing timestamp" };
                return { met: true, reason: "Script output contains greeting and timestamp" };
            },
        },
    ],
});

// ANSI colors for pretty output
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

console.log(bold("\n🔁 GXAI LoopAgent — Self-Healing Script Demo\n"));
console.log(dim("The agent will create a script, run it, and fix any issues until it works.\n"));

const { success, result, iterations, elapsedMs } = await agent.execute(
    `Create a TypeScript script at ${demoDir}/hello.ts that:
1. Prints "Hello from GXAI!" 
2. Prints the current date/time in ISO format
3. Prints a random joke (hardcoded is fine)

Use the write_file tool to create the directory and file.
Then use exec to run it with: bun run ${demoDir}/hello.ts`,
    (event: LoopEvent) => {
        switch (event.type) {
            case "iteration_start":
                console.log(cyan(`\n━━━ Iteration ${event.iteration} ━━━━━━━━━━━━━━━━━━━━━━`));
                break;
            case "intermediate_message":
                console.log(dim(`💭 ${event.message.substring(0, 300)}`));
                break;
            case "tool_start":
                console.log(yellow(`🔧 ${event.tool}`) + dim(` ${JSON.stringify(event.params).substring(0, 150)}`));
                break;
            case "tool_result": {
                const icon = event.result.success ? green("✓") : red("✗");
                console.log(`   ${icon} ${event.result.output.substring(0, 300).replace(/\n/g, "\n     ")}`);
                if (event.result.error) console.log(red(`   ⚠ ${event.result.error}`));
                break;
            }
            case "outcome_check":
                for (const o of event.outcomes) {
                    const icon = o.met ? green("✅") : red("❌");
                    console.log(`${icon} ${o.outcome.substring(0, 80)} ${dim(`(${(o.confidence * 100).toFixed(0)}%)`)}`);
                }
                break;
            case "complete":
                console.log(green(bold(`\n✨ Completed in ${event.iteration + 1} iterations (${(event.totalElapsedMs / 1000).toFixed(1)}s)`)));
                break;
            case "max_iterations_reached":
                console.log(red(bold(`\n⚠ Max iterations reached (${event.iteration})`)));
                break;
            case "error":
                console.log(red(`\n❌ Error: ${event.error}`));
                break;
        }
    }
);

console.log(dim(`\nResult: ${JSON.stringify(result)}`));
console.log(dim(`Success: ${success}, Iterations: ${iterations}, Elapsed: ${elapsedMs}ms`));
