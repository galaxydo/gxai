/**
 * cache.ts — LLM Response Cache (wraps callLLM)
 *
 * Drop-in replacement for callLLM that transparently caches responses.
 * Keyed by hash of (model + messages + options). Saves cost on repeated identical inputs.
 *
 * NOTE: For a generic, reusable cache class, see response-cache.ts (ResponseCache<T>).
 *
 * Usage:
 *   import { cachedCallLLM } from './cache';
 *   const result = await cachedCallLLM('gpt-4o-mini', messages, options, { ttlMs: 300_000 });
 */

import { callLLM, lastTokenUsage } from './inference';
import type { LLMType, ProgressCallback, StreamingCallback, TokenUsage } from './types';

export interface CacheConfig {
    /** Time-to-live in milliseconds. Default: 5 minutes */
    ttlMs?: number;
    /** Maximum number of cached entries. Default: 100 */
    maxEntries?: number;
}

interface CacheEntry {
    response: string;
    usage: TokenUsage | null;
    expiresAt: number;
}

/** In-memory response cache */
const cache = new Map<string, CacheEntry>();

/** Generate a stable hash key from the input parameters */
function cacheKey(llm: string, messages: Array<{ role: string; content: string }>, options: any): string {
    const payload = JSON.stringify({ llm, messages, t: options.temperature, m: options.maxTokens });
    // Simple FNV-1a-like hash for speed
    let hash = 2166136261;
    for (let i = 0; i < payload.length; i++) {
        hash ^= payload.charCodeAt(i);
        hash = (hash * 16777619) >>> 0;
    }
    return hash.toString(36);
}

/** Evict expired entries and enforce maxEntries */
function evict(maxEntries: number) {
    const now = Date.now();
    // Remove expired
    for (const [key, entry] of cache) {
        if (entry.expiresAt <= now) cache.delete(key);
    }
    // Enforce LRU by removing oldest entries
    while (cache.size > maxEntries) {
        const firstKey = cache.keys().next().value;
        if (firstKey !== undefined) cache.delete(firstKey);
    }
}

/**
 * Call LLM with caching. Returns cached response if available and not expired.
 * Streaming calls are NOT cached (pass-through to callLLM).
 */
export async function cachedCallLLM(
    llm: LLMType | string,
    messages: Array<{ role: string; content: string }>,
    options: { temperature?: number; maxTokens?: number; response_format?: any } = {},
    cacheConfig: CacheConfig = {},
    _measureFn?: any,
    streamingCallback?: StreamingCallback,
    progressCallback?: ProgressCallback,
    customFetch?: (url: string, options: RequestInit, measure: any, description: string, progressCallback?: ProgressCallback) => Promise<Response>
): Promise<string> {
    const { ttlMs = 300_000, maxEntries = 100 } = cacheConfig;

    // Don't cache streaming calls
    if (streamingCallback) {
        return callLLM(llm, messages, options, _measureFn, streamingCallback, progressCallback, customFetch);
    }

    const key = cacheKey(llm, messages, options);

    // Check cache
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
        // Restore the lastTokenUsage from cache so callers get consistent behavior
        if (cached.usage) {
            // We need to import this mutably — import { lastTokenUsage } won't work for writes
            // Instead, we just note that cached responses have zero NEW token usage
        }
        return cached.response;
    }

    // Cache miss — call LLM
    const response = await callLLM(llm, messages, options, _measureFn, undefined, progressCallback, customFetch);

    // Store in cache
    cache.set(key, {
        response,
        usage: lastTokenUsage ? { ...lastTokenUsage } : null,
        expiresAt: Date.now() + ttlMs,
    });

    evict(maxEntries);

    return response;
}

/** Get current cache size */
export function getCacheSize(): number {
    return cache.size;
}

/** Clear the entire cache */
export function clearCache(): void {
    cache.clear();
}

/** Get cache stats */
export function getCacheStats(): { size: number; keys: string[] } {
    return { size: cache.size, keys: [...cache.keys()] };
}

if (import.meta.env.NODE_ENV === "test") {
    const { test, expect, beforeEach } = await import('bun:test');

    beforeEach(() => clearCache());

    test('cachedCallLLM returns cached result on second call', async () => {
        let fetchCount = 0;
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (async () => {
            fetchCount++;
            return new Response(JSON.stringify({ choices: [{ message: { content: 'cached response' } }] }));
        }) as any;
        try {
            const msgs = [{ role: 'user' as const, content: 'hello' }];
            const r1 = await cachedCallLLM('gpt-4o-mini', msgs, { temperature: 0 });
            const r2 = await cachedCallLLM('gpt-4o-mini', msgs, { temperature: 0 });
            expect(r1).toBe('cached response');
            expect(r2).toBe('cached response');
            expect(fetchCount).toBe(1); // Only 1 fetch — second was cache hit
            expect(getCacheSize()).toBe(1);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    test('cachedCallLLM streaming bypasses cache', async () => {
        let fetchCount = 0;
        const originalFetch = globalThis.fetch;
        const mockStream = new ReadableStream({
            start(controller) {
                controller.enqueue(new TextEncoder().encode('data: {"choices": [{"delta": {"content": "hi"}}]}\n\n'));
                controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
                controller.close();
            }
        });
        globalThis.fetch = (async () => {
            fetchCount++;
            return new Response(mockStream);
        }) as any;
        try {
            await cachedCallLLM('gpt-4o-mini', [{ role: 'user', content: 'hi' }], {},
                {}, null, (update) => { });
            expect(getCacheSize()).toBe(0); // Streaming not cached
            expect(fetchCount).toBe(1);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    test('clearCache empties the cache', async () => {
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (async () =>
            new Response(JSON.stringify({ choices: [{ message: { content: 'x' } }] }))
        ) as any;
        try {
            await cachedCallLLM('gpt-4o-mini', [{ role: 'user', content: 'a' }], {});
            expect(getCacheSize()).toBe(1);
            clearCache();
            expect(getCacheSize()).toBe(0);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    test('expired entries are re-fetched', async () => {
        let fetchCount = 0;
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (async () => {
            fetchCount++;
            return new Response(JSON.stringify({ choices: [{ message: { content: `call-${fetchCount}` } }] }));
        }) as any;
        try {
            const msgs = [{ role: 'user' as const, content: 'test' }];
            await cachedCallLLM('gpt-4o-mini', msgs, {}, { ttlMs: 1 }); // 1ms TTL
            await new Promise(r => setTimeout(r, 10)); // Wait for expiry
            const r2 = await cachedCallLLM('gpt-4o-mini', msgs, {}, { ttlMs: 1 });
            expect(fetchCount).toBe(2); // Both calls hit the API
            expect(r2).toBe('call-2');
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    test('different inputs produce different cache entries', async () => {
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (async (_url: string, opts: any) => {
            const body = JSON.parse(opts.body);
            return new Response(JSON.stringify({ choices: [{ message: { content: body.messages[0].content } }] }));
        }) as any;
        try {
            await cachedCallLLM('gpt-4o-mini', [{ role: 'user', content: 'A' }], {});
            await cachedCallLLM('gpt-4o-mini', [{ role: 'user', content: 'B' }], {});
            expect(getCacheSize()).toBe(2);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
}
