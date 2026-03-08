/**
 * webhook.ts — HTTP Webhook Receiver
 *
 * HMAC-SHA256 signature verification and event routing for incoming webhooks.
 * Compatible with GitHub, Stripe, and custom webhook sources.
 *
 * Usage:
 *   const wh = new WebhookHandler({ secret: 'my-secret' });
 *   wh.on('push', async (payload) => { ... });
 *   wh.on('issue', async (payload) => { ... });
 *   const result = await wh.handle(body, signature, eventType);
 */

export type WebhookEventHandler = (payload: any, meta: WebhookMeta) => void | Promise<void>;

export interface WebhookMeta {
    event: string;
    timestamp: number;
    signature?: string;
    id: string;
}

export interface WebhookConfig {
    secret?: string;
    maxPayloadSize?: number; // bytes
    allowedEvents?: string[];
}

export interface WebhookResult {
    success: boolean;
    event: string;
    error?: string;
    processingMs: number;
}

export class WebhookHandler {
    private handlers = new Map<string, WebhookEventHandler[]>();
    private config: WebhookConfig;
    private history: WebhookResult[] = [];
    private maxHistory = 100;

    constructor(config: WebhookConfig = {}) {
        this.config = {
            maxPayloadSize: config.maxPayloadSize ?? 1024 * 1024, // 1MB
            ...config,
        };
    }

    /** Register an event handler */
    on(event: string, handler: WebhookEventHandler): this {
        if (!this.handlers.has(event)) this.handlers.set(event, []);
        this.handlers.get(event)!.push(handler);
        return this;
    }

    /** Register a catch-all handler */
    onAny(handler: WebhookEventHandler): this {
        return this.on('*', handler);
    }

    /** Remove all handlers for an event */
    off(event: string): this {
        this.handlers.delete(event);
        return this;
    }

    /** Handle an incoming webhook */
    async handle(body: string | Record<string, any>, signature?: string, event = 'unknown'): Promise<WebhookResult> {
        const start = Date.now();

        // Size check
        const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
        if (bodyStr.length > this.config.maxPayloadSize!) {
            return this.recordResult({ success: false, event, error: 'Payload too large', processingMs: Date.now() - start });
        }

        // Event allowlist
        if (this.config.allowedEvents && !this.config.allowedEvents.includes(event)) {
            return this.recordResult({ success: false, event, error: `Event "${event}" not allowed`, processingMs: Date.now() - start });
        }

        // Signature verification
        if (this.config.secret && signature) {
            const valid = await this.verifySignature(bodyStr, signature);
            if (!valid) {
                return this.recordResult({ success: false, event, error: 'Invalid signature', processingMs: Date.now() - start });
            }
        }

        // Parse payload
        let payload: any;
        try {
            payload = typeof body === 'string' ? JSON.parse(body) : body;
        } catch {
            return this.recordResult({ success: false, event, error: 'Invalid JSON', processingMs: Date.now() - start });
        }

        const meta: WebhookMeta = {
            event,
            timestamp: Date.now(),
            signature,
            id: `wh-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        };

        // Dispatch to handlers
        const eventHandlers = this.handlers.get(event) || [];
        const wildcardHandlers = this.handlers.get('*') || [];
        const allHandlers = [...eventHandlers, ...wildcardHandlers];

        if (allHandlers.length === 0) {
            return this.recordResult({ success: true, event, error: 'No handlers registered', processingMs: Date.now() - start });
        }

        try {
            for (const handler of allHandlers) {
                await handler(payload, meta);
            }
            return this.recordResult({ success: true, event, processingMs: Date.now() - start });
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            return this.recordResult({ success: false, event, error: errMsg, processingMs: Date.now() - start });
        }
    }

    /** Verify HMAC-SHA256 signature */
    private async verifySignature(body: string, signature: string): Promise<boolean> {
        if (!this.config.secret) return true;
        const expected = await hmacSha256(body, this.config.secret);
        // Support both raw hex and sha256=hex formats (GitHub-style)
        const normalizedSig = signature.startsWith('sha256=') ? signature.slice(7) : signature;
        return timingSafeEqual(expected, normalizedSig);
    }

    /** Get webhook history */
    getHistory(): WebhookResult[] {
        return [...this.history];
    }

    /** Get registered event names */
    get events(): string[] {
        return [...this.handlers.keys()];
    }

    /** Get handler count for an event */
    handlerCount(event: string): number {
        return (this.handlers.get(event) || []).length;
    }

    private recordResult(result: WebhookResult): WebhookResult {
        this.history.push(result);
        if (this.history.length > this.maxHistory) this.history.shift();
        return result;
    }
}

/** HMAC-SHA256 using Web Crypto API (works in Bun, Node 18+, browsers) */
export async function hmacSha256(message: string, secret: string): Promise<string> {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
    return Array.from(new Uint8Array(sig))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

/** Timing-safe string comparison to prevent timing attacks */
function timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let result = 0;
    for (let i = 0; i < a.length; i++) {
        result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
}

/** @deprecated Use hmacSha256 instead — kept for backward compatibility */
export function simpleHash(input: string): string {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
        const char = input.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
}
