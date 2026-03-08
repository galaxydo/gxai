/**
 * rate-limiter.ts — Token Bucket Rate Limiter
 *
 * Controls LLM API call rate per agent with configurable
 * tokens-per-second, burst capacity, and queue-based waiting.
 *
 * Usage:
 *   const limiter = new RateLimiter({ tokensPerSecond: 10, burstCapacity: 20 });
 *   await limiter.acquire(); // waits if rate exceeded
 *   // ... make API call
 */

export interface RateLimiterConfig {
    /** Tokens refilled per second (default: 10) */
    tokensPerSecond?: number;
    /** Maximum burst capacity (default: tokensPerSecond * 2) */
    burstCapacity?: number;
    /** Max queue length before rejecting (default: 100) */
    maxQueueSize?: number;
}

export interface RateLimiterStats {
    availableTokens: number;
    burstCapacity: number;
    tokensPerSecond: number;
    totalAcquired: number;
    totalRejected: number;
    queueLength: number;
}

export class RateLimiter {
    private tokens: number;
    private lastRefill: number;
    private readonly tokensPerSecond: number;
    private readonly burstCapacity: number;
    private readonly maxQueueSize: number;
    private queue: Array<() => void> = [];
    private refillTimer: ReturnType<typeof setInterval> | null = null;
    private totalAcquired = 0;
    private totalRejected = 0;

    constructor(config: RateLimiterConfig = {}) {
        this.tokensPerSecond = config.tokensPerSecond ?? 10;
        this.burstCapacity = config.burstCapacity ?? this.tokensPerSecond * 2;
        this.maxQueueSize = config.maxQueueSize ?? 100;
        this.tokens = this.burstCapacity;
        this.lastRefill = Date.now();

        // Auto-refill timer
        this.refillTimer = setInterval(() => this.refill(), 100);
    }

    /** Acquire a token — waits if none available */
    async acquire(count = 1): Promise<void> {
        this.refill();

        if (this.tokens >= count) {
            this.tokens -= count;
            this.totalAcquired += count;
            return;
        }

        // Queue the request
        if (this.queue.length >= this.maxQueueSize) {
            this.totalRejected++;
            throw new Error(`Rate limiter queue full (${this.maxQueueSize}). Request rejected.`);
        }

        return new Promise<void>((resolve) => {
            this.queue.push(() => {
                this.tokens -= count;
                this.totalAcquired += count;
                resolve();
            });
        });
    }

    /** Try to acquire without waiting — returns false if unavailable */
    tryAcquire(count = 1): boolean {
        this.refill();
        if (this.tokens >= count) {
            this.tokens -= count;
            this.totalAcquired += count;
            return true;
        }
        return false;
    }

    /** Refill tokens based on elapsed time */
    private refill(): void {
        const now = Date.now();
        const elapsed = (now - this.lastRefill) / 1000;
        this.lastRefill = now;

        this.tokens = Math.min(
            this.burstCapacity,
            this.tokens + elapsed * this.tokensPerSecond,
        );

        // Process queued requests
        while (this.queue.length > 0 && this.tokens >= 1) {
            const next = this.queue.shift();
            next?.();
        }
    }

    /** Get current stats */
    get stats(): RateLimiterStats {
        this.refill();
        return {
            availableTokens: Math.floor(this.tokens),
            burstCapacity: this.burstCapacity,
            tokensPerSecond: this.tokensPerSecond,
            totalAcquired: this.totalAcquired,
            totalRejected: this.totalRejected,
            queueLength: this.queue.length,
        };
    }

    /** Reset to full capacity */
    reset(): void {
        this.tokens = this.burstCapacity;
        this.totalAcquired = 0;
        this.totalRejected = 0;
        // Drain queue
        while (this.queue.length > 0) {
            const next = this.queue.shift();
            next?.();
        }
    }

    /** Stop the auto-refill timer */
    destroy(): void {
        if (this.refillTimer) {
            clearInterval(this.refillTimer);
            this.refillTimer = null;
        }
    }
}
