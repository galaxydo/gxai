/**
 * config-profiles.ts — Agent Configuration Profiles
 *
 * Named configuration profiles for switching between
 * dev/staging/prod agent setups.
 *
 * Usage:
 *   const profiles = new ConfigProfileManager()
 *     .register('dev', { llm: 'gpt-4o-mini', maxCostUSD: 1 })
 *     .register('prod', { llm: 'gpt-4o', maxCostUSD: 10 })
 *     .setActive('dev');
 *
 *   const config = profiles.getActive(); // dev config
 */

export interface ConfigProfile<T = Record<string, any>> {
    /** Profile name */
    name: string;
    /** Profile description */
    description?: string;
    /** Configuration values */
    config: T;
    /** Environment variables to match for auto-selection */
    envMatch?: string;
}

export class ConfigProfileManager<T = Record<string, any>> {
    private profiles = new Map<string, ConfigProfile<T>>();
    private activeProfile: string | null = null;
    private baseConfig: Partial<T> = {};

    /** Set base configuration (shared across all profiles) */
    setBase(config: Partial<T>): this {
        this.baseConfig = config;
        return this;
    }

    /** Register a named profile */
    register(name: string, config: T, description?: string, envMatch?: string): this {
        this.profiles.set(name, { name, description, config, envMatch });
        if (!this.activeProfile) this.activeProfile = name;
        return this;
    }

    /** Set the active profile */
    setActive(name: string): this {
        if (!this.profiles.has(name)) {
            throw new Error(`Profile "${name}" not found. Available: ${this.profileNames.join(', ')}`);
        }
        this.activeProfile = name;
        return this;
    }

    /** Get the active profile's config (merged with base) */
    getActive(): T {
        if (!this.activeProfile) {
            throw new Error('No active profile set');
        }
        const profile = this.profiles.get(this.activeProfile)!;
        return { ...this.baseConfig, ...profile.config } as T;
    }

    /** Get a specific profile's config */
    getProfile(name: string): T | undefined {
        const profile = this.profiles.get(name);
        if (!profile) return undefined;
        return { ...this.baseConfig, ...profile.config } as T;
    }

    /** Get active profile name */
    get activeName(): string | null {
        return this.activeProfile;
    }

    /** Get all profile names */
    get profileNames(): string[] {
        return [...this.profiles.keys()];
    }

    /** Get all profiles with metadata */
    listProfiles(): Array<{ name: string; description?: string; isActive: boolean }> {
        return [...this.profiles.values()].map(p => ({
            name: p.name,
            description: p.description,
            isActive: p.name === this.activeProfile,
        }));
    }

    /** Auto-select profile based on environment */
    autoSelect(env?: string): this {
        const envValue = env ?? (typeof process !== 'undefined' ? process.env.NODE_ENV : undefined);
        if (!envValue) return this;

        for (const [name, profile] of this.profiles) {
            if (profile.envMatch === envValue) {
                this.activeProfile = name;
                return this;
            }
        }
        return this;
    }

    /** Clone the active config with overrides */
    withOverrides(overrides: Partial<T>): T {
        return { ...this.getActive(), ...overrides };
    }

    /** Remove a profile */
    remove(name: string): this {
        this.profiles.delete(name);
        if (this.activeProfile === name) {
            this.activeProfile = this.profiles.size > 0
                ? this.profiles.keys().next().value ?? null
                : null;
        }
        return this;
    }
}

/** Create a new profile manager */
export function createProfileManager<T = Record<string, any>>(): ConfigProfileManager<T> {
    return new ConfigProfileManager<T>();
}
