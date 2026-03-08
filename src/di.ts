/**
 * di.ts — Dependency Injection Container
 *
 * IoC container for agent services and providers.
 * Supports singleton/transient lifetimes, factory functions, and scoped containers.
 *
 * Usage:
 *   const container = new DIContainer();
 *   container.singleton('logger', () => new Logger());
 *   container.transient('handler', () => new Handler());
 *   const logger = container.resolve<Logger>('logger');
 */

export type Factory<T = any> = (container: DIContainer) => T;

export interface Registration<T = any> {
    factory: Factory<T>;
    lifetime: 'singleton' | 'transient';
    instance?: T;
    tags?: string[];
}

export class DIContainer {
    private registrations = new Map<string, Registration>();
    private parent?: DIContainer;

    constructor(parent?: DIContainer) {
        this.parent = parent;
    }

    /** Register a singleton (created once, cached) */
    singleton<T>(name: string, factory: Factory<T>, tags?: string[]): this {
        this.registrations.set(name, { factory, lifetime: 'singleton', tags });
        return this;
    }

    /** Register a transient (new instance each resolve) */
    transient<T>(name: string, factory: Factory<T>, tags?: string[]): this {
        this.registrations.set(name, { factory, lifetime: 'transient', tags });
        return this;
    }

    /** Register a constant value */
    value<T>(name: string, val: T, tags?: string[]): this {
        this.registrations.set(name, { factory: () => val, lifetime: 'singleton', instance: val, tags });
        return this;
    }

    /** Resolve a dependency */
    resolve<T = any>(name: string): T {
        const reg = this.registrations.get(name);
        if (reg) {
            if (reg.lifetime === 'singleton') {
                if (reg.instance === undefined) {
                    reg.instance = reg.factory(this);
                }
                return reg.instance as T;
            }
            return reg.factory(this) as T;
        }

        // Check parent container
        if (this.parent) {
            return this.parent.resolve<T>(name);
        }

        throw new Error(`Dependency "${name}" not registered`);
    }

    /** Try to resolve (returns undefined if not found) */
    tryResolve<T = any>(name: string): T | undefined {
        try { return this.resolve<T>(name); }
        catch { return undefined; }
    }

    /** Check if a dependency is registered */
    has(name: string): boolean {
        return this.registrations.has(name) || (this.parent?.has(name) ?? false);
    }

    /** Create a child scope (inherits parent registrations) */
    createScope(): DIContainer {
        return new DIContainer(this);
    }

    /** Get all registered names */
    get names(): string[] {
        const parentNames = this.parent?.names ?? [];
        return [...new Set([...this.registrations.keys(), ...parentNames])];
    }

    /** Get registrations by tag */
    getByTag(tag: string): string[] {
        const results: string[] = [];
        for (const [name, reg] of this.registrations) {
            if (reg.tags?.includes(tag)) results.push(name);
        }
        if (this.parent) {
            results.push(...this.parent.getByTag(tag));
        }
        return [...new Set(results)];
    }

    /** Reset all singleton instances (forces re-creation) */
    reset(): void {
        for (const reg of this.registrations.values()) {
            if (reg.lifetime === 'singleton') {
                reg.instance = undefined;
            }
        }
    }

    /** Remove a registration */
    remove(name: string): boolean {
        return this.registrations.delete(name);
    }

    /** Clear all registrations */
    clear(): void {
        this.registrations.clear();
    }
}
