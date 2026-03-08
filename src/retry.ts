/**
 * retry.ts — Pluggable Retry Strategies
 *
 * Configurable retry strategies for failed agent runs:
 * - Linear: fixed delay between retries
 * - Exponential: doubling delay with optional cap
 * - Jitter: random jitter added to any base strategy
 *
 * Usage:
 *   const strategy = exponentialBackoff({ maxRetries: 3, baseDelayMs: 1000 });
 *   const delay = strategy.getDelay(attempt); // 1000, 2000, 4000...
 */

export interface RetryStrategy {
    /** Get the delay in ms for a given attempt number (0-based) */
    getDelay(attempt: number): number;
    /** Max number of retries */
    maxRetries: number;
    /** Strategy name for logging */
    name: string;
    /** Whether a given error should be retried */
    shouldRetry?: (error: Error) => boolean;
}

export interface RetryConfig {
    /** Max retries (default: 3) */
    maxRetries?: number;
    /** Base delay in ms (default: 1000) */
    baseDelayMs?: number;
    /** Max delay cap in ms (default: 30000) */
    maxDelayMs?: number;
    /** Add random jitter (default: false) */
    jitter?: boolean;
    /** Jitter range as fraction of delay (0-1, default: 0.25) */
    jitterFraction?: number;
    /** Custom filter: return false to skip retry for specific errors */
    shouldRetry?: (error: Error) => boolean;
}

function addJitter(delay: number, fraction: number): number {
    const jitterRange = delay * fraction;
    return delay + (Math.random() * jitterRange * 2 - jitterRange);
}

/** Fixed delay between retries */
export function linearRetry(config: RetryConfig = {}): RetryStrategy {
    const {
        maxRetries = 3,
        baseDelayMs = 1000,
        jitter = false,
        jitterFraction = 0.25,
        shouldRetry,
    } = config;

    return {
        name: 'linear',
        maxRetries,
        shouldRetry,
        getDelay(attempt: number): number {
            const delay = baseDelayMs;
            return jitter ? Math.max(0, addJitter(delay, jitterFraction)) : delay;
        },
    };
}

/** Exponential backoff: delay doubles each attempt */
export function exponentialBackoff(config: RetryConfig = {}): RetryStrategy {
    const {
        maxRetries = 3,
        baseDelayMs = 1000,
        maxDelayMs = 30000,
        jitter = false,
        jitterFraction = 0.25,
        shouldRetry,
    } = config;

    return {
        name: 'exponential',
        maxRetries,
        shouldRetry,
        getDelay(attempt: number): number {
            const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
            return jitter ? Math.max(0, addJitter(delay, jitterFraction)) : delay;
        },
    };
}

/** Full jitter: random delay between 0 and exponential cap */
export function fullJitter(config: RetryConfig = {}): RetryStrategy {
    const {
        maxRetries = 3,
        baseDelayMs = 1000,
        maxDelayMs = 30000,
        shouldRetry,
    } = config;

    return {
        name: 'full-jitter',
        maxRetries,
        shouldRetry,
        getDelay(attempt: number): number {
            const cap = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
            return Math.random() * cap;
        },
    };
}

/** No retry — fail immediately */
export function noRetry(): RetryStrategy {
    return {
        name: 'none',
        maxRetries: 0,
        getDelay(): number { return 0; },
    };
}

/**
 * Execute a function with the given retry strategy.
 * Returns the result or throws the last error after all retries exhausted.
 */
export async function withRetry<T>(
    fn: () => Promise<T>,
    strategy: RetryStrategy,
    onRetry?: (attempt: number, error: Error, delayMs: number) => void,
): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= strategy.maxRetries; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));

            // Check if we should retry this error
            if (strategy.shouldRetry && !strategy.shouldRetry(lastError)) {
                throw lastError;
            }

            // No more retries
            if (attempt >= strategy.maxRetries) break;

            const delay = strategy.getDelay(attempt);
            onRetry?.(attempt, lastError, delay);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    throw lastError!;
}
