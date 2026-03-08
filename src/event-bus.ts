/**
 * event-bus.ts — Agent Event Bus
 *
 * Pub/sub event system for decoupled inter-agent communication.
 * Agents can publish events and subscribe to events from other agents.
 *
 * Usage:
 *   const bus = new EventBus();
 *   bus.on('task:complete', (data) => console.log(data));
 *   bus.emit('task:complete', { result: 'success' });
 */

export type EventHandler<T = any> = (data: T, meta: EventMeta) => void | Promise<void>;

export interface EventMeta {
    /** Event name */
    event: string;
    /** Timestamp of emission */
    timestamp: number;
    /** Source agent/component name */
    source?: string;
}

export interface EventBusConfig {
    /** Max listeners per event to prevent leaks (default: 50) */
    maxListeners?: number;
    /** Whether to log events (default: false) */
    debug?: boolean;
}

export class EventBus {
    private listeners = new Map<string, Set<EventHandler>>();
    private onceListeners = new Map<string, Set<EventHandler>>();
    private config: EventBusConfig;
    private history: Array<{ event: string; data: any; timestamp: number }> = [];
    private maxHistory = 100;

    constructor(config: EventBusConfig = {}) {
        this.config = config;
    }

    /** Subscribe to an event */
    on<T = any>(event: string, handler: EventHandler<T>): () => void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        const handlers = this.listeners.get(event)!;
        const maxListeners = this.config.maxListeners ?? 50;
        if (handlers.size >= maxListeners) {
            console.warn(`[EventBus] Max listeners (${maxListeners}) reached for "${event}"`);
        }
        handlers.add(handler as EventHandler);

        // Return unsubscribe function
        return () => {
            handlers.delete(handler as EventHandler);
            if (handlers.size === 0) this.listeners.delete(event);
        };
    }

    /** Subscribe to an event (fires once then auto-unsubscribes) */
    once<T = any>(event: string, handler: EventHandler<T>): () => void {
        if (!this.onceListeners.has(event)) {
            this.onceListeners.set(event, new Set());
        }
        this.onceListeners.get(event)!.add(handler as EventHandler);

        return () => {
            this.onceListeners.get(event)?.delete(handler as EventHandler);
        };
    }

    /** Emit an event to all subscribers */
    async emit<T = any>(event: string, data?: T, source?: string): Promise<void> {
        const meta: EventMeta = {
            event,
            timestamp: Date.now(),
            source,
        };

        if (this.config.debug) {
            console.log(`[EventBus] ${event}`, data);
        }

        // Record in history
        this.history.push({ event, data, timestamp: meta.timestamp });
        if (this.history.length > this.maxHistory) {
            this.history = this.history.slice(-this.maxHistory);
        }

        // Notify regular listeners
        const handlers = this.listeners.get(event);
        if (handlers) {
            for (const handler of handlers) {
                try { await handler(data, meta); } catch { /* non-fatal */ }
            }
        }

        // Notify once listeners and remove them
        const onceHandlers = this.onceListeners.get(event);
        if (onceHandlers) {
            for (const handler of onceHandlers) {
                try { await handler(data, meta); } catch { /* non-fatal */ }
            }
            this.onceListeners.delete(event);
        }

        // Notify wildcard listeners
        const wildcardHandlers = this.listeners.get('*');
        if (wildcardHandlers) {
            for (const handler of wildcardHandlers) {
                try { await handler(data, meta); } catch { /* non-fatal */ }
            }
        }
    }

    /** Remove all listeners for an event */
    off(event: string): void {
        this.listeners.delete(event);
        this.onceListeners.delete(event);
    }

    /** Remove all listeners */
    clear(): void {
        this.listeners.clear();
        this.onceListeners.clear();
    }

    /** Get the number of listeners for an event */
    listenerCount(event: string): number {
        return (this.listeners.get(event)?.size ?? 0) +
            (this.onceListeners.get(event)?.size ?? 0);
    }

    /** Get all registered event names */
    get events(): string[] {
        return [...new Set([...this.listeners.keys(), ...this.onceListeners.keys()])];
    }

    /** Get recent event history */
    getHistory(limit = 20): typeof this.history {
        return this.history.slice(-limit);
    }

    /** Wait for a specific event (returns a promise) */
    waitFor<T = any>(event: string, timeoutMs = 30000): Promise<T> {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(`EventBus.waitFor("${event}") timed out after ${timeoutMs}ms`));
            }, timeoutMs);

            this.once(event, (data: T) => {
                clearTimeout(timer);
                resolve(data);
            });
        });
    }
}

/** Global shared event bus instance */
export const globalBus = new EventBus();
