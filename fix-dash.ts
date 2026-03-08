import * as fs from 'fs';
let content = fs.readFileSync('src/dashboard.ts', 'utf8');
content = content.split('\\$').join('$');
content = content.split('\\`').join('`');
fs.writeFileSync('src/dashboard.ts', content);
