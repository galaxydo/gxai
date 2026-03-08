/**
 * pricing.ts — LLM provider pricing per million tokens (USD)
 *
 * Prices as of March 2026. Updated periodically.
 * Used by Agent.estimateCost() and Agent.lastCost.
 */

import type { TokenUsage } from './types';

export interface ModelPricing {
    inputPerMillion: number;
    outputPerMillion: number;
}

export interface CostEstimate {
    inputCost: number;
    outputCost: number;
    totalCost: number;
    currency: 'USD';
}

/**
 * Pricing table: model name pattern → cost per million tokens
 * Matched by substring — first match wins, so more specific patterns first.
 */
const PRICING_TABLE: Array<{ match: string; pricing: ModelPricing }> = [
    // OpenAI
    { match: 'gpt-4o-mini', pricing: { inputPerMillion: 0.15, outputPerMillion: 0.60 } },
    { match: 'o4-mini', pricing: { inputPerMillion: 1.10, outputPerMillion: 4.40 } },
    { match: 'gpt-4o', pricing: { inputPerMillion: 2.50, outputPerMillion: 10.00 } },
    { match: 'gpt-4', pricing: { inputPerMillion: 30.00, outputPerMillion: 60.00 } },

    // Anthropic
    { match: 'claude-3-5-sonnet', pricing: { inputPerMillion: 3.00, outputPerMillion: 15.00 } },
    { match: 'claude-3-sonnet', pricing: { inputPerMillion: 3.00, outputPerMillion: 15.00 } },
    { match: 'claude', pricing: { inputPerMillion: 3.00, outputPerMillion: 15.00 } },

    // DeepSeek
    { match: 'deepseek', pricing: { inputPerMillion: 0.14, outputPerMillion: 0.28 } },

    // Gemini
    { match: 'gemini-2.5-pro', pricing: { inputPerMillion: 1.25, outputPerMillion: 10.00 } },
    { match: 'gemini-2.0-flash', pricing: { inputPerMillion: 0.10, outputPerMillion: 0.40 } },
    { match: 'gemini', pricing: { inputPerMillion: 0.10, outputPerMillion: 0.40 } },
];

/** Default fallback pricing if model not found */
const DEFAULT_PRICING: ModelPricing = { inputPerMillion: 1.00, outputPerMillion: 3.00 };

/** Look up pricing for a model name */
export function getModelPricing(llm: string): ModelPricing {
    for (const entry of PRICING_TABLE) {
        if (llm.includes(entry.match)) return entry.pricing;
    }
    return DEFAULT_PRICING;
}

/** Calculate cost from token usage and model name */
export function calculateCost(llm: string, usage: TokenUsage): CostEstimate {
    const pricing = getModelPricing(llm);
    const inputCost = (usage.inputTokens / 1_000_000) * pricing.inputPerMillion;
    const outputCost = (usage.outputTokens / 1_000_000) * pricing.outputPerMillion;
    return {
        inputCost: Math.round(inputCost * 1_000_000) / 1_000_000,   // 6 decimal places
        outputCost: Math.round(outputCost * 1_000_000) / 1_000_000,
        totalCost: Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000,
        currency: 'USD',
    };
}

/**
 * Estimate cost for a given input text length (rough approximation).
 * Uses ~4 chars per token heuristic for English text.
 */
export function estimateInputCost(llm: string, inputChars: number, estimatedOutputTokens = 1000): CostEstimate {
    const estimatedInputTokens = Math.ceil(inputChars / 4);
    return calculateCost(llm, {
        inputTokens: estimatedInputTokens,
        outputTokens: estimatedOutputTokens,
        totalTokens: estimatedInputTokens + estimatedOutputTokens,
    });
}
