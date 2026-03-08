/**
 * otel.ts — OpenTelemetry Integration
 *
 * Lightweight span export for agent execution.
 * Converts RunEvents into OpenTelemetry-compatible spans
 * and sends them to a configurable OTLP endpoint.
 *
 * Works without the full @opentelemetry SDK — just HTTP POST
 * to any OTLP-compatible collector (Jaeger, Datadog, etc.)
 */

import type { RunEvent, RunEventCallback } from './agent';

export interface OtelConfig {
    /** OTLP HTTP endpoint (e.g., http://localhost:4318/v1/traces) */
    endpoint: string;
    /** Service name for tracing */
    serviceName?: string;
    /** Additional resource attributes */
    attributes?: Record<string, string>;
    /** Headers for the OTLP request (e.g., auth tokens) */
    headers?: Record<string, string>;
    /** Whether to batch spans (default: true) */
    batch?: boolean;
    /** Batch flush interval in ms (default: 5000) */
    batchIntervalMs?: number;
}

interface OtelSpan {
    traceId: string;
    spanId: string;
    parentSpanId?: string;
    name: string;
    kind: number; // 1=INTERNAL, 2=SERVER, 3=CLIENT
    startTimeUnixNano: string;
    endTimeUnixNano: string;
    attributes: Array<{ key: string; value: { stringValue?: string; intValue?: string } }>;
    status: { code: number; message?: string }; // 0=UNSET, 1=OK, 2=ERROR
}

/** Generate a random 16-byte trace ID (hex) */
function generateTraceId(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Generate a random 8-byte span ID (hex) */
function generateSpanId(): string {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function tsToNano(timestampMs: number): string {
    return (BigInt(timestampMs) * 1_000_000n).toString();
}

function makeAttr(key: string, value: string | number): OtelSpan['attributes'][0] {
    if (typeof value === 'number') {
        return { key, value: { intValue: String(value) } };
    }
    return { key, value: { stringValue: value } };
}

/**
 * Create an OpenTelemetry-aware event callback for Agent.onEvent().
 *
 * Usage:
 *   const otel = createOtelCallback({
 *     endpoint: 'http://localhost:4318/v1/traces',
 *     serviceName: 'my-agent',
 *   });
 *   agent.onEvent(otel);
 */
export function createOtelCallback(config: OtelConfig): RunEventCallback {
    const serviceName = config.serviceName || 'gxai-agent';
    const pendingSpans: Map<string, { traceId: string; startTime: number }> = new Map();
    const spanBuffer: OtelSpan[] = [];
    let flushTimer: ReturnType<typeof setInterval> | null = null;

    const flush = async () => {
        if (spanBuffer.length === 0) return;
        const spans = spanBuffer.splice(0, spanBuffer.length);

        const payload = {
            resourceSpans: [{
                resource: {
                    attributes: [
                        makeAttr('service.name', serviceName),
                        ...(config.attributes ? Object.entries(config.attributes).map(([k, v]) => makeAttr(k, v)) : []),
                    ],
                },
                scopeSpans: [{
                    scope: { name: 'gxai', version: '1.0.0' },
                    spans,
                }],
            }],
        };

        try {
            await fetch(config.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(config.headers || {}),
                },
                body: JSON.stringify(payload),
            });
        } catch {
            // Non-fatal — telemetry should never break the agent
        }
    };

    // Start batch timer
    if (config.batch !== false) {
        flushTimer = setInterval(flush, config.batchIntervalMs || 5000);
    }

    return (event: RunEvent) => {
        switch (event.type) {
            case 'run_start': {
                const traceId = generateTraceId();
                pendingSpans.set(event.requestId, { traceId, startTime: event.timestamp });
                break;
            }

            case 'run_complete': {
                const pending = pendingSpans.get(event.requestId);
                if (!pending) break;
                pendingSpans.delete(event.requestId);

                const span: OtelSpan = {
                    traceId: pending.traceId,
                    spanId: generateSpanId(),
                    name: `agent.run ${event.agentName}`,
                    kind: 1,
                    startTimeUnixNano: tsToNano(pending.startTime),
                    endTimeUnixNano: tsToNano(event.timestamp),
                    attributes: [
                        makeAttr('agent.name', event.agentName),
                        makeAttr('agent.llm', event.llm),
                        makeAttr('agent.request_id', event.requestId),
                        makeAttr('agent.duration_ms', event.durationMs),
                        ...(event.usage ? [
                            makeAttr('agent.input_tokens', event.usage.inputTokens),
                            makeAttr('agent.output_tokens', event.usage.outputTokens),
                        ] : []),
                        ...(event.cost ? [makeAttr('agent.cost_usd', String(event.cost.totalCost))] : []),
                    ],
                    status: { code: 1 },
                };
                spanBuffer.push(span);
                if (config.batch === false) flush();
                break;
            }

            case 'run_error': {
                const pending = pendingSpans.get(event.requestId);
                if (!pending) break;
                pendingSpans.delete(event.requestId);

                const span: OtelSpan = {
                    traceId: pending.traceId,
                    spanId: generateSpanId(),
                    name: `agent.run ${event.agentName}`,
                    kind: 1,
                    startTimeUnixNano: tsToNano(pending.startTime),
                    endTimeUnixNano: tsToNano(event.timestamp),
                    attributes: [
                        makeAttr('agent.name', event.agentName),
                        makeAttr('agent.llm', event.llm),
                        makeAttr('agent.request_id', event.requestId),
                        makeAttr('agent.duration_ms', event.durationMs),
                        makeAttr('error.message', event.error),
                    ],
                    status: { code: 2, message: event.error },
                };
                spanBuffer.push(span);
                if (config.batch === false) flush();
                break;
            }

            case 'tool_complete': {
                // Tool invocations get their own spans
                const span: OtelSpan = {
                    traceId: generateTraceId(), // Standalone for now
                    spanId: generateSpanId(),
                    name: `tool.invoke ${event.server}.${event.tool}`,
                    kind: 3,
                    startTimeUnixNano: tsToNano(event.timestamp - event.durationMs),
                    endTimeUnixNano: tsToNano(event.timestamp),
                    attributes: [
                        makeAttr('tool.server', event.server),
                        makeAttr('tool.name', event.tool),
                        makeAttr('tool.duration_ms', event.durationMs),
                        makeAttr('tool.success', event.success ? 'true' : 'false'),
                    ],
                    status: { code: event.success ? 1 : 2 },
                };
                spanBuffer.push(span);
                if (config.batch === false) flush();
                break;
            }
        }
    };
}

/** Stop the batch flush timer (for cleanup) */
export function stopOtelFlush(callback: RunEventCallback): void {
    // The timer is captured in the closure — caller should manage lifecycle
    // This is a placeholder for future cleanup API
}
