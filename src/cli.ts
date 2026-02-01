#!/usr/bin/env bun
// GXAI CLI Entry Point

import { parseArgs } from "util";
import { handleServe } from "./commands/serve";

const HELP = `
🧠 GXAI - AI Agent Framework with Analytics

Usage:
  gx --serve             Start analytics dashboard
  gx --help              Show this help message

Options:
  --serve                Start the analytics web dashboard
  --port <number>        Port for web dashboard (default: 3002)
  --help                 Show help message

Examples:
  gx --serve
  gx --serve --port 8080

For programmatic usage, import from 'gx402':
  import { Agent, LLM } from 'gx402';
`;

async function main() {
    const { values } = parseArgs({
        options: {
            serve: { type: 'boolean' },
            port: { type: 'string' },
            help: { type: 'boolean', short: 'h' },
        },
        allowPositionals: true,
    });

    if (values.help) {
        console.log(HELP);
        process.exit(0);
    }

    if (values.serve) {
        const port = values.port ? parseInt(values.port) : 3002;
        await handleServe(port);
        return;
    }

    // Default: show help
    console.log(HELP);
}

main().catch((e) => {
    console.error("Error:", e);
    process.exit(1);
});
