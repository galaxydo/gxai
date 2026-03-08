/**
 * output-formatters.ts — Pluggable Output Formatting
 *
 * Transform agent output into various formats:
 * Markdown, HTML, JSON, plain text, or custom.
 *
 * Usage:
 *   const formatted = formatOutput(data, 'markdown');
 *   const custom = formatOutput(data, myCustomFormatter);
 */

export type OutputFormat = 'json' | 'markdown' | 'html' | 'text' | 'yaml';
export type OutputFormatter = (data: any) => string;

/** Format data with a named format or custom formatter */
export function formatOutput(data: any, format: OutputFormat | OutputFormatter): string {
    if (typeof format === 'function') return format(data);

    switch (format) {
        case 'json': return formatJSON(data);
        case 'markdown': return formatMarkdown(data);
        case 'html': return formatHTML(data);
        case 'text': return formatText(data);
        case 'yaml': return formatYAML(data);
        default: return formatJSON(data);
    }
}

/** Pretty JSON */
function formatJSON(data: any): string {
    return JSON.stringify(data, null, 2);
}

/** Markdown format */
function formatMarkdown(data: any): string {
    if (typeof data === 'string') return data;
    if (Array.isArray(data)) {
        return data.map((item, i) => {
            if (typeof item === 'object' && item !== null) {
                const fields = Object.entries(item)
                    .map(([k, v]) => `  - **${k}**: ${v}`)
                    .join('\n');
                return `${i + 1}. Item\n${fields}`;
            }
            return `${i + 1}. ${item}`;
        }).join('\n\n');
    }
    if (typeof data === 'object' && data !== null) {
        const entries = Object.entries(data);
        if (entries.length === 0) return '_Empty_';

        return entries.map(([key, value]) => {
            if (typeof value === 'object' && value !== null) {
                return `## ${key}\n\n${formatMarkdown(value)}`;
            }
            return `**${key}**: ${value}`;
        }).join('\n\n');
    }
    return String(data);
}

/** HTML format */
function formatHTML(data: any): string {
    if (typeof data === 'string') return `<p>${escapeHtml(data)}</p>`;
    if (Array.isArray(data)) {
        const items = data.map(item => {
            if (typeof item === 'object' && item !== null) {
                const fields = Object.entries(item)
                    .map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(String(v))}</dd>`)
                    .join('');
                return `<li><dl>${fields}</dl></li>`;
            }
            return `<li>${escapeHtml(String(item))}</li>`;
        }).join('');
        return `<ol>${items}</ol>`;
    }
    if (typeof data === 'object' && data !== null) {
        const rows = Object.entries(data)
            .map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(String(v))}</td></tr>`)
            .join('');
        return `<table>${rows}</table>`;
    }
    return `<span>${escapeHtml(String(data))}</span>`;
}

/** Plain text format */
function formatText(data: any): string {
    if (typeof data === 'string') return data;
    if (Array.isArray(data)) {
        return data.map((item, i) => {
            if (typeof item === 'object' && item !== null) {
                const fields = Object.entries(item).map(([k, v]) => `  ${k}: ${v}`).join('\n');
                return `${i + 1}.\n${fields}`;
            }
            return `${i + 1}. ${item}`;
        }).join('\n');
    }
    if (typeof data === 'object' && data !== null) {
        return Object.entries(data).map(([k, v]) => `${k}: ${v}`).join('\n');
    }
    return String(data);
}

/** Simple YAML format */
function formatYAML(data: any, indent = 0): string {
    const prefix = '  '.repeat(indent);
    if (typeof data === 'string') return data.includes('\n') ? `|\n${data.split('\n').map(l => `${prefix}  ${l}`).join('\n')}` : data;
    if (typeof data === 'number' || typeof data === 'boolean') return String(data);
    if (data === null || data === undefined) return 'null';
    if (Array.isArray(data)) {
        return data.map(item => `${prefix}- ${formatYAML(item, indent + 1)}`).join('\n');
    }
    if (typeof data === 'object') {
        return Object.entries(data).map(([k, v]) => {
            const val = formatYAML(v, indent + 1);
            if (typeof v === 'object' && v !== null) {
                return `${prefix}${k}:\n${val}`;
            }
            return `${prefix}${k}: ${val}`;
        }).join('\n');
    }
    return String(data);
}

function escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Create a custom formatter from a template string */
export function templateFormatter(template: string): OutputFormatter {
    return (data: any) => {
        if (typeof data !== 'object' || data === null) return String(data);
        let result = template;
        for (const [key, value] of Object.entries(data)) {
            result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value));
        }
        return result;
    };
}
