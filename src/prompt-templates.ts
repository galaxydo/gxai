/**
 * prompt-templates.ts — Reusable Prompt Templates
 *
 * Variable interpolation, composition, and conditional sections.
 *
 * Usage:
 *   const tpl = createTemplate('Hello {{name}}! {{#if role}}Role: {{role}}{{/if}}');
 *   const result = tpl.render({ name: 'Alice', role: 'admin' });
 */

export interface PromptTemplate {
    name: string;
    raw: string;
    render: (vars: Record<string, any>) => string;
    variables: string[];
}

/** Create a prompt template with {{variable}} interpolation */
export function createTemplate(template: string, name = 'unnamed'): PromptTemplate {
    // Extract variable names
    const varPattern = /\{\{(\w+)\}\}/g;
    const variables = new Set<string>();
    let match;
    while ((match = varPattern.exec(template)) !== null) {
        if (match[1] && !match[1].startsWith('#') && !match[1].startsWith('/')) {
            variables.add(match[1]);
        }
    }

    return {
        name,
        raw: template,
        variables: [...variables],
        render: (vars: Record<string, any>) => renderTemplate(template, vars),
    };
}

/** Render a template string with variables */
export function renderTemplate(template: string, vars: Record<string, any>): string {
    return _render(template, vars).trim();
}

function _render(template: string, vars: Record<string, any>): string {
    let result = template;

    // Handle {{#if var}}...{{/if}} conditionals
    result = result.replace(
        /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
        (_, key, content) => {
            return vars[key] ? _render(content, vars) : '';
        },
    );

    // Handle {{#unless var}}...{{/unless}} conditionals
    result = result.replace(
        /\{\{#unless\s+(\w+)\}\}([\s\S]*?)\{\{\/unless\}\}/g,
        (_, key, content) => {
            return !vars[key] ? _render(content, vars) : '';
        },
    );

    // Handle {{#each items}}...{{/each}} loops
    result = result.replace(
        /\{\{#each\s+(\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g,
        (_, key, content) => {
            const items = vars[key];
            if (!Array.isArray(items)) return '';
            return items.map((item: any, index: number) => {
                const itemVars = typeof item === 'object'
                    ? { ...vars, ...item, _index: index }
                    : { ...vars, _item: item, _index: index };
                return _render(content, itemVars);
            }).join('');
        },
    );

    // Handle {{variable}} interpolation
    result = result.replace(/\{\{(\w+)\}\}/g, (_, key) => {
        return vars[key] !== undefined ? String(vars[key]) : `{{${key}}}`;
    });

    return result;
}

/** Compose multiple templates into one */
export function composeTemplates(...templates: (PromptTemplate | string)[]): PromptTemplate {
    const parts = templates.map(t => typeof t === 'string' ? t : t.raw);
    const combined = parts.join('\n\n');
    return createTemplate(combined, 'composed');
}

/** Create a system prompt template */
export function systemPrompt(template: string): PromptTemplate {
    return createTemplate(template, 'system');
}

/** Create a user prompt template */
export function userPrompt(template: string): PromptTemplate {
    return createTemplate(template, 'user');
}
