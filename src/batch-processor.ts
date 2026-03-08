/**
 * batch-processor.ts — Parallel Batch Processor
 *
 * Process multiple inputs in parallel batches with concurrency limits.
 *
 * Usage:
 *   const results = await batchProcess(items, processItem, { concurrency: 5 });
 */

export interface BatchConfig {
    /** Max concurrent operations (default: 5) */
    concurrency?: number;
    /** Continue processing on individual item failure (default: true) */
    continueOnError?: boolean;
    /** Callback for progress updates */
    onProgress?: (completed: number, total: number, item: any) => void;
    /** Callback for individual errors */
    onError?: (error: Error, item: any, index: number) => void;
}

export interface BatchResult<T> {
    /** Successful results */
    results: Array<{ index: number; value: T }>;
    /** Errors from failed items */
    errors: Array<{ index: number; error: Error; item: any }>;
    /** Total processing time */
    durationMs: number;
    /** Stats */
    stats: {
        total: number;
        succeeded: number;
        failed: number;
        concurrency: number;
    };
}

/**
 * Process items in parallel batches with concurrency control.
 */
export async function batchProcess<TIn, TOut>(
    items: TIn[],
    processor: (item: TIn, index: number) => Promise<TOut>,
    config: BatchConfig = {},
): Promise<BatchResult<TOut>> {
    const concurrency = config.concurrency ?? 5;
    const continueOnError = config.continueOnError ?? true;
    const startTime = Date.now();

    const results: BatchResult<TOut>['results'] = [];
    const errors: BatchResult<TOut>['errors'] = [];
    let completed = 0;

    // Semaphore-based concurrency control
    const queue = items.map((item, index) => ({ item, index }));
    const activePromises: Promise<void>[] = [];

    async function processNext(): Promise<void> {
        while (queue.length > 0) {
            const entry = queue.shift()!;
            try {
                const value = await processor(entry.item, entry.index);
                results.push({ index: entry.index, value });
            } catch (err) {
                const error = err instanceof Error ? err : new Error(String(err));
                errors.push({ index: entry.index, error, item: entry.item });
                config.onError?.(error, entry.item, entry.index);

                if (!continueOnError) {
                    // Drain remaining queue
                    queue.length = 0;
                    return;
                }
            }

            completed++;
            config.onProgress?.(completed, items.length, entry.item);
        }
    }

    // Start concurrent workers
    for (let i = 0; i < Math.min(concurrency, items.length); i++) {
        activePromises.push(processNext());
    }

    await Promise.all(activePromises);

    // Sort results by index
    results.sort((a, b) => a.index - b.index);
    errors.sort((a, b) => a.index - b.index);

    return {
        results,
        errors,
        durationMs: Date.now() - startTime,
        stats: {
            total: items.length,
            succeeded: results.length,
            failed: errors.length,
            concurrency,
        },
    };
}

/**
 * Chunk an array into batches of a given size.
 */
export function chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
    }
    return chunks;
}

/**
 * Process items sequentially (no concurrency).
 */
export async function sequentialProcess<TIn, TOut>(
    items: TIn[],
    processor: (item: TIn, index: number) => Promise<TOut>,
): Promise<BatchResult<TOut>> {
    return batchProcess(items, processor, { concurrency: 1 });
}
