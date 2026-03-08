/**
 * metrics.ts — Agent Performance Metrics Collector
 *
 * Collect and aggregate latency, token usage, costs, and custom metrics.
 *
 * Usage:
 *   const metrics = new MetricsCollector();
 *   metrics.record('latency', 250);
 *   metrics.record('tokens', 1500);
 *   metrics.getStats('latency'); // { min, max, avg, p50, p95, count }
 */

export interface MetricStats {
    count: number;
    sum: number;
    min: number;
    max: number;
    avg: number;
    p50: number;
    p95: number;
    p99: number;
    last: number;
}

export interface MetricEntry {
    name: string;
    value: number;
    timestamp: number;
    labels?: Record<string, string>;
}

export class MetricsCollector {
    private data = new Map<string, number[]>();
    private counters = new Map<string, number>();
    private maxSamples: number;

    constructor(maxSamples = 10000) {
        this.maxSamples = maxSamples;
    }

    /** Record a metric value */
    record(name: string, value: number): void {
        if (!this.data.has(name)) this.data.set(name, []);
        const arr = this.data.get(name)!;
        arr.push(value);
        if (arr.length > this.maxSamples) arr.shift();
    }

    /** Increment a counter */
    increment(name: string, by = 1): number {
        const current = this.counters.get(name) ?? 0;
        const next = current + by;
        this.counters.set(name, next);
        return next;
    }

    /** Get counter value */
    getCounter(name: string): number {
        return this.counters.get(name) ?? 0;
    }

    /** Get stats for a metric */
    getStats(name: string): MetricStats | null {
        const values = this.data.get(name);
        if (!values || values.length === 0) return null;

        const sorted = [...values].sort((a, b) => a - b);
        const sum = values.reduce((a, b) => a + b, 0);
        const count = values.length;

        return {
            count,
            sum,
            min: sorted[0]!,
            max: sorted[count - 1]!,
            avg: sum / count,
            p50: percentile(sorted, 50),
            p95: percentile(sorted, 95),
            p99: percentile(sorted, 99),
            last: values[count - 1]!,
        };
    }

    /** Get all metric names */
    get metricNames(): string[] {
        return [...this.data.keys()];
    }

    /** Get all counter names */
    get counterNames(): string[] {
        return [...this.counters.keys()];
    }

    /** Get a summary of all metrics */
    summary(): Record<string, MetricStats> {
        const result: Record<string, MetricStats> = {};
        for (const name of this.data.keys()) {
            const stats = this.getStats(name);
            if (stats) result[name] = stats;
        }
        return result;
    }

    /** Time an async operation */
    async time<T>(name: string, fn: () => Promise<T>): Promise<T> {
        const start = Date.now();
        try {
            const result = await fn();
            this.record(name, Date.now() - start);
            return result;
        } catch (err) {
            this.record(name, Date.now() - start);
            this.increment(`${name}.errors`);
            throw err;
        }
    }

    /** Reset a specific metric */
    reset(name: string): void {
        this.data.delete(name);
    }

    /** Clear all metrics and counters */
    clear(): void {
        this.data.clear();
        this.counters.clear();
    }

    /** Export all data */
    export(): { metrics: Record<string, number[]>; counters: Record<string, number> } {
        const metrics: Record<string, number[]> = {};
        for (const [k, v] of this.data) metrics[k] = [...v];
        const counters: Record<string, number> = {};
        for (const [k, v] of this.counters) counters[k] = v;
        return { metrics, counters };
    }
}

function percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)]!;
}
