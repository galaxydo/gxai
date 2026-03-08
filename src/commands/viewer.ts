import { existsSync, readFileSync, unlinkSync } from "fs";
import { join } from "path";

export async function handleAnalytics(clear: boolean = false) {
    const queueDir = join(process.env.HOME || process.env.USERPROFILE || '/tmp', '.gxai');
    const queueFile = join(queueDir, 'analytics_queue.json');

    if (!existsSync(queueFile)) {
        console.log(`\x1b[33mNo analytics queue found at ${queueFile}\x1b[0m`);
        return;
    }

    if (clear) {
        try {
            unlinkSync(queueFile);
            console.log(`\x1b[32mAnalytics queue cleared.\x1b[0m`);
        } catch (e) {
            console.error(`\x1b[31mFailed to clear analytics queue:\x1b[0m`, e);
        }
        return;
    }

    let queue: any[] = [];
    try {
        const raw = readFileSync(queueFile, 'utf8');
        queue = JSON.parse(raw);
    } catch (e) {
        console.log(`\x1b[31mFailed to parse analytics queue:\x1b[0m ${e}`);
        return;
    }

    console.log(`\n\x1b[36m📊 GXAI Local Analytics Viewer\x1b[0m`);
    console.log(`\x1b[90mStore: ${queueFile}\x1b[0m\n`);

    if (!Array.isArray(queue) || queue.length === 0) {
        console.log(`\x1b[32mQueue is empty.\x1b[0m\n`);
        return;
    }

    console.log(`Found \x1b[1m${queue.length}\x1b[0m runs in offline queue.\n`);

    queue.forEach((run, i) => {
        const statusColor = run.status === 'success' ? '\x1b[32m' : '\x1b[31m';
        const date = new Date(run.timestamp).toLocaleString();

        console.log(`\x1b[1m[${i + 1}/${queue.length}]\x1b[0m ${statusColor}${run.status.toUpperCase()}\x1b[0m \x1b[35m${run.llm}\x1b[0m (\x1b[33m${run.duration}ms\x1b[0m)`);
        console.log(`\x1b[90mAgent: ${run.agentName || 'unnamed-agent'} | ID: ${run.id?.slice(0, 8)}... | ${date}\x1b[0m`);

        try {
            const inputStr = JSON.stringify(run.input);
            const inputPreview = inputStr.length > 100 ? inputStr.substring(0, 100) + '...' : inputStr;
            console.log(`\x1b[36mInput:\x1b[0m ${inputPreview}`);
        } catch (e) {
            console.log(`\x1b[36mInput:\x1b[0m [Unparseable]`);
        }

        if (run.error) {
            console.log(`\x1b[31mError:\x1b[0m ${run.error}`);
        }

        if (run.toolInvocations && Array.isArray(run.toolInvocations) && run.toolInvocations.length > 0) {
            console.log(`\x1b[34mTools:\x1b[0m ${run.toolInvocations.map((t: any) => t.tool || 'unknown').join(', ')}`);
        }

        console.log('\x1b[90m---\x1b[0m');
    });

    console.log(`\x1b[90mTip: Clear the queue with \`gx --analytics --clear\` or \`bun run analytics --clear\`\x1b[0m\n`);
}
