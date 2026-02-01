#!/usr/bin/env bun
/**
 * Geeksy CLI - Entry point for the multi-agent orchestration system
 */

import { $ } from 'bun';

const args = process.argv.slice(2);
const command = args[0];

const DEFAULT_PORT = 3005;

/**
 * Check if geeksy is already running via bgr
 */
async function isAlreadyRunning(): Promise<boolean> {
  try {
    const result = await $`bgr --list`.quiet();
    const output = result.text();
    // Look for a line that contains both "geeksy" and "Running" (the status indicator)
    const lines = output.split('\n');
    for (const line of lines) {
      // Match the process name line specifically
      if (line.includes("'geeksy'") || line.includes('Name: geeksy')) {
        // Check if the status shows Running (not Stopped)
        const statusIdx = lines.indexOf(line);
        for (let i = statusIdx; i < Math.min(statusIdx + 8, lines.length); i++) {
          if (lines[i].includes('Status:') && lines[i].includes('Running')) {
            return true;
          }
        }
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Open browser to the given URL
 */
async function openBrowser(url: string): Promise<void> {
  try {
    // Try different commands based on OS
    const commands = [
      ['xdg-open', url],      // Linux
      ['open', url],          // macOS
      ['start', url],         // Windows (cmd)
    ];

    for (const [cmd, arg] of commands) {
      try {
        await $`${cmd} ${arg}`.quiet();
        console.log(`🌐 Opened browser at ${url}`);
        return;
      } catch {
        continue;
      }
    }
    console.log(`📋 Open your browser at: ${url}`);
  } catch {
    console.log(`📋 Open your browser at: ${url}`);
  }
}

/**
 * Start geeksy via bgr (background runner)
 */
async function startViaBgr(port: number): Promise<boolean> {
  const scriptPath = import.meta.path;
  const cwd = process.cwd();

  try {
    // Check if already running
    if (await isAlreadyRunning()) {
      console.log('✅ Geeksy is already running!');
      return true;
    }

    console.log('🚀 Starting Geeksy via bgr...');

    await $`bgr --name geeksy --command "bun run ${scriptPath} serve ${port}" --directory ${cwd} --force`.quiet();

    // Wait for server to be ready
    console.log('⏳ Waiting for server to start...');
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500));
      try {
        const response = await fetch(`http://localhost:${port}/api/agents`);
        if (response.ok) {
          console.log('✅ Geeksy is running!');
          return true;
        }
      } catch {
        // Not ready yet
      }
    }

    console.log('⚠️ Server started but taking longer than expected...');
    return true;
  } catch (e) {
    console.error('❌ Failed to start via bgr:', e);
    return false;
  }
}

/**
 * Interactive start command - spawns via bgr and opens browser
 */
async function startCommand(port: number): Promise<void> {
  console.log(`
╭────────────────────────────────────────────────────╮
│                                                    │
│   👾 Welcome to Geeksy!                            │
│   Multi-Agent Orchestration System                 │
│                                                    │
╰────────────────────────────────────────────────────╯
`);

  // Start via bgr
  const started = await startViaBgr(port);
  if (!started) {
    console.log('💡 Try running directly with: geeksy serve');
    return;
  }

  const url = `http://localhost:${port}`;

  // Open browser
  await openBrowser(url);

  console.log(`
╭────────────────────────────────────────────────────╮
│                                                    │
│   🤖 Geeksy is running!                            │
│                                                    │
│   Dashboard:  ${url.padEnd(32)}│
│                                                    │
│   Commands:                                        │
│   • bgr --logs geeksy   View logs                  │
│   • bgr --delete geeksy Stop the server            │
│                                                    │
╰────────────────────────────────────────────────────╯
`);
}

switch (command) {
  case 'start':
    const startPort = parseInt(args[1]) || DEFAULT_PORT;
    await startCommand(startPort);
    break;

  case 'serve':
  case 'dashboard': {
    const servePort = parseInt(args[1]) || DEFAULT_PORT;
    // Dynamic import to avoid loading Melina for other commands
    const { startDashboard } = await import('./server');
    await startDashboard(servePort);
    break;
  }

  case 'stop':
    try {
      await $`bgr --delete geeksy`.quiet();
      console.log('🛑 Geeksy stopped');
    } catch {
      console.log('⚠️ Geeksy is not running');
    }
    break;

  case 'logs':
    await $`bgr --logs geeksy`;
    break;

  case 'status':
    if (await isAlreadyRunning()) {
      console.log('✅ Geeksy is running');
      try {
        const response = await fetch(`http://localhost:${DEFAULT_PORT}/api/agents`);
        const agents = await response.json();
        console.log(`   📊 ${agents.length} agents registered`);
      } catch {
        console.log('   ⚠️ Could not connect to API');
      }
    } else {
      console.log('❌ Geeksy is not running');
      console.log('   Run: npx geeksy start');
    }
    break;

  case 'help':
  default:
    console.log(`
👾 Geeksy - Multi-Agent Orchestration System

Usage:
  geeksy start [port]     Start Geeksy (spawns via bgr, opens browser)
  geeksy serve [port]     Start the server directly (default: 3005)
  geeksy stop             Stop the running Geeksy instance
  geeksy status           Check if Geeksy is running
  geeksy logs             View server logs
  geeksy help             Show this help message

Examples:
  npx geeksy start        # Start Geeksy and open browser
  npx geeksy start 8080   # Start on custom port
  npx geeksy stop         # Stop Geeksy
`);
    break;
}
