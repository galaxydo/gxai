/**
 * schema-evolution.ts — Agent Schema Evolution
 *
 * Version input/output schemas with automatic migration between versions.
 * Allows agents to evolve their data formats while maintaining backwards compatibility.
 *
 * Usage:
 *   const evolved = createSchemaEvolution('user-profile')
 *     .version(1, z.object({ name: z.string() }))
 *     .version(2, z.object({ name: z.string(), email: z.string() }), {
 *       up: (v1) => ({ ...v1, email: 'unknown@example.com' }),
 *       down: (v2) => ({ name: v2.name }),
 *     })
 *     .build();
 *
 *   evolved.migrate({ name: 'Alice' }, 1, 2);
 *   // => { name: 'Alice', email: 'unknown@example.com' }
 */

import { z } from 'zod';

export interface Migration<TFrom = any, TTo = any> {
    /** Migrate data forward (old → new) */
    up: (data: TFrom) => TTo;
    /** Migrate data backward (new → old) */
    down?: (data: TTo) => TFrom;
}

export interface SchemaVersion<T = any> {
    version: number;
    schema: z.ZodType<T>;
    migration?: Migration;
}

export interface SchemaEvolution {
    /** Schema name */
    name: string;
    /** Current (latest) version number */
    currentVersion: number;
    /** All registered versions */
    versions: number[];
    /** Migrate data between versions */
    migrate: (data: any, fromVersion: number, toVersion: number) => any;
    /** Validate data against a specific version */
    validate: (data: any, version: number) => { success: boolean; data?: any; error?: string };
    /** Get schema for a version */
    getSchema: (version: number) => z.ZodType<any> | undefined;
}

export class SchemaEvolutionBuilder {
    private _name: string;
    private _versions: Map<number, SchemaVersion> = new Map();

    constructor(name: string) {
        this._name = name;
    }

    /** Register a schema version */
    version<T>(
        versionNum: number,
        schema: z.ZodType<T>,
        migration?: Migration,
    ): this {
        this._versions.set(versionNum, { version: versionNum, schema, migration });
        return this;
    }

    /** Build the evolution chain */
    build(): SchemaEvolution {
        const versions = this._versions;
        const sortedVersions = [...versions.keys()].sort((a, b) => a - b);
        const name = this._name;

        if (sortedVersions.length === 0) {
            throw new Error(`SchemaEvolution "${name}" has no versions`);
        }

        return {
            name,
            currentVersion: sortedVersions[sortedVersions.length - 1]!,
            versions: sortedVersions,

            migrate(data: any, fromVersion: number, toVersion: number): any {
                if (fromVersion === toVersion) return data;
                if (!versions.has(fromVersion)) {
                    throw new Error(`Unknown source version ${fromVersion}`);
                }
                if (!versions.has(toVersion)) {
                    throw new Error(`Unknown target version ${toVersion}`);
                }

                let current = data;
                const direction = toVersion > fromVersion ? 'up' : 'down';

                if (direction === 'up') {
                    for (let v = fromVersion + 1; v <= toVersion; v++) {
                        const ver = versions.get(v);
                        if (!ver?.migration?.up) {
                            throw new Error(`No up migration for version ${v}`);
                        }
                        current = ver.migration.up(current);
                    }
                } else {
                    for (let v = fromVersion; v > toVersion; v--) {
                        const ver = versions.get(v);
                        if (!ver?.migration?.down) {
                            throw new Error(`No down migration for version ${v}`);
                        }
                        current = ver.migration.down(current);
                    }
                }

                return current;
            },

            validate(data: any, version: number) {
                const ver = versions.get(version);
                if (!ver) return { success: false, error: `Unknown version ${version}` };
                const result = ver.schema.safeParse(data);
                if (result.success) {
                    return { success: true, data: result.data };
                }
                return { success: false, error: result.error.message };
            },

            getSchema(version: number) {
                return versions.get(version)?.schema;
            },
        };
    }
}

/** Create a new schema evolution builder */
export function createSchemaEvolution(name: string): SchemaEvolutionBuilder {
    return new SchemaEvolutionBuilder(name);
}
