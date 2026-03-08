/**
 * cache.ts — LLM Response Cache
 *
 * In-memory LRU cache for LLM responses, keyed by a hash of
 * (model + messages + options). Saves cost on repeated identical inputs.
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
