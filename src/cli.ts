#!/usr/bin/env bun
// GXAI CLI Entry Point

import { parseArgs } from "util";
import { handleServe } from "./commands/serve";
import { handleAnalytics } from "./commands/viewer";

const HELP = `
🧠 GXAI - AI Agent Framework with Analytics

Usage:
  gx --serve             Start analytics dashboard
  gx --analytics         View local analytics queue
  gx --help              Show this help message

Options:
  --serve                Start the analytics web dashboard
  --port <number>        Port for web dashboard (default: 3002)
  --analytics            View local offline analytics
  --clear                Clear the local offline analytics queue
  --help                 Show help message

Examples:
  gx --serve
  gx --analytics
  gx --analytics --clear

For programmatic usage, import from 'gx402':
  import { Agent, LLM } from 'gx402';
`;

async function main() {
  const { values } = parseArgs({
    options: {
      serve: { type: 'boolean' },
      port: { type: 'string' },
      analytics: { type: 'boolean' },
      clear: { type: 'boolean' },
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

  if (values.analytics) {
    await handleAnalytics(values.clear);
    return;
  }

  // Default: show help
  console.log(HELP);
}

main().catch((e) => {
  console.error("Error:", e);
  process.exit(1);
});
