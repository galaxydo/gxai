#!/usr/bin/env bun
// GXAI CLI Entry Point

import { parseArgs } from "util";
import { handleServe } from "./commands/serve";
import { handleAnalytics } from "./commands/viewer";
import { handleHealth } from "./commands/health";
import { handleVersion } from "./commands/version";

const HELP = `
🧠 GXAI - AI Agent Framework (gx402)

Usage:
  gx --serve             Start analytics dashboard
  gx --analytics         View local analytics queue
  gx --health            Run environment health check
  gx --version           Show version info
  gx --help              Show this help message

Options:
  --serve                Start the analytics web dashboard
  --port <number>        Port for web dashboard (default: 3002)
  --analytics            View local offline analytics
  --clear                Clear the local offline analytics queue
  --health               Check runtime, deps, API keys, and queue
  --version, -v          Show version, runtime, and platform
  --help, -h             Show help message

Examples:
  gx --serve
  gx --serve --port 4000
  gx --analytics
  gx --analytics --clear
  gx --health
  gx --version

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
      health: { type: 'boolean' },
      version: { type: 'boolean', short: 'v' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });

  if (values.version) {
    handleVersion();
    return;
  }

  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }

  if (values.health) {
    await handleHealth();
    return;
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
