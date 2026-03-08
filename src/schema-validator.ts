/**
 * schema-validator.ts — Runtime Schema Validation
 *
 * Validate agent inputs/outputs with detailed error paths.
 *
 * Usage:
 *   const schema = object({
 *     name: string().minLength(1),
 *     age: number().min(0).max(150),
 *     email: string().pattern(/.+@.+/),
 *   });
 *   const result = schema.validate({ name: '', age: -1 });
 */

export interface ValidationError {
    path: string;
    message: string;
    value?: any;
}

export interface ValidationResult {
    valid: boolean;
    errors: ValidationError[];
}

export abstract class SchemaField<T = any> {
    protected rules: Array<{ check: (v: any) => boolean; message: string }> = [];
    protected _optional = false;

    optional(): this { this._optional = true; return this; }

    validate(value: any, path = ''): ValidationError[] {
        if (value === undefined || value === null) {
            if (this._optional) return [];
            return [{ path: path || 'root', message: 'Required field is missing', value }];
        }
        const errors: ValidationError[] = [];
        for (const rule of this.rules) {
            if (!rule.check(value)) {
                errors.push({ path: path || 'root', message: rule.message, value });
            }
        }
        return errors;
    }
}

export class StringField extends SchemaField<string> {
    constructor() {
        super();
        this.rules.push({ check: (v) => typeof v === 'string', message: 'Expected string' });
    }

    minLength(min: number): this {
        this.rules.push({ check: (v) => typeof v === 'string' && v.length >= min, message: `Minimum length: ${min}` });
        return this;
    }

    maxLength(max: number): this {
        this.rules.push({ check: (v) => typeof v === 'string' && v.length <= max, message: `Maximum length: ${max}` });
        return this;
    }

    pattern(re: RegExp): this {
        this.rules.push({ check: (v) => typeof v === 'string' && re.test(v), message: `Must match pattern: ${re}` });
        return this;
    }

    oneOf(values: string[]): this {
        this.rules.push({ check: (v) => values.includes(v), message: `Must be one of: ${values.join(', ')}` });
        return this;
    }
}

export class NumberField extends SchemaField<number> {
    constructor() {
        super();
        this.rules.push({ check: (v) => typeof v === 'number' && !isNaN(v), message: 'Expected number' });
    }

    min(min: number): this {
        this.rules.push({ check: (v) => typeof v === 'number' && v >= min, message: `Minimum: ${min}` });
        return this;
    }

    max(max: number): this {
        this.rules.push({ check: (v) => typeof v === 'number' && v <= max, message: `Maximum: ${max}` });
        return this;
    }

    integer(): this {
        this.rules.push({ check: (v) => Number.isInteger(v), message: 'Must be integer' });
        return this;
    }
}

export class BooleanField extends SchemaField<boolean> {
    constructor() {
        super();
        this.rules.push({ check: (v) => typeof v === 'boolean', message: 'Expected boolean' });
    }
}

export class ArrayField extends SchemaField<any[]> {
    private itemSchema?: SchemaField;

    constructor(itemSchema?: SchemaField) {
        super();
        this.itemSchema = itemSchema;
        this.rules.push({ check: (v) => Array.isArray(v), message: 'Expected array' });
    }

    minItems(min: number): this {
        this.rules.push({ check: (v) => Array.isArray(v) && v.length >= min, message: `Minimum items: ${min}` });
        return this;
    }

    maxItems(max: number): this {
        this.rules.push({ check: (v) => Array.isArray(v) && v.length <= max, message: `Maximum items: ${max}` });
        return this;
    }

    validate(value: any, path = ''): ValidationError[] {
        const errors = super.validate(value, path);
        if (errors.length > 0 || !this.itemSchema || !Array.isArray(value)) return errors;
        for (let i = 0; i < value.length; i++) {
            errors.push(...this.itemSchema.validate(value[i], `${path}[${i}]`));
        }
        return errors;
    }
}

export class ObjectSchema extends SchemaField<Record<string, any>> {
    private fields: Record<string, SchemaField> = {};

    constructor(fields: Record<string, SchemaField>) {
        super();
        this.fields = fields;
    }

    validate(value: any, path = ''): ValidationError[] {
        if (value === undefined || value === null) {
            if (this._optional) return [];
            return [{ path: path || 'root', message: 'Required object is missing', value }];
        }
        if (typeof value !== 'object' || Array.isArray(value)) {
            return [{ path: path || 'root', message: 'Expected object', value }];
        }
        const errors: ValidationError[] = [];
        for (const [key, schema] of Object.entries(this.fields)) {
            const fieldPath = path ? `${path}.${key}` : key;
            errors.push(...schema.validate(value[key], fieldPath));
        }
        return errors;
    }

    /** Validate and return result */
    check(value: any): ValidationResult {
        const errors = this.validate(value);
        return { valid: errors.length === 0, errors };
    }
}

// ─── Factory Functions ──────────────────────────────────

export function string(): StringField { return new StringField(); }
export function number(): NumberField { return new NumberField(); }
export function boolean(): BooleanField { return new BooleanField(); }
export function array(itemSchema?: SchemaField): ArrayField { return new ArrayField(itemSchema); }
export function object(fields: Record<string, SchemaField>): ObjectSchema { return new ObjectSchema(fields); }
