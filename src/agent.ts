// src/agent.ts
import { z } from "zod";
import { measure } from "measure-fn";
import type { AgentConfig, MCPTool, MCPServer, ProgressCallback, ProgressUpdate, StreamingCallback, StreamingUpdate, TokenUsage } from './types';
import { objToXml, xmlToObj } from './xml';
import { callLLM, lastTokenUsage } from './inference';
import { cachedCallLLM } from './cache';
import { discoverTools, invokeTool } from './mcp';
import { fetchWithPayment } from './payments';
import { generateRequestId } from './utils';
import { validateUrl } from './validation';
import { calculateCost, estimateInputCost } from './pricing';
import type { CostEstimate } from './pricing';
import type { ConversationMemory } from './memory';
import { auditLog } from './audit';
import { BudgetExceededError, ValidationError, TimeoutError } from './errors';
import { ContextTracker } from './context';
import type { ContextUsage } from './context';
import { PluginRegistry } from './plugin';
import type { AgentPlugin } from './plugin';

/** Context passed to agent middleware at each phase */
export interface MiddlewareContext {
  phase: 'before' | 'after' | 'error';
  agentName: string;
  llm: string;
  input: any;
  output?: any;
  error?: string;
  usage?: TokenUsage;
  cost?: CostEstimate;
  durationMs?: number;
}

/** Middleware function — receives execution context at each phase */
export type AgentMiddleware = (ctx: MiddlewareContext) => void | Promise<void>;

/** Typed telemetry event emitted during agent.run() */
export type RunEvent =
  | { type: 'run_start'; agentName: string; llm: string; requestId: string; timestamp: number }
  | { type: 'llm_call'; agentName: string; llm: string; purpose: string; timestamp: number }
  | { type: 'llm_complete'; agentName: string; llm: string; purpose: string; durationMs: number; usage?: TokenUsage; timestamp: number }
  | { type: 'tool_start'; agentName: string; server: string; tool: string; timestamp: number }
  | { type: 'tool_complete'; agentName: string; server: string; tool: string; durationMs: number; success: boolean; timestamp: number }
  | { type: 'run_complete'; agentName: string; llm: string; requestId: string; durationMs: number; usage?: TokenUsage; cost?: CostEstimate; timestamp: number }
  | { type: 'run_error'; agentName: string; llm: string; requestId: string; error: string; durationMs: number; timestamp: number };

/** Callback for receiving run telemetry events */
export type RunEventCallback = (event: RunEvent) => void;

/** Chunk yielded by runStream() — either a progress update or the final result */
export type StreamChunk<T = any> =
  | { done: false; stage: string; message: string; data?: any }
  | { done: true; output?: T; error?: string };

export class Agent<I extends z.ZodObject<any>, O extends z.ZodObject<any>> {
  private config: AgentConfig<I, O>;
  private middlewares: AgentMiddleware[] = [];
  private runEventCallback: RunEventCallback | null = null;
  private contextTracker: ContextTracker;
  private _plugins: Map<string, AgentPlugin> = new Map();
  /** Token usage from the most recent run() call */
  public lastUsage: TokenUsage | null = null;
  /** Cost from the most recent run() call (calculated from actual token usage) */
  public lastCost: CostEstimate | null = null;

  constructor(config: AgentConfig<I, O>) {
    this.config = config;
    this.contextTracker = new ContextTracker(config.llm);
    this.validateNoArrays(this.config.outputFormat);
  }

  /** Get current context window utilization across all runs */
  get contextUsage(): ContextUsage {
    return this.contextTracker.getUsage();
  }

  /** Reset context window tracking (call after memory pruning) */
  resetContext(): void {
    this.contextTracker.reset();
  }

  /**
   * Create a copy of this agent with optional config overrides.
   * Middleware is preserved. Useful for creating model/temperature variants.
   */
  clone(overrides?: Partial<AgentConfig<I, O>>): Agent<I, O> {
    const cloned = new Agent<I, O>({ ...this.config, ...overrides });
    cloned.middlewares = [...this.middlewares];
    cloned.runEventCallback = this.runEventCallback;
    return cloned;
  }

  /**
   * Register a middleware hook. Called at 3 phases:
   * - `before`: Pre-execution (throw to abort)
   * - `after`: Post-success (with output, usage, cost)
   * - `error`: On failure (with error details)
   */
  use(middleware: AgentMiddleware): this {
    this.middlewares.push(middleware);
    return this;
  }

  /** Register a telemetry event callback for observability during run() */
  onEvent(callback: RunEventCallback): this {
    this.runEventCallback = callback;
    return this;
  }

  /** Register a named plugin (bundles middleware, servers, config) */
  async register(plugin: AgentPlugin): Promise<this> {
    if (plugin.setup) await plugin.setup();
    if (plugin.middleware) {
      const mws = Array.isArray(plugin.middleware) ? plugin.middleware : [plugin.middleware];
      for (const mw of mws) this.middlewares.push(mw);
    }
    this._plugins.set(plugin.name, plugin);
    return this;
  }

  /** Unregister a plugin by name */
  async unregister(name: string): Promise<boolean> {
    const plugin = this._plugins.get(name);
    if (!plugin) return false;
    if (plugin.teardown) await plugin.teardown();
    this._plugins.delete(name);
    return true;
  }

  /** List registered plugin names */
  get plugins(): string[] {
    return [...this._plugins.keys()];
  }

  /** Emit a run event if a callback is registered */
  private emitEvent(event: RunEvent): void {
    try { this.runEventCallback?.(event); } catch { /* non-fatal */ }
  }

  /** Route LLM calls through cache when cacheConfig is set */
  private async callLLMCached(
    messages: Array<{ role: string; content: string }>,
    options: any,
    progressCallback?: ProgressCallback,
  ): Promise<string> {
    if (this.config.cacheConfig) {
      return cachedCallLLM(this.config.llm, messages, options, this.config.cacheConfig, undefined, undefined, progressCallback);
    }
    return callLLM(this.config.llm, messages, options, undefined, undefined, progressCallback);
  }

  /** Run all registered middleware for a given phase */
  private async runMiddleware(ctx: MiddlewareContext): Promise<void> {
    for (const fn of this.middlewares) {
      await fn(ctx);
    }
  }

  /**
   * Estimate cost before running. Uses character-count heuristic (~4 chars/token).
   * @param input - The input object to estimate cost for
   * @param estimatedOutputTokens - Expected output tokens (default 1000)
   * @returns CostEstimate with projected USD cost
   */
  estimateCost(input: z.infer<I>, estimatedOutputTokens = 1000): CostEstimate {
    const validatedInput = this.config.inputFormat.parse(input);
    const xml = objToXml({ input: validatedInput });
    // Account for system prompt length too
    const systemChars = (this.config.systemPrompt || '').length;
    return estimateInputCost(this.config.llm, xml.length + systemChars, estimatedOutputTokens);
  }

  /**
   * Run multiple inputs in parallel with concurrency control.
   * @param inputs - Array of inputs to process
   * @param options - `concurrency` (default 5), `progressCallback` passed to each run
   * @returns Object with `results` (successful outputs) and `errors` (failed inputs with error messages)
   */
  async runBatch(
    inputs: z.infer<I>[],
    options: {
      concurrency?: number;
      progressCallback?: ProgressCallback;
      /** Delay in ms between each batch chunk (for rate limiting) */
      delayBetweenBatchesMs?: number;
      /** Callback fired after each batch chunk completes */
      onBatchProgress?: (completed: number, total: number, errors: number) => void;
    } = {}
  ): Promise<{ results: z.infer<O>[]; errors: Array<{ input: z.infer<I>; error: string }> }> {
    const { concurrency = 5, progressCallback, delayBetweenBatchesMs = 0, onBatchProgress } = options;
    const results: z.infer<O>[] = [];
    const errors: Array<{ input: z.infer<I>; error: string }> = [];

    // Process in chunks of `concurrency`
    for (let i = 0; i < inputs.length; i += concurrency) {
      const chunk = inputs.slice(i, i + concurrency);
      const settled = await Promise.allSettled(
        chunk.map(input => this.run(input, progressCallback))
      );
      for (let j = 0; j < settled.length; j++) {
        const s = settled[j]!;
        if (s.status === 'fulfilled') {
          results.push(s.value);
        } else {
          errors.push({ input: chunk[j]!, error: s.reason?.message || String(s.reason) });
        }
      }

      // Progress callback
      onBatchProgress?.(results.length + errors.length, inputs.length, errors.length);

      // Rate limiting delay between chunks
      if (delayBetweenBatchesMs > 0 && i + concurrency < inputs.length) {
        await new Promise(resolve => setTimeout(resolve, delayBetweenBatchesMs));
      }
    }

    return { results, errors };
  }

  /**
   * Run with automatic retry and exponential backoff on failure.
   * @param input - The input to process
   * @param options - `maxRetries` (default 3), `retryDelayMs` (default 1000), `maxDelayMs` (default 30000)
   * @returns The output on success, throws after all retries exhausted
   */
  async runWithRetry(
    input: z.infer<I>,
    options: { maxRetries?: number; retryDelayMs?: number; maxDelayMs?: number; progressCallback?: ProgressCallback } = {}
  ): Promise<z.infer<O>> {
    const { maxRetries = 3, retryDelayMs = 1000, maxDelayMs = 30_000, progressCallback } = options;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.run(input, progressCallback);
      } catch (err: any) {
        lastError = err;
        // Don't retry on budget exceeded, validation, or timeout errors
        if (err instanceof BudgetExceededError || err instanceof ValidationError || err instanceof TimeoutError) {
          throw err;
        }
        const msg = err?.message?.toLowerCase() || '';
        if (msg.includes('parse')) {
          throw err;
        }
        if (attempt < maxRetries) {
          const delay = Math.min(retryDelayMs * Math.pow(2, attempt), maxDelayMs);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError || new Error('All retries exhausted');
  }

  async run(input: z.infer<I>, progressCallback?: ProgressCallback): Promise<z.infer<O>> {
    // If timeout configured, race the actual run against a timer
    if (this.config.maxDurationMs) {
      const maxMs = this.config.maxDurationMs;
      return Promise.race([
        this._runInternal(input, progressCallback),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new TimeoutError(maxMs, maxMs)), maxMs)
        ),
      ]);
    }
    return this._runInternal(input, progressCallback);
  }

  /**
   * Stream execution as an async iterator.
   * Yields `StreamChunk` objects with progress updates,
   * then a final chunk with `done: true` containing the output.
   */
  async *runStream(input: z.infer<I>): AsyncGenerator<StreamChunk<z.infer<O>>> {
    const chunks: StreamChunk<z.infer<O>>[] = [];
    let resolve: (() => void) | null = null;
    let hasMore = true;

    const progressCallback: ProgressCallback = (update) => {
      chunks.push({ done: false, stage: update.stage, message: update.message, data: update.data });
      resolve?.();
    };

    // Run in the background
    const runPromise = this.run(input, progressCallback).then(
      (result) => {
        chunks.push({ done: true, output: result });
        hasMore = false;
        resolve?.();
      },
      (error) => {
        chunks.push({ done: true, error: error instanceof Error ? error.message : String(error) });
        hasMore = false;
        resolve?.();
      }
    );

    while (hasMore || chunks.length > 0) {
      if (chunks.length > 0) {
        yield chunks.shift()!;
      } else {
        await new Promise<void>((r) => { resolve = r; });
      }
    }
  }

  private async _runInternal(input: z.infer<I>, progressCallback?: ProgressCallback): Promise<z.infer<O>> {
    const requestId = generateRequestId();
    const startTime = Date.now();
    const toolInvocations: Array<{ server: string; tool: string; parameters: any; result: any }> = [];
    const usage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

    /** Helper to accumulate token usage after each callLLM */
    const accumulateUsage = () => {
      if (lastTokenUsage) {
        usage.inputTokens += lastTokenUsage.inputTokens;
        usage.outputTokens += lastTokenUsage.outputTokens;
        usage.totalTokens += lastTokenUsage.totalTokens;
      }
    };

    // Budget guard: reject if estimated cost exceeds maxCostUSD
    if (this.config.maxCostUSD !== undefined) {
      const est = this.estimateCost(input, this.config.maxTokens || 4000);
      if (est.totalCost > this.config.maxCostUSD) {
        throw new BudgetExceededError(est.totalCost, this.config.maxCostUSD, this.config.llm);
      }
    }

    const agentName = this.config.name || 'unnamed-agent';

    try {
      // Run 'before' middleware (can throw to abort)
      await this.runMiddleware({ phase: 'before', agentName, llm: this.config.llm, input });

      this.emitEvent({ type: 'run_start', agentName, llm: this.config.llm, requestId, timestamp: Date.now() });

      const validatedInput = this.config.inputFormat.parse(input);

      // Record input in conversation memory
      const memory = this.config.memory as ConversationMemory | undefined;
      if (memory) {
        memory.addUser(objToXml({ input: validatedInput }));
      }

      const result = await measure.assert(`Agent.run ${this.config.llm}`, async (m: any) => {
        progressCallback?.({
          stage: "input_resolution",
          message: "Resolving MCP-dependent input fields...",
        });
        await m('Resolve MCP inputs', () =>
          this.resolveMCPInputFields(validatedInput, progressCallback)
        );
        accumulateUsage();

        let activeServers: MCPServer[] = [...(this.config.servers || [])];
        if (this.config.localTools && this.config.localTools.length > 0) {
          activeServers.push({
            name: '__local__',
            description: 'Native application local runtime tools. High priority for internal functionality.',
            url: 'local://internal',
            __localTools: this.config.localTools
          } as any);
        }

        let relevantServers: MCPServer[] = [];
        if (activeServers.length > 0) {
          progressCallback?.({
            stage: "server_selection",
            message: "Analyzing input to determine relevant servers...",
          });
          relevantServers = await m('Select servers', () =>
            this.selectRelevantServers(validatedInput, activeServers)
          ) ?? [];
          accumulateUsage();
          progressCallback?.({
            stage: "server_selection",
            message: `Selected ${relevantServers.length} relevant servers`,
            data: { servers: relevantServers.map((s) => s.name) },
          });
        }

        const toolResults: Record<string, any> = {};
        if (relevantServers.length > 0) {
          progressCallback?.({
            stage: "tool_discovery",
            message: "Discovering available tools...",
          });
          await m('Discover and invoke tools', async () => {
            const toolInvocationPromises: Promise<void>[] = [];

            await Promise.all(relevantServers.map(async (server) => {
              const tools = await discoverTools(server);
              if (tools && tools.length > 0) {
                const relevantTools = await this.selectRelevantTools(validatedInput, tools, server);
                for (const tool of (relevantTools ?? [])) {
                  toolInvocationPromises.push((async () => {
                    const parameters = await this.generateToolParameters(validatedInput, tool);
                    progressCallback?.({
                      stage: "tool_invocation",
                      message: `Invoking ${server.name}.${tool.name} with params...`,
                      data: parameters
                    });

                    let result: any;
                    if (tool.authorize) {
                      const authorized = await tool.authorize(parameters);
                      if (authorized !== true) {
                        const errorMsg = typeof authorized === "string" ? authorized : "Unauthorized by host application";
                        result = { error: errorMsg };
                        auditLog.log({ decision: 'deny', tool: tool.name, server: server.name, agentName, reason: errorMsg, parameters });
                        progressCallback?.({
                          stage: "tool_invocation",
                          message: `Tool ${server.name}.${tool.name} rejected: ${errorMsg}`,
                          data: result
                        });
                      } else {
                        auditLog.log({ decision: 'allow', tool: tool.name, server: server.name, agentName, parameters });
                      }
                    } else {
                      // No authorize hook — auto-allow
                      auditLog.log({ decision: 'allow', tool: tool.name, server: server.name, agentName, parameters });
                    }

                    if (!result) {
                      this.emitEvent({ type: 'tool_start', agentName, server: server.name, tool: tool.name, timestamp: Date.now() });
                      const toolStartMs = Date.now();
                      result = await invokeTool(server, tool.name, parameters);
                      this.emitEvent({ type: 'tool_complete', agentName, server: server.name, tool: tool.name, durationMs: Date.now() - toolStartMs, success: !result?.error, timestamp: Date.now() });
                      progressCallback?.({
                        stage: "tool_invocation",
                        message: `Received result from ${server.name}.${tool.name}`,
                        data: result
                      });
                    }

                    toolResults[`${server.name}.${tool.name}`] = result;
                    toolInvocations.push({
                      server: server.name,
                      tool: tool.name,
                      parameters,
                      result
                    });
                  })());
                }
              }
            }));

            await Promise.all(toolInvocationPromises);
          });
          accumulateUsage();
        }

        progressCallback?.({
          stage: "response_generation",
          message: "Generating final response...",
        });

        const response = await this.generateResponse(validatedInput, toolResults, progressCallback);
        accumulateUsage();

        const validatedResponse = await m('Validate output', () =>
          this.config.outputFormat.parse(response || {})
        );

        return validatedResponse || {};
      });

      this.lastUsage = usage.totalTokens > 0 ? usage : null;
      this.lastCost = this.lastUsage ? calculateCost(this.config.llm, this.lastUsage) : null;

      // Track cumulative context window usage
      if (usage.inputTokens > 0) {
        this.contextTracker.addUsage(usage.inputTokens);
      }

      // Send analytics if configured
      if (this.config.analyticsUrl) {
        await this.sendAnalytics({
          id: requestId,
          agentName: this.config.name || 'unnamed-agent',
          llm: this.config.llm,
          timestamp: startTime,
          duration: Date.now() - startTime,
          status: 'success',
          input,
          output: result,
          toolInvocations: toolInvocations.length > 0 ? toolInvocations : undefined,
          tokenUsage: usage.totalTokens > 0 ? usage : undefined,
        });
      }

      // Run 'after' middleware
      await this.runMiddleware({
        phase: 'after', agentName, llm: this.config.llm, input,
        output: result, usage: this.lastUsage || undefined, cost: this.lastCost || undefined,
        durationMs: Date.now() - startTime,
      });

      // Record output in conversation memory
      if (memory) {
        memory.addAssistant(objToXml({ output: result }));
      }

      this.emitEvent({ type: 'run_complete', agentName, llm: this.config.llm, requestId, durationMs: Date.now() - startTime, usage: this.lastUsage || undefined, cost: this.lastCost || undefined, timestamp: Date.now() });

      return result;
    } catch (error: any) {
      if (error && error.name === 'MockAbortedExecution') {
        // AgentMock requested early exit with static payload
        return error.mockedOutput;
      }

      this.lastUsage = usage.totalTokens > 0 ? usage : null;
      this.lastCost = this.lastUsage ? calculateCost(this.config.llm, this.lastUsage) : null;
      if (this.config.analyticsUrl) {
        await this.sendAnalytics({
          id: requestId,
          agentName: this.config.name || 'unnamed-agent',
          llm: this.config.llm,
          timestamp: startTime,
          duration: Date.now() - startTime,
          status: 'error',
          input,
          output: {},
          error: error instanceof Error ? error.message : String(error),
          toolInvocations: toolInvocations.length > 0 ? toolInvocations : undefined,
          tokenUsage: usage.totalTokens > 0 ? usage : undefined,
        });
      }

      // Run 'error' middleware
      await this.runMiddleware({
        phase: 'error', agentName, llm: this.config.llm, input,
        error: error instanceof Error ? error.message : String(error),
        usage: this.lastUsage || undefined, cost: this.lastCost || undefined,
        durationMs: Date.now() - startTime,
      });

      this.emitEvent({ type: 'run_error', agentName, llm: this.config.llm, requestId, error: error instanceof Error ? error.message : String(error), durationMs: Date.now() - startTime, timestamp: Date.now() });

      throw error;
    }
  }

  private async sendAnalytics(data: {
    id: string;
    agentName: string;
    llm: string;
    timestamp: number;
    duration: number;
    status: 'success' | 'error';
    input: any;
    output: any;
    error?: string;
    toolInvocations?: Array<{ server: string; tool: string; parameters: any; result: any }>;
    tokenUsage?: TokenUsage;
  }): Promise<void> {
    if (!this.config.analyticsUrl) return;

    const flushQueue = async () => {
      try {
        const { existsSync, readFileSync, writeFileSync, mkdirSync } = await import('fs');
        const { join } = await import('path');
        const queueDir = join(process.env.HOME || process.env.USERPROFILE || '/tmp', '.gxai');
        const queueFile = join(queueDir, 'analytics_queue.json');

        if (existsSync(queueFile)) {
          const contents = readFileSync(queueFile, 'utf-8');
          const queue = JSON.parse(contents);
          if (Array.isArray(queue) && queue.length > 0) {
            let stillFailed = [];
            for (const item of queue) {
              try {
                const res = await fetch(this.config.analyticsUrl!, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(item),
                });
                if (!res.ok) throw new Error('Bad status');
              } catch {
                stillFailed.push(item);
              }
            }
            if (stillFailed.length < queue.length) {
              writeFileSync(queueFile, JSON.stringify(stillFailed));
            }
          }
        }
      } catch (err) {
        // Suppress queue errors
      }
    };

    // Try sending current data
    try {
      const res = await fetch(this.config.analyticsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      // If successful, try to flush the offline queue
      // Don't await strictly to prevent blocking
      flushQueue().catch(() => { });
    } catch (e) {
      console.warn('Failed to send analytics, queueing for offline retry:', e);
      try {
        const { existsSync, readFileSync, writeFileSync, mkdirSync } = await import('fs');
        const { join } = await import('path');
        const queueDir = join(process.env.HOME || process.env.USERPROFILE || '/tmp', '.gxai');
        const queueFile = join(queueDir, 'analytics_queue.json');

        if (!existsSync(queueDir)) {
          mkdirSync(queueDir, { recursive: true });
        }

        let queue = [];
        if (existsSync(queueFile)) {
          queue = JSON.parse(readFileSync(queueFile, 'utf-8'));
          if (!Array.isArray(queue)) queue = [];
        }

        queue.push(data);
        writeFileSync(queueFile, JSON.stringify(queue));
      } catch (fsErr) {
        console.warn('Failed to save offline analytics queue:', fsErr);
      }
    }
  }

  private async resolveMCPInputFields(input: any, progressCallback?: ProgressCallback): Promise<void> {
    const shape = this.config.inputFormat.shape;
    for (const [key, schema] of Object.entries(shape)) {
      const desc = (schema as any).description as string | undefined;
      if (!desc || !desc.startsWith("mcp:")) continue;

      const urlMatch = desc.match(/^mcp:\s*(https?:\/\/[^\s]+)/);
      if (!urlMatch) continue;
      const serverUrl = urlMatch[1]!;

      const tempServer: MCPServer = {
        name: `resolver_${key}`,
        description: `Temporary server for resolving input field ${key}`,
        url: serverUrl,
      };

      progressCallback?.({
        stage: "input_resolution",
        message: `Resolving input field "${key}" using MCP server at ${serverUrl}...`,
      });

      const tools = await discoverTools(tempServer);
      if (!tools || tools.length === 0) continue;

      const systemPrompt = `You are selecting the most appropriate tool from the available tools on the server to resolve the value for the input field "${key}". 
      The field's description is: "${desc}".
      Select only the single most relevant tool based on the field description, tool descriptions, and the provided user input.
      If no tool seems suitable, do not select any.`;

      const userPrompt = objToXml({
        resolve_field: key,
        field_description: desc,
        input,
        available_tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema,
        })),
        task: "Select the tool name to invoke to resolve this field",
        response_format: { selected_tool: "string: the name of the selected tool" },
      });

      const response = await callLLM(
        this.config.llm,
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: `<request>${userPrompt}</request>` },
        ],
        { temperature: 0.3 },
        null,
        undefined,
        progressCallback,
        (url, options, _m, desc, pcb) => fetchWithPayment(url, options, desc, pcb, this.config.solanaWallet)
      );

      if (!response) continue;

      let selectedToolName: string | undefined;
      try {
        const parsed = xmlToObj(response);
        selectedToolName = parsed.selected_tool;
      } catch (error) {
        continue;
      }

      if (!selectedToolName) continue;

      const tool = tools.find((t) => t.name === selectedToolName);
      if (!tool) continue;

      const parameters = await this.generateToolParameters(input, tool);
      const result = await invokeTool(tempServer, tool.name, parameters);

      input[key] = result;

      progressCallback?.({
        stage: "input_resolution",
        message: `Resolved input field "${key}" with value: ${JSON.stringify(result).substring(0, 100)}...`,
      });
    }
  }

  private async selectRelevantServers(input: any, activeServers: MCPServer[]): Promise<MCPServer[]> {
    if (!activeServers || activeServers.length === 0) return [];

    return await measure('Select relevant servers', async () => {
      const systemPrompt = `You are analyzing user input to determine which servers might be relevant to fulfill the request. 
        Select only servers that are likely needed based on the input content.`;
      const userPrompt = objToXml({
        input,
        available_servers: activeServers.map(s => ({ name: s.name, description: s.description })),
        task: "Select relevant server names that should be used to fulfill this request",
        response_format: { relevant_servers: { server_names: "array of server names" } },
      });

      const response = await callLLM(
        this.config.llm,
        [{ role: "system", content: systemPrompt }, { role: "user", content: `<request>${userPrompt}</request>` }],
        { temperature: 0.3 },
        null,
        undefined,
        undefined,
        (url, options, _m, desc) => fetchWithPayment(url, options, desc)
      );

      if (!response) return activeServers;

      try {
        const parsed = xmlToObj(response);
        const serverNames = parsed.relevant_servers?.server_names || [];
        return activeServers.filter(server =>
          Array.isArray(serverNames) ? serverNames.includes(server.name) : serverNames === server.name
        );
      } catch (error) {
        return activeServers;
      }
    }) ?? [];
  }

  private async selectRelevantTools(input: any, tools: MCPTool[], server: MCPServer): Promise<MCPTool[]> {
    if (tools.length === 0) return [];

    return await measure(`Select tools from ${server.name}`, async () => {
      const systemPrompt = `You are selecting which tools from a server should be used to fulfill a user request.
        Select only tools that are necessary for the given input.`;
      const userPrompt = objToXml({
        input,
        server: server.name,
        available_tools: tools.map(t => ({ name: t.name, description: t.description })),
        task: "Select tool names that should be invoked",
        response_format: { selected_tools: { tool_names: "array of tool names" } },
      });

      const response = await callLLM(
        this.config.llm,
        [{ role: "system", content: systemPrompt }, { role: "user", content: `<request>${userPrompt}</request>` }],
        { temperature: 0.3 },
        null,
        undefined,
        undefined,
        (url, options, _m, desc) => fetchWithPayment(url, options, desc)
      );

      if (!response) return tools.slice(0, 1);

      try {
        const parsed = xmlToObj(response);
        const toolNames = parsed.selected_tools?.tool_names || [];
        return tools.filter(tool =>
          Array.isArray(toolNames) ? toolNames.includes(tool.name) : toolNames === tool.name
        );
      } catch (error) {
        return tools.slice(0, 1);
      }
    }) ?? [];
  }

  private async generateToolParameters(input: any, tool: MCPTool): Promise<any> {
    return await measure(`Generate params for ${tool.name}`, async () => {
      const systemPrompt = `You are generating parameters for a tool invocation based on user input and tool specification.
        Generate appropriate parameters that match the tool's input schema.`;
      const userPrompt = objToXml({
        input,
        tool: { name: tool.name, description: tool.description, input_schema: tool.inputSchema },
        task: "Generate parameters for this tool",
        response_format: { parameters: "object containing the tool parameters" },
      });

      const response = await callLLM(
        this.config.llm,
        [{ role: "system", content: systemPrompt }, { role: "user", content: `<request>${userPrompt}</request>` }],
        { temperature: 0.3 },
        null,
        undefined,
        undefined,
        (url, options, _m, desc) => fetchWithPayment(url, options, desc)
      );

      if (!response) return {};

      try {
        const parsed = xmlToObj(response);
        return parsed.parameters || {};
      } catch (error) {
        return {};
      }
    }) ?? {};
  }

  private async generateResponse(
    input: any,
    toolResults: Record<string, any>,
    progressCallback?: ProgressCallback
  ): Promise<any> {
    const streamingCallback: StreamingCallback | undefined = progressCallback ?
      (update: StreamingUpdate) => progressCallback(update as unknown as ProgressUpdate) :
      undefined;

    const isOpenAIFamily = this.config.llm.startsWith('gpt') || this.config.llm.startsWith('o4-');
    const responseFormat = isOpenAIFamily ? {
      type: "json_schema",
      json_schema: {
        name: "gxai_output",
        strict: true,
        schema: Object.assign((await import("zod-to-json-schema")).zodToJsonSchema(this.config.outputFormat), { additionalProperties: false })
      }
    } : undefined;

    let systemPrompt = this.config.systemPrompt || "";
    // Inject conversation history from memory
    const memory = this.config.memory as ConversationMemory | undefined;
    const memoryCtx = (memory && memory.turnCount > 1) ? memory.getContextString() : "";

    const obj: any = { input };

    if (!isOpenAIFamily) {
      obj.output_format = this.getOutputFormatDescription();
      obj.task = this.generateTaskDescription();
    }

    const hasToolResults = toolResults && Object.keys(toolResults).length > 0 &&
      Object.values(toolResults).some(result =>
        result !== null && result !== undefined && result !== '' && JSON.stringify(result) !== '{}');
    if (hasToolResults) {
      obj.context = { tool_results: toolResults };
    }
    const userPrompt = objToXml(obj);
    const messages: Array<{ role: string; content: string; cacheControl?: boolean }> = [];

    if (systemPrompt) {
      messages.push({
        role: "system",
        content: systemPrompt,
        // Cache large static systems (Anthropic caching threshold is typically ~1024 tokens = ~4000 chars)
        cacheControl: systemPrompt.length > 2000
      });
    }

    if (memoryCtx) {
      messages.push({
        role: "system",
        content: memoryCtx,
        // Cache memory boundaries to save massive token replay costs on long-running loops
        cacheControl: memoryCtx.length > 2000
      });
    }

    if (isOpenAIFamily) {
      messages.push({ role: "system", content: "You must precisely follow the json output schema without deviation." });
    }
    messages.push({ role: "user", content: `<request>\n${userPrompt}\n</request>` });

    const response = await measure(`LLM ${this.config.llm}`, () =>
      callLLM(
        this.config.llm,
        messages,
        { temperature: this.config.temperature || 0.7, maxTokens: this.config.maxTokens || 4000, response_format: responseFormat },
        null,
        streamingCallback,
        progressCallback,
        (url, options, _m, desc, pcb) => fetchWithPayment(url, options, desc, pcb, this.config.solanaWallet)
      )
    );

    if (!response) return {};

    // Run output validators before parsing
    if (this.config.outputValidators?.length) {
      for (const validator of this.config.outputValidators) {
        await validator(response, input);
      }
    }

    if (isOpenAIFamily && !streamingCallback) {
      try {
        return JSON.parse(response);
      } catch (e) {
        return {};
      }
    }

    const parsed = xmlToObj(response);
    if (!parsed) return {};

    const rootKey = Object.keys(parsed)[0];
    const sourceObject = (rootKey && typeof parsed[rootKey] === 'object' && Object.keys(parsed).length === 1) ? parsed[rootKey] : parsed;

    const shape = this.config.outputFormat.shape;
    const result: any = {};

    for (const [key, schema] of Object.entries(shape)) {
      if (sourceObject[key] !== undefined) {
        let value = sourceObject[key];
        const typeName = this.getSchemaTypeName(schema as z.ZodType<any>);

        if (typeName === 'ZodString' && typeof value === 'object' && value !== null) {
          const fieldRegex = new RegExp(`<${key}>([\\s\\S]*?)</${key}>`, 's');
          const match = response.match(fieldRegex);
          if (match && typeof match[1] === 'string') {
            value = match[1];
          }
        }
        result[key] = value;
      }
    }
    return result;
  }

  private validateNoArrays(schema: z.ZodObject<any>, path: string = ''): void {
    const shape = schema.shape;
    for (const [key, fieldSchema] of Object.entries(shape)) {
      const currentPath = path ? `${path}.${key}` : key;

      let currentSchema = fieldSchema as any;
      while (currentSchema._def.typeName === 'ZodOptional' || currentSchema._def.typeName === 'ZodNullable') {
        currentSchema = currentSchema.unwrap();
      }

      if (currentSchema._def.typeName === 'ZodArray') {
        throw new Error(`Arrays are not supported in output schema. Found array at path: ${currentPath}. Use individual fields like ${key}_1, ${key}_2 instead.`);
      }

      if (currentSchema._def.typeName === 'ZodObject') {
        this.validateNoArrays(currentSchema, currentPath);
      }
    }
  }

  private getSchemaTypeName(schema: z.ZodType<any>): string {
    const def = schema._def as any;
    if (def.typeName === "ZodOptional" || def.typeName === "ZodNullable") {
      return this.getSchemaTypeName((schema as any).unwrap());
    }
    return def.typeName;
  }

  private getOutputFormatDescription(): any {
    const shape = this.config.outputFormat.shape;
    const description: any = {};

    for (const [key, schema] of Object.entries(shape)) {
      let currentSchema = schema as any;
      while (currentSchema._def.typeName === 'ZodOptional' || currentSchema._def.typeName === 'ZodNullable') {
        currentSchema = currentSchema.unwrap();
      }

      if (currentSchema._def.typeName === 'ZodObject') {
        description[key] = this.getNestedDescription(currentSchema);
      } else {
        description[key] = '';
      }
    }

    return description;
  }

  private getNestedDescription(schema: z.ZodObject<any>): any {
    const shape = schema.shape;
    const description: any = {};

    for (const [key, fieldSchema] of Object.entries(shape)) {
      let currentSchema = fieldSchema as any;
      while (currentSchema._def.typeName === 'ZodOptional' || currentSchema._def.typeName === 'ZodNullable') {
        currentSchema = currentSchema.unwrap();
      }

      if (currentSchema._def.typeName === 'ZodObject') {
        description[key] = this.getNestedDescription(currentSchema);
      } else {
        description[key] = '';
      }
    }

    return description;
  }

  private generateTaskDescription(): string {
    const fieldDescriptions = this.getFieldDescriptions(this.config.outputFormat);
    let task = "Generate a response matching the output format exactly, using XML tags for each field";

    if (fieldDescriptions.length > 0) {
      task += "\naccordingly to following instructions:\n\n" + fieldDescriptions.join('\n');
    }

    return task;
  }

  private getFieldDescriptions(schema: z.ZodObject<any>, path: string = ''): string[] {
    const shape = schema.shape;
    const descriptions: string[] = [];

    for (const [key, fieldSchema] of Object.entries(shape)) {
      const currentPath = path ? `${path}_${key}` : key;

      let currentSchema = fieldSchema as any;
      let description = (fieldSchema as any).description || '';

      while (currentSchema._def.typeName === 'ZodOptional' || currentSchema._def.typeName === 'ZodNullable') {
        currentSchema = currentSchema.unwrap();
        if (!description) {
          description = currentSchema.description || '';
        }
      }

      let constraint: string | null = null;
      if (currentSchema._def.typeName === 'ZodBoolean') {
        constraint = 'either "true" or "false"';
      } else if (currentSchema._def.typeName === 'ZodEnum') {
        const allowedValues = currentSchema._def.values;
        constraint = `exactly one of these values: ${allowedValues.map((v: string) => `"${v}"`).join(', ')}`;
      }

      if (constraint) {
        if (description) {
          description += `. Must be ${constraint}`;
        } else {
          description = `Must be ${constraint}`;
        }
      }

      if (description) {
        descriptions.push(`- ${currentPath} SHOULD be ${description}`);
      }

      if (currentSchema._def.typeName === 'ZodObject') {
        descriptions.push(...this.getFieldDescriptions(currentSchema, currentPath));
      }
    }

    return descriptions;
  }
}

if (import.meta.env.NODE_ENV === "test") {
  const { test, expect } = await import('bun:test');

  test('Agent constructor validates no arrays in output schema', () => {
    const validConfig = {
      llm: 'gpt-4o-mini' as const,
      inputFormat: z.object({}),
      outputFormat: z.object({ field: z.string() }),
    };
    expect(() => new Agent(validConfig)).not.toThrow();

    const invalidConfig = {
      llm: 'gpt-4o-mini' as const,
      inputFormat: z.object({}),
      outputFormat: z.object({ field: z.array(z.string()) }),
    };
    expect(() => new Agent(invalidConfig)).toThrow('Arrays are not supported');
  });

  test('Agent run validates input', async () => {
    const config = {
      llm: 'gpt-4o-mini' as const,
      inputFormat: z.object({ name: z.string() }),
      outputFormat: z.object({ output: z.string() }),
    };
    const agent = new Agent(config);
    // Should throw on invalid input
    await expect(agent.run({ invalid: true } as any)).rejects.toThrow();
  });
}
