/**
 * pipeline.ts — Simple Agent Pipeline (Sequential Chaining)
 *
 * Chain agents sequentially: output of one feeds input of the next.
 * Supports branching, parallel fan-out, and error handling.
 *
 * NOTE: For advanced pipelines with before/after hooks and per-step error
 * strategies (skip/abort/fallback), see pipeline-composer.ts (PipelineComposer).
 *
 * Usage:
 *   const pipeline = createPipeline('summarize-then-classify')
 *     .pipe(summaryAgent)
 *     .pipe(classifyAgent);
 *   const result = await pipeline.run(input);
 */

import type { ProgressCallback } from './types';

export interface PipelineStep<I = any, O = any> {
    /** Step name for logging */
    name: string;
    /** Execute this step */
    run: (input: I, progressCallback?: ProgressCallback) => Promise<O>;
}

export interface PipelineResult<T = any> {
    /** Final output */
    output: T;
    /** Intermediate results from each step */
    steps: Array<{ name: string; output: any; durationMs: number }>;
    /** Total pipeline duration */
    totalDurationMs: number;
}

export class Pipeline<TInput = any, TOutput = any> {
    private steps: PipelineStep[] = [];
    private _name: string;
    private _onStepComplete?: (stepName: string, output: any, durationMs: number) => void;

    constructor(name: string) {
        this._name = name;
    }

    /** Add a step to the pipeline */
    pipe<TNext>(step: PipelineStep<TOutput, TNext>): Pipeline<TInput, TNext> {
        this.steps.push(step);
        return this as unknown as Pipeline<TInput, TNext>;
    }

    /** Add a transform function as a step */
    transform<TNext>(name: string, fn: (input: TOutput) => Promise<TNext> | TNext): Pipeline<TInput, TNext> {
        this.steps.push({
            name,
            run: async (input) => fn(input),
        });
        return this as unknown as Pipeline<TInput, TNext>;
    }

    /** Register a callback for step completion */
    onStepComplete(cb: (stepName: string, output: any, durationMs: number) => void): this {
        this._onStepComplete = cb;
        return this;
    }

    /** Execute the pipeline */
    async run(input: TInput, progressCallback?: ProgressCallback): Promise<PipelineResult<TOutput>> {
        const stepResults: PipelineResult['steps'] = [];
        const pipelineStart = Date.now();
        let current: any = input;

        for (const step of this.steps) {
            const stepStart = Date.now();
            try {
                current = await step.run(current, progressCallback);
            } catch (err) {
                throw new PipelineError(
                    `Pipeline "${this._name}" failed at step "${step.name}": ${err instanceof Error ? err.message : String(err)}`,
                    step.name,
                    stepResults,
                );
            }
            const durationMs = Date.now() - stepStart;
            stepResults.push({ name: step.name, output: current, durationMs });
            this._onStepComplete?.(step.name, current, durationMs);
        }

        return {
            output: current as TOutput,
            steps: stepResults,
            totalDurationMs: Date.now() - pipelineStart,
        };
    }

    /** Get pipeline info */
    get name(): string { return this._name; }
    get stepCount(): number { return this.steps.length; }
    get stepNames(): string[] { return this.steps.map(s => s.name); }
}

/** Error thrown when a pipeline step fails */
export class PipelineError extends Error {
    constructor(
        message: string,
        public readonly failedStep: string,
        public readonly completedSteps: PipelineResult['steps'],
    ) {
        super(message);
        this.name = 'PipelineError';
    }
}

/** Create a new pipeline builder */
export function createPipeline<TInput = any>(name: string): Pipeline<TInput, TInput> {
    return new Pipeline<TInput, TInput>(name);
}

/**
 * Run multiple pipelines in parallel (fan-out).
 * Returns results from all pipelines.
 */
export async function fanOut<TInput, TOutputs extends any[]>(
    input: TInput,
    ...pipelines: { [K in keyof TOutputs]: Pipeline<TInput, TOutputs[K]> }
): Promise<{ [K in keyof TOutputs]: PipelineResult<TOutputs[K]> }> {
    const results = await Promise.all(
        pipelines.map(p => p.run(input))
    );
    return results as any;
}
