/**
 * version.ts — CLI version command
 *
 * Prints version, runtime, and build info.
 */

export function handleVersion() {
    // Read version from package.json
    let version = 'unknown';
    try {
        const { join, dirname } = require('path');
        const { readFileSync } = require('fs');
        const { fileURLToPath } = require('url');

        // Search for package.json in parent directories
        const candidates = [
            join(__dirname, '..', '..', 'package.json'), // src/commands/version.ts (dev)
            join(__dirname, '..', 'package.json'),        // dist/commands/version.js
            join(__dirname, 'package.json'),              // flat
        ];

        for (const p of candidates) {
            try {
                const pkg = JSON.parse(readFileSync(p, 'utf-8'));
                version = pkg.version || version;
                break;
            } catch { /* continue */ }
        }
    } catch { /* fallback */ }

    const runtime = typeof Bun !== 'undefined' ? `Bun ${Bun.version}` : `Node ${process.version}`;

    console.log(`gx402 v${version}`);
    console.log(`Runtime: ${runtime}`);
    console.log(`Platform: ${process.platform} (${process.arch})`);
}
