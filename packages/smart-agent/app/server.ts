// smart-agent/app/server.ts
import { measure } from 'measure-fn';
import { start } from 'melina';
import path from 'path';

const appDir = path.join(import.meta.dir, 'src');

await measure('Melina server start', () => start({
    port: parseInt(process.env.BUN_PORT || "3737"),
    appDir,
    defaultTitle: 'smart-agent',
}));