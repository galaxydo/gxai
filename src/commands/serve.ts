// CLI commands for GXAI
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";

export async function handleServe(port: number) {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);

    // Search for app directory in multiple locations
    const candidates = [
        join(__dirname, "..", "..", "app"), // src/commands/serve.ts (dev)
        join(__dirname, "..", "app"),       // dist/index.js (production)
        join(__dirname, "app")              // flat structure
    ];

    const appDir = candidates.find(path => existsSync(path));

    if (!appDir) {
        console.error(`❌ Dashboard app directory not found. Searched at:`);
        candidates.forEach(c => console.error(`   - ${c}`));
        console.error("This installation of gxai might be corrupted or missing files.");
        process.exit(1);
    }

    console.log(`🧠 Starting GXAI Analytics Dashboard...`);
    console.log(`📂 App directory: ${appDir}`);

    try {
        // Dynamically import melina
        // @ts-ignore
        const { serve, createAppRouter } = await import("melina");

        await serve(createAppRouter({
            appDir,
        }), { port });

        console.log(`✅ Dashboard running at http://localhost:${port}`);
    } catch (e) {
        console.error("Failed to start dashboard:", e);
        process.exit(1);
    }
}
