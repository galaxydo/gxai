/**
 * errors.ts — Structured Error Types for GXAI
 *
 * Typed error classes for programmatic error handling.
 * Replace generic Error throws with specific types so callers
 * can catch and handle different failure modes differently.
 */

/** Base error class for all GXAI errors */
export class GxaiError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'GxaiError';
    }
}

/** Thrown when estimated cost exceeds maxCostUSD budget */
export class BudgetExceededError extends GxaiError {
    public estimatedCost: number;
    public maxCostUSD: number;
    public model: string;

    constructor(estimatedCost: number, maxCostUSD: number, model: string) {
        super(
            `Budget exceeded: estimated cost $${estimatedCost.toFixed(6)} exceeds maxCostUSD $${maxCostUSD.toFixed(6)} for model "${model}"`
        );
        this.name = 'BudgetExceededError';
        this.estimatedCost = estimatedCost;
        this.maxCostUSD = maxCostUSD;
        this.model = model;
    }
}

/** Thrown when input/output Zod validation fails */
export class ValidationError extends GxaiError {
    public zodErrors: any;

    constructor(message: string, zodErrors?: any) {
        super(message);
        this.name = 'ValidationError';
        this.zodErrors = zodErrors;
    }
}

/** Thrown when an LLM provider returns an error */
export class ProviderError extends GxaiError {
    public provider: string;
    public statusCode?: number;
    public retryable: boolean;

    constructor(message: string, provider: string, statusCode?: number) {
        super(message);
        this.name = 'ProviderError';
        this.provider = provider;
        this.statusCode = statusCode;
        // Rate limits (429) and server errors (5xx) are retryable
        this.retryable = statusCode === 429 || (statusCode !== undefined && statusCode >= 500);
    }
}

/** Thrown when a tool authorization is denied */
export class AuthorizationError extends GxaiError {
    public tool: string;
    public server: string;

    constructor(tool: string, server: string, reason?: string) {
        super(reason || `Tool ${server}.${tool} authorization denied`);
        this.name = 'AuthorizationError';
        this.tool = tool;
        this.server = server;
    }
}

/** Thrown when max iterations is reached in LoopAgent */
export class MaxIterationsError extends GxaiError {
    public iterations: number;

    constructor(iterations: number) {
        super(`Max iterations reached: ${iterations}`);
        this.name = 'MaxIterationsError';
        this.iterations = iterations;
    }
}

/** Thrown when agent.run() exceeds maxDurationMs */
export class TimeoutError extends GxaiError {
    public durationMs: number;
    public maxDurationMs: number;

    constructor(durationMs: number, maxDurationMs: number) {
        super(`Agent timeout: ${durationMs}ms exceeded maxDurationMs ${maxDurationMs}ms`);
        this.name = 'TimeoutError';
        this.durationMs = durationMs;
        this.maxDurationMs = maxDurationMs;
    }
}
