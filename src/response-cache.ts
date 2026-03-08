/**
 * response-cache.ts — Generic LRU Response Cache
 *
 * A reusable, typed LRU cache with TTL, stats tracking, and getOrSet().
 * Use this for caching any value (API responses, embeddings, computed results).
 *
 * NOTE: For LLM-specific caching (wraps callLLM transparently), see cache.ts.
 *
 * Usage:
 *   const cache = new ResponseCache({ maxSize: 100, ttlMs: 60_000 });
 *   const key = cache.hash(input);
 *   const cached = cache.get(key);
 *   if (!cached) { cache.set(key, response); }
 */

export interface ResponseCacheConfig {
    /** Maximum entries (default: 200) */
    maxSize?: number;
    /** TTL in milliseconds (default: 5 minutes) */
    ttlMs?: number;
}

interface CacheEntry<T = any> {
    value: T;
    createdAt: number;
    accessedAt: number;
    hits: number;
}

export interface CacheStats {
    size: number;
    maxSize: number;
    hits: number;
    misses: number;
    hitRate: number;
    evictions: number;
}

export class ResponseCache<T = any> {
    private cache = new Map<string, CacheEntry<T>>();
    private maxSize: number;
    private ttlMs: number;
    private totalHits = 0;
    private totalMisses = 0;
    private totalEvictions = 0;

    constructor(config: ResponseCacheConfig = {}) {
        this.maxSize = config.maxSize ?? 200;
        this.ttlMs = config.ttlMs ?? 5 * 60 * 1000;
    }

    /** Generate a deterministic hash for an input */
    hash(input: any): string {
        const str = typeof input === 'string' ? input : JSON.stringify(input, Object.keys(input).sort());
        let h = 0;
        for (let i = 0; i < str.length; i++) {
            const ch = str.charCodeAt(i);
            h = ((h << 5) - h + ch) | 0;
        }
        return `cache-${(h >>> 0).toString(36)}`;
    }

    /** Get a cached value (returns undefined if expired or missing) */
    get(key: string): T | undefined {
        const entry = this.cache.get(key);
        if (!entry) {
            this.totalMisses++;
            return undefined;
        }

        // Check TTL
        if (Date.now() - entry.createdAt > this.ttlMs) {
            this.cache.delete(key);
            this.totalMisses++;
            return undefined;
        }

        entry.accessedAt = Date.now();
        entry.hits++;
        this.totalHits++;
        return entry.value;
    }

    /** Set a cached value */
    set(key: string, value: T): void {
        // Evict if at capacity
        if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
            this.evictLRU();
        }

        this.cache.set(key, {
            value,
            createdAt: Date.now(),
            accessedAt: Date.now(),
            hits: 0,
        });
    }

    /** Check if key exists and is not expired */
    has(key: string): boolean {
        const entry = this.cache.get(key);
        if (!entry) return false;
        if (Date.now() - entry.createdAt > this.ttlMs) {
            this.cache.delete(key);
            return false;
        }
        return true;
    }

    /** Delete a specific entry */
    delete(key: string): boolean {
        return this.cache.delete(key);
    }

    /** Clear all entries */
    clear(): void {
        this.cache.clear();
    }

    /** Get cache stats */
    get stats(): CacheStats {
        return {
            size: this.cache.size,
            maxSize: this.maxSize,
            hits: this.totalHits,
            misses: this.totalMisses,
            hitRate: this.totalHits + this.totalMisses > 0
                ? this.totalHits / (this.totalHits + this.totalMisses)
                : 0,
            evictions: this.totalEvictions,
        };
    }

    /** Evict expired entries */
    prune(): number {
        const now = Date.now();
        let pruned = 0;
        for (const [key, entry] of this.cache) {
            if (now - entry.createdAt > this.ttlMs) {
                this.cache.delete(key);
                pruned++;
            }
        }
        return pruned;
    }

    /** Get or compute a value */
    async getOrSet(key: string, compute: () => Promise<T>): Promise<T> {
        const cached = this.get(key);
        if (cached !== undefined) return cached;
        const value = await compute();
        this.set(key, value);
        return value;
    }

    private evictLRU(): void {
        let oldest: string | null = null;
        let oldestTime = Infinity;

        for (const [key, entry] of this.cache) {
            if (entry.accessedAt < oldestTime) {
                oldestTime = entry.accessedAt;
                oldest = key;
            }
        }

        if (oldest) {
            this.cache.delete(oldest);
            this.totalEvictions++;
        }
    }
}
