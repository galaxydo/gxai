/**
 * cost-tracker.ts — Agent Cost Aggregation
 *
 * Tracks cumulative cost and usage across all agent runs.
 * Provides aggregation APIs for dashboard visualization.
 */

import type { TokenUsage } from './types';
import type { CostEstimate } from './pricing';

export interface CostRecord {
    timestamp: number;
    agentName: string;
    llm: string;
    requestId: string;
    durationMs: number;
    usage: TokenUsage;
    cost: CostEstimate;
    status: 'success' | 'error';
}

export interface CostSummary {
    /** Total cost across all recorded runs */
    totalCostUSD: number;
    /** Total number of runs */
    totalRuns: number;
    /** Total tokens consumed */
    totalTokens: number;
    /** Average cost per run */
    avgCostPerRun: number;
    /** Average duration per run in ms */
    avgDurationMs: number;
    /** Cost breakdown by model */
    byModel: Record<string, { runs: number; costUSD: number; tokens: number }>;
    /** Cost breakdown by agent */
    byAgent: Record<string, { runs: number; costUSD: number; tokens: number }>;
    /** Success vs error count */
    successCount: number;
    errorCount: number;
    /** Time range */
    earliestRun: number;
    latestRun: number;
}

export class CostTracker {
    private records: CostRecord[] = [];
    private maxRecords: number;

    constructor(maxRecords = 10_000) {
        this.maxRecords = maxRecords;
    }

    /** Record a completed run */
    record(entry: CostRecord): void {
        this.records.push(entry);
        // Evict oldest if exceeding limit
        if (this.records.length > this.maxRecords) {
            this.records = this.records.slice(-this.maxRecords);
        }
    }

    /** Get aggregated cost summary */
    getSummary(sinceMs?: number): CostSummary {
        const filtered = sinceMs
            ? this.records.filter(r => r.timestamp >= sinceMs)
            : this.records;

        if (filtered.length === 0) {
            return {
                totalCostUSD: 0, totalRuns: 0, totalTokens: 0,
                avgCostPerRun: 0, avgDurationMs: 0,
                byModel: {}, byAgent: {},
                successCount: 0, errorCount: 0,
                earliestRun: 0, latestRun: 0,
            };
        }

        let totalCost = 0;
        let totalTokens = 0;
        let totalDuration = 0;
        let successCount = 0;
        let errorCount = 0;
        const byModel: CostSummary['byModel'] = {};
        const byAgent: CostSummary['byAgent'] = {};

        for (const r of filtered) {
            totalCost += r.cost.totalCost;
            totalTokens += r.usage.totalTokens;
            totalDuration += r.durationMs;
            if (r.status === 'success') successCount++;
            else errorCount++;

            // Model aggregation
            if (!byModel[r.llm]) byModel[r.llm] = { runs: 0, costUSD: 0, tokens: 0 };
            byModel[r.llm]!.runs++;
            byModel[r.llm]!.costUSD += r.cost.totalCost;
            byModel[r.llm]!.tokens += r.usage.totalTokens;

            // Agent aggregation
            if (!byAgent[r.agentName]) byAgent[r.agentName] = { runs: 0, costUSD: 0, tokens: 0 };
            byAgent[r.agentName]!.runs++;
            byAgent[r.agentName]!.costUSD += r.cost.totalCost;
            byAgent[r.agentName]!.tokens += r.usage.totalTokens;
        }

        return {
            totalCostUSD: Math.round(totalCost * 1_000_000) / 1_000_000,
            totalRuns: filtered.length,
            totalTokens,
            avgCostPerRun: Math.round((totalCost / filtered.length) * 1_000_000) / 1_000_000,
            avgDurationMs: Math.round(totalDuration / filtered.length),
            byModel, byAgent,
            successCount, errorCount,
            earliestRun: filtered[0]!.timestamp,
            latestRun: filtered[filtered.length - 1]!.timestamp,
        };
    }

    /** Get recent records (most recent first) */
    getRecent(limit = 50): CostRecord[] {
        return this.records.slice(-limit).reverse();
    }

    /** Get total record count */
    get size(): number {
        return this.records.length;
    }

    /** Clear all records */
    clear(): void {
        this.records = [];
    }

    /** Export all records */
    toJSON(): CostRecord[] {
        return [...this.records];
    }

    /** Import records */
    fromJSON(records: CostRecord[]): void {
        this.records = [...records];
    }
}

/** Global singleton cost tracker */
export const costTracker = new CostTracker();
