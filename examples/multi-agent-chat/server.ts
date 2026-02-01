#!/usr/bin/env bun
/**
 * Multi-Agent Chat Server
 * Starts the Melina frontend for the multi-agent chat example
 */
import { serve, createAppRouter } from 'melina';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const appDir = join(__dirname, 'app');
const port = parseInt(process.argv[2]) || 3003;

console.log(`🤖 Starting Multi-Agent Chat...`);
console.log(`📂 App directory: ${appDir}`);

const router = createAppRouter({ appDir });
await serve(router, { port });

console.log(`✅ Multi-Agent Chat running at http://localhost:${port}`);
console.log(`📊 Analytics Dashboard: http://localhost:3001`);
console.log(`\nAgents will run on ports 4001-4004`);
console.log(`Use the UI to start/stop agent processes`);
