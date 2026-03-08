/**
 * preprocessors.ts — Agent Input Preprocessors
 *
 * Transform and validate raw input before agent processing.
 * Chain multiple preprocessors for sanitization, normalization, enrichment.
 *
 * Usage:
 *   const processor = chainPreprocessors(
 *     trimStrings(),
 *     validateLength({ maxLength: 1000 }),
 *     addTimestamp(),
 *   );
 *   const processed = await processor(rawInput);
 */

export type Preprocessor<T = any> = (input: T) => T | Promise<T>;

/** Chain multiple preprocessors into one */
export function chainPreprocessors<T>(...preprocessors: Preprocessor<T>[]): Preprocessor<T> {
    return async (input: T): Promise<T> => {
        let current = input;
        for (const pp of preprocessors) {
            current = await pp(current);
        }
        return current;
    };
}

// ─── Built-in Preprocessors ─────────────────────────────

/** Trim all string values in an object */
export function trimStrings(): Preprocessor {
    return (input: any) => {
        if (typeof input === 'string') return input.trim();
        if (typeof input !== 'object' || input === null) return input;

        const result: any = Array.isArray(input) ? [] : {};
        for (const [key, value] of Object.entries(input)) {
            result[key] = typeof value === 'string' ? value.trim() : value;
        }
        return result;
    };
}

/** Validate that string fields don't exceed maxLength */
export function validateLength(opts: { maxLength: number; truncate?: boolean }): Preprocessor {
    return (input: any) => {
        if (typeof input === 'string') {
            if (input.length > opts.maxLength) {
                if (opts.truncate) return input.substring(0, opts.maxLength);
                throw new Error(`Input exceeds max length of ${opts.maxLength}`);
            }
            return input;
        }
        if (typeof input !== 'object' || input === null) return input;

        const result: any = { ...input };
        for (const [key, value] of Object.entries(result)) {
            if (typeof value === 'string' && value.length > opts.maxLength) {
                if (opts.truncate) {
                    result[key] = value.substring(0, opts.maxLength);
                } else {
                    throw new Error(`Field "${key}" exceeds max length of ${opts.maxLength}`);
                }
            }
        }
        return result;
    };
}

/** Add a timestamp field to the input */
export function addTimestamp(field = 'processedAt'): Preprocessor {
    return (input: any) => {
        if (typeof input !== 'object' || input === null) return input;
        return { ...input, [field]: Date.now() };
    };
}

/** Remove specified fields from input */
export function stripFields(...fields: string[]): Preprocessor {
    return (input: any) => {
        if (typeof input !== 'object' || input === null) return input;
        const result = { ...input };
        for (const field of fields) {
            delete result[field];
        }
        return result;
    };
}

/** Set default values for missing fields */
export function withDefaults(defaults: Record<string, any>): Preprocessor {
    return (input: any) => {
        if (typeof input !== 'object' || input === null) return input;
        const result = { ...input };
        for (const [key, value] of Object.entries(defaults)) {
            if (result[key] === undefined || result[key] === null) {
                result[key] = value;
            }
        }
        return result;
    };
}

/** Rename fields in input */
export function renameFields(mapping: Record<string, string>): Preprocessor {
    return (input: any) => {
        if (typeof input !== 'object' || input === null) return input;
        const result = { ...input };
        for (const [oldKey, newKey] of Object.entries(mapping)) {
            if (result[oldKey] !== undefined) {
                result[newKey] = result[oldKey];
                delete result[oldKey];
            }
        }
        return result;
    };
}

/** Custom transform with a function */
export function customPreprocessor<T>(fn: (input: T) => T | Promise<T>): Preprocessor<T> {
    return fn;
}
