/**
 * guardrails.ts — Agent Input/Output Safety Checks
 *
 * Configurable rules and rejection policies for agent I/O.
 *
 * Usage:
 *   const guard = new Guardrails()
 *     .addRule('no-pii', checkNoPII, { action: 'reject' })
 *     .addRule('max-length', checkMaxLength, { action: 'truncate' });
 *   const result = await guard.checkInput(input);
 *   if (!result.passed) console.log(result.violations);
 */

export type GuardrailAction = 'reject' | 'warn' | 'sanitize';

export type GuardrailCheckFn = (content: string) => boolean | string;

export interface GuardrailRule {
    name: string;
    check: GuardrailCheckFn;
    action: GuardrailAction;
    description?: string;
    enabled?: boolean;
}

export interface GuardrailViolation {
    rule: string;
    action: GuardrailAction;
    message: string;
    original?: string;
}

export interface GuardrailResult {
    passed: boolean;
    content: string;
    violations: GuardrailViolation[];
    checkedRules: number;
}

export class Guardrails {
    private rules: GuardrailRule[] = [];

    /** Add a guardrail rule */
    addRule(name: string, check: GuardrailCheckFn, opts: { action?: GuardrailAction; description?: string } = {}): this {
        this.rules.push({
            name,
            check,
            action: opts.action ?? 'reject',
            description: opts.description,
            enabled: true,
        });
        return this;
    }

    /** Enable/disable a rule */
    setEnabled(name: string, enabled: boolean): this {
        const rule = this.rules.find(r => r.name === name);
        if (rule) rule.enabled = enabled;
        return this;
    }

    /** Check content against all rules */
    check(content: string): GuardrailResult {
        const violations: GuardrailViolation[] = [];
        let current = content;
        let checkedRules = 0;

        for (const rule of this.rules) {
            if (rule.enabled === false) continue;
            checkedRules++;

            const result = rule.check(current);

            if (result === true) continue; // passed

            const message = typeof result === 'string' ? result : `Failed rule: ${rule.name}`;

            if (rule.action === 'reject') {
                violations.push({ rule: rule.name, action: 'reject', message, original: current });
                return { passed: false, content: current, violations, checkedRules };
            }

            if (rule.action === 'sanitize' && typeof result === 'string') {
                violations.push({ rule: rule.name, action: 'sanitize', message });
                current = result;
            } else {
                violations.push({ rule: rule.name, action: rule.action, message });
            }
        }

        return {
            passed: violations.filter(v => v.action === 'reject').length === 0,
            content: current,
            violations,
            checkedRules,
        };
    }

    /** Check input (alias) */
    checkInput(input: string): GuardrailResult {
        return this.check(input);
    }

    /** Check output (alias) */
    checkOutput(output: string): GuardrailResult {
        return this.check(output);
    }

    /** Get all rule names */
    get ruleNames(): string[] {
        return this.rules.map(r => r.name);
    }

    /** Get rule count */
    get ruleCount(): number {
        return this.rules.length;
    }
}

// ─── Built-in Rules ─────────────────────────────────────

/** Block content exceeding a character limit */
export function maxLengthRule(limit: number): GuardrailCheckFn {
    return (content) => content.length <= limit ? true : `Content exceeds ${limit} characters (got ${content.length})`;
}

/** Block content containing potential PII patterns */
export function noPIIRule(): GuardrailCheckFn {
    const patterns = [
        /\b\d{3}[-.]?\d{2}[-.]?\d{4}\b/,  // SSN
        /\b\d{16}\b/,                        // Credit card (simplified)
        /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, // Email
    ];
    return (content) => {
        for (const pattern of patterns) {
            if (pattern.test(content)) return `Potential PII detected (${pattern.source})`;
        }
        return true;
    };
}

/** Block specific keywords */
export function blockKeywords(keywords: string[]): GuardrailCheckFn {
    return (content) => {
        const lower = content.toLowerCase();
        for (const kw of keywords) {
            if (lower.includes(kw.toLowerCase())) return `Blocked keyword: "${kw}"`;
        }
        return true;
    };
}

/** Require content to be non-empty */
export function nonEmptyRule(): GuardrailCheckFn {
    return (content) => content.trim().length > 0 ? true : 'Content is empty';
}
