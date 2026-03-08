/**
 * templates.ts — Prompt Template Library
 *
 * Reusable prompt templates with variable interpolation.
 * Supports named variables, default values, and composition.
 *
 * Usage:
 *   const tmpl = createTemplate('Summarize {{text}} in {{style:concise}} format');
 *   const prompt = tmpl({ text: 'long article' });
 *   // => "Summarize long article in concise format"
 */

export interface TemplateConfig {
    /** Template string with {{variable}} or {{variable:default}} placeholders */
    template: string;
    /** Optional description */
    description?: string;
    /** Required variable names (validated on render) */
    required?: string[];
}

export interface PromptTemplate {
    /** Render the template with variables */
    render: (vars: Record<string, string>) => string;
    /** List all variable names found in the template */
    variables: string[];
    /** The raw template string */
    raw: string;
    /** Description */
    description?: string;
}

/** Extract variable names and defaults from a template string */
function parseVariables(template: string): Array<{ name: string; defaultValue?: string }> {
    const regex = /\{\{(\w+)(?::([^}]*))?\}\}/g;
    const vars: Array<{ name: string; defaultValue?: string }> = [];
    const seen = new Set<string>();
    let match;
    while ((match = regex.exec(template)) !== null) {
        const name = match[1]!;
        if (!seen.has(name)) {
            seen.add(name);
            vars.push({ name, defaultValue: match[2] });
        }
    }
    return vars;
}

/** Create a reusable prompt template */
export function createTemplate(config: string | TemplateConfig): PromptTemplate {
    const templateStr = typeof config === 'string' ? config : config.template;
    const description = typeof config === 'string' ? undefined : config.description;
    const required = typeof config === 'string' ? [] : (config.required || []);
    const parsedVars = parseVariables(templateStr);

    return {
        raw: templateStr,
        description,
        variables: parsedVars.map(v => v.name),
        render: (vars: Record<string, string>): string => {
            // Check required vars
            for (const req of required) {
                if (vars[req] === undefined) {
                    throw new Error(`Missing required template variable: {{${req}}}`);
                }
            }

            return templateStr.replace(/\{\{(\w+)(?::([^}]*))?\}\}/g, (_match, name: string, defaultVal?: string) => {
                if (vars[name] !== undefined) return vars[name];
                if (defaultVal !== undefined) return defaultVal;
                return `{{${name}}}`; // Leave unresolved
            });
        },
    };
}

/** Compose multiple templates into a single prompt */
export function composeTemplates(
    templates: PromptTemplate[],
    separator = '\n\n'
): PromptTemplate {
    const combined = templates.map(t => t.raw).join(separator);
    return createTemplate(combined);
}

// ─── Built-in Templates ─────────────────────────────────

export const TEMPLATES = {
    /** Summarization template */
    summarize: createTemplate({
        template: 'Summarize the following {{format:text}} in {{style:concise}} format:\n\n{{content}}',
        description: 'Summarize content in a specified format and style',
        required: ['content'],
    }),

    /** Classification template */
    classify: createTemplate({
        template: 'Classify the following into one of these categories: {{categories}}.\n\nInput: {{input}}',
        description: 'Classify input into provided categories',
        required: ['categories', 'input'],
    }),

    /** Extraction template */
    extract: createTemplate({
        template: 'Extract the following fields from the text: {{fields}}.\n\nText: {{text}}',
        description: 'Extract structured fields from unstructured text',
        required: ['fields', 'text'],
    }),

    /** Translation template */
    translate: createTemplate({
        template: 'Translate the following from {{from:English}} to {{to}}:\n\n{{text}}',
        description: 'Translate text between languages',
        required: ['to', 'text'],
    }),

    /** Code review template */
    codeReview: createTemplate({
        template: 'Review the following {{language}} code for {{focus:bugs, security, and performance}}:\n\n```{{language}}\n{{code}}\n```',
        description: 'Code review with configurable focus areas',
        required: ['language', 'code'],
    }),
} as const;
