/**
 * pipeline-composer.ts — Advanced Pipeline Builder with Hooks & Error Strategies
 *
 * Build typed, composable pipelines with before/after hooks,
 * per-step error handling (skip/abort/fallback), and metadata context.
 *
 * NOTE: For simpler sequential chaining without hooks, see pipeline.ts (Pipeline).
 *
 * Usage:
 *   const pipeline = compose('my-pipeline')
 *     .pipe('validate', validateFn)
 *     .pipe('process', processFn, { onError: 'skip' })
 *     .pipe('format', formatFn);
 *   const result = await pipeline.execute(input);
 */

export type PipeStep<TIn = any, TOut = any> = (input: TIn, ctx: PipeContext) => TOut | Promise<TOut>;

export interface PipeContext {
    pipelineName: string;
    stepName: string;
    stepIndex: number;
    metadata: Record<string, any>;
}

export interface PipeResult<T = any> {
    value: T;
    steps: Array<{ name: string; durationMs: number; success: boolean; error?: string }>;
    totalDurationMs: number;
    success: boolean;
}

interface StepEntry {
    name: string;
    fn: PipeStep;
    onError?: 'skip' | 'abort' | 'fallback';
    fallback?: PipeStep;
}

export class PipelineComposer<T = any> {
    private steps: StepEntry[] = [];
    private name: string;
    private beforeHooks: Array<(input: any) => any> = [];
    private afterHooks: Array<(result: PipeResult) => void> = [];

    constructor(name = 'pipeline') {
        this.name = name;
    }

    /** Add a step to the pipeline */
    pipe<TOut>(name: string, fn: PipeStep<T, TOut>, opts?: { onError?: 'skip' | 'abort'; fallback?: PipeStep }): PipelineComposer<TOut> {
        this.steps.push({ name, fn, onError: opts?.onError ?? 'abort', fallback: opts?.fallback });
        return this as any;
    }

    /** Add a before hook */
    before(hook: (input: any) => any): this {
        this.beforeHooks.push(hook);
        return this;
    }

    /** Add an after hook */
    after(hook: (result: PipeResult) => void): this {
        this.afterHooks.push(hook);
        return this;
    }

    /** Execute the pipeline */
    async execute(input: T): Promise<PipeResult> {
        const startTime = Date.now();
        const stepResults: PipeResult['steps'] = [];
        let current: any = input;

        // Before hooks
        for (const hook of this.beforeHooks) current = hook(current) ?? current;

        for (let i = 0; i < this.steps.length; i++) {
            const step = this.steps[i]!;
            const stepStart = Date.now();
            const ctx: PipeContext = {
                pipelineName: this.name,
                stepName: step.name,
                stepIndex: i,
                metadata: {},
            };

            try {
                current = await step.fn(current, ctx);
                stepResults.push({ name: step.name, durationMs: Date.now() - stepStart, success: true });
            } catch (err) {
                const errMsg = err instanceof Error ? err.message : String(err);
                stepResults.push({ name: step.name, durationMs: Date.now() - stepStart, success: false, error: errMsg });

                if (step.fallback) {
                    current = await step.fallback(current, ctx);
                } else if (step.onError === 'skip') {
                    continue;
                } else {
                    const result: PipeResult = {
                        value: current,
                        steps: stepResults,
                        totalDurationMs: Date.now() - startTime,
                        success: false,
                    };
                    for (const hook of this.afterHooks) hook(result);
                    return result;
                }
            }
        }

        const result: PipeResult = {
            value: current,
            steps: stepResults,
            totalDurationMs: Date.now() - startTime,
            success: true,
        };
        for (const hook of this.afterHooks) hook(result);
        return result;
    }

    /** Get step names */
    get stepNames(): string[] {
        return this.steps.map(s => s.name);
    }

    /** Get step count */
    get stepCount(): number {
        return this.steps.length;
    }
}

/** Create a new pipeline */
export function compose<T = any>(name?: string): PipelineComposer<T> {
    return new PipelineComposer<T>(name);
}
