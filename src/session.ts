/**
 * session.ts — Agent Session Manager
 *
 * Persistent session state with serialization/deserialization.
 *
 * Usage:
 *   const session = new SessionManager({ storageKey: 'my-agent' });
 *   session.set('userId', '123');
 *   session.save(); // persist to storage
 *   session.load(); // restore from storage
 */

export interface SessionConfig {
    /** Storage key prefix */
    storageKey?: string;
    /** Auto-save on every set (default: false) */
    autoSave?: boolean;
    /** Max session age in ms (default: 24h) */
    maxAge?: number;
    /** Custom serializer */
    serialize?: (data: any) => string;
    /** Custom deserializer */
    deserialize?: (data: string) => any;
}

export interface SessionSnapshot {
    id: string;
    data: Record<string, any>;
    createdAt: number;
    updatedAt: number;
    version: number;
}

export class SessionManager {
    private data = new Map<string, any>();
    private config: Required<SessionConfig>;
    private createdAt: number;
    private updatedAt: number;
    private version = 0;
    readonly id: string;

    constructor(config: SessionConfig = {}) {
        this.id = `session-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        this.createdAt = Date.now();
        this.updatedAt = Date.now();
        this.config = {
            storageKey: config.storageKey ?? 'gxai-session',
            autoSave: config.autoSave ?? false,
            maxAge: config.maxAge ?? 24 * 60 * 60 * 1000,
            serialize: config.serialize ?? JSON.stringify,
            deserialize: config.deserialize ?? JSON.parse,
        };
    }

    /** Set a session value */
    set(key: string, value: any): this {
        this.data.set(key, value);
        this.updatedAt = Date.now();
        this.version++;
        if (this.config.autoSave) this.save();
        return this;
    }

    /** Get a session value */
    get<T = any>(key: string, defaultValue?: T): T {
        return this.data.has(key) ? this.data.get(key) as T : (defaultValue as T);
    }

    /** Check if key exists */
    has(key: string): boolean {
        return this.data.has(key);
    }

    /** Delete a key */
    delete(key: string): boolean {
        const result = this.data.delete(key);
        if (result) {
            this.updatedAt = Date.now();
            this.version++;
        }
        return result;
    }

    /** Clear all session data */
    clear(): void {
        this.data.clear();
        this.updatedAt = Date.now();
        this.version++;
    }

    /** Get all keys */
    get keys(): string[] {
        return [...this.data.keys()];
    }

    /** Get session size */
    get size(): number {
        return this.data.size;
    }

    /** Check if session has expired */
    get expired(): boolean {
        return Date.now() - this.createdAt > this.config.maxAge;
    }

    /** Get a snapshot of the session */
    snapshot(): SessionSnapshot {
        const obj: Record<string, any> = {};
        for (const [k, v] of this.data) obj[k] = v;
        return {
            id: this.id,
            data: obj,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt,
            version: this.version,
        };
    }

    /** Serialize session to string */
    serialize(): string {
        return this.config.serialize(this.snapshot());
    }

    /** Restore session from string */
    restore(serialized: string): this {
        const snap: SessionSnapshot = this.config.deserialize(serialized);
        this.data.clear();
        for (const [k, v] of Object.entries(snap.data)) {
            this.data.set(k, v);
        }
        this.createdAt = snap.createdAt;
        this.updatedAt = snap.updatedAt;
        this.version = snap.version;
        return this;
    }

    /** Save to global storage (if available) */
    save(): boolean {
        try {
            if (typeof globalThis !== 'undefined' && (globalThis as any).__sessionStore) {
                (globalThis as any).__sessionStore[this.config.storageKey] = this.serialize();
                return true;
            }
            return false;
        } catch { return false; }
    }

    /** Load from global storage (if available) */
    load(): boolean {
        try {
            if (typeof globalThis !== 'undefined' && (globalThis as any).__sessionStore) {
                const data = (globalThis as any).__sessionStore[this.config.storageKey];
                if (data) { this.restore(data); return true; }
            }
            return false;
        } catch { return false; }
    }

    /** Merge another session's data into this one */
    merge(other: SessionManager): this {
        for (const key of other.keys) {
            this.data.set(key, other.get(key));
        }
        this.updatedAt = Date.now();
        this.version++;
        return this;
    }
}
