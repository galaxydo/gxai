/**
 * middleware-order.ts — Named Middleware with Dependency Ordering
 *
 * Define middleware with explicit before/after constraints.
 * The sorter produces a deterministic execution order via topological sort.
 *
 * Usage:
 *   const chain = new MiddlewareChain()
 *     .add({ name: 'auth', fn: authMiddleware })
 *     .add({ name: 'logging', fn: logMiddleware, before: ['auth'] })
 *     .add({ name: 'metrics', fn: metricsMiddleware, after: ['auth'] })
 *     .build();
 *
 *   await chain.execute(context);
 */

export interface NamedMiddleware<TCtx = any> {
    /** Unique middleware name */
    name: string;
    /** Middleware function */
    fn: (ctx: TCtx, next: () => Promise<void>) => Promise<void>;
    /** Run before these middleware names */
    before?: string[];
    /** Run after these middleware names */
    after?: string[];
    /** Whether this middleware is enabled (default: true) */
    enabled?: boolean;
}

export interface MiddlewareChainResult {
    /** Ordered middleware names */
    order: string[];
    /** Execute all middleware in order */
    execute: (ctx: any) => Promise<void>;
}

export class MiddlewareChain<TCtx = any> {
    private middlewares: NamedMiddleware<TCtx>[] = [];

    /** Add a middleware to the chain */
    add(mw: NamedMiddleware<TCtx>): this {
        if (this.middlewares.some(m => m.name === mw.name)) {
            throw new Error(`Middleware "${mw.name}" already registered`);
        }
        this.middlewares.push(mw);
        return this;
    }

    /** Remove a middleware by name */
    remove(name: string): this {
        this.middlewares = this.middlewares.filter(m => m.name !== name);
        return this;
    }

    /** Build the ordered chain */
    build(): MiddlewareChainResult {
        const active = this.middlewares.filter(m => m.enabled !== false);
        const ordered = topologicalSort(active);

        return {
            order: ordered.map(m => m.name),
            execute: async (ctx: TCtx) => {
                let idx = 0;
                const next = async (): Promise<void> => {
                    if (idx >= ordered.length) return;
                    const mw = ordered[idx++]!;
                    await mw.fn(ctx, next);
                };
                await next();
            },
        };
    }

    /** Get all registered middleware names */
    get names(): string[] {
        return this.middlewares.map(m => m.name);
    }

    /** Get count */
    get count(): number {
        return this.middlewares.length;
    }
}

/** Topological sort with before/after constraints */
function topologicalSort<TCtx>(middlewares: NamedMiddleware<TCtx>[]): NamedMiddleware<TCtx>[] {
    const nameToMw = new Map(middlewares.map(m => [m.name, m]));
    const graph = new Map<string, Set<string>>(); // edges: name → must come after these
    const inDegree = new Map<string, number>();

    // Initialize
    for (const mw of middlewares) {
        graph.set(mw.name, new Set());
        inDegree.set(mw.name, 0);
    }

    // Build edges from "after" constraints: mw runs after deps
    for (const mw of middlewares) {
        if (mw.after) {
            for (const dep of mw.after) {
                if (nameToMw.has(dep)) {
                    graph.get(dep)!.add(mw.name); // dep → mw (mw comes after dep)
                    inDegree.set(mw.name, (inDegree.get(mw.name) || 0) + 1);
                }
            }
        }

        // "before" constraints: mw runs before targets
        if (mw.before) {
            for (const target of mw.before) {
                if (nameToMw.has(target)) {
                    graph.get(mw.name)!.add(target); // mw → target (mw comes before target)
                    inDegree.set(target, (inDegree.get(target) || 0) + 1);
                }
            }
        }
    }

    // Kahn's algorithm
    const queue: string[] = [];
    for (const [name, degree] of inDegree) {
        if (degree === 0) queue.push(name);
    }

    const result: NamedMiddleware<TCtx>[] = [];
    while (queue.length > 0) {
        const name = queue.shift()!;
        result.push(nameToMw.get(name)!);

        for (const neighbor of graph.get(name) || []) {
            const newDegree = (inDegree.get(neighbor) || 1) - 1;
            inDegree.set(neighbor, newDegree);
            if (newDegree === 0) queue.push(neighbor);
        }
    }

    if (result.length !== middlewares.length) {
        const missing = middlewares.filter(m => !result.includes(m)).map(m => m.name);
        throw new Error(`Circular middleware dependency detected involving: ${missing.join(', ')}`);
    }

    return result;
}
