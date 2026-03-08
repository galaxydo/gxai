/**
 * audit.ts — Tool Authorization Audit Log
 *
 * Structured audit trail for all tool authorization decisions.
 * Records allow/deny decisions with context for compliance and debugging.
 *
 * Usage:
 *   import { auditLog, getAuditEntries } from './audit';
 *   auditLog.log({ decision: 'allow', tool: 'fetch', server: 'web', ... });
 *   const entries = auditLog.getEntries({ since: Date.now() - 3600_000 });
 */

export interface AuditEntry {
    timestamp: number;
    decision: 'allow' | 'deny';
    tool: string;
    server: string;
    agentName: string;
    reason?: string;
    parameters?: any;
}

export interface AuditQuery {
    /** Only entries after this timestamp */
    since?: number;
    /** Filter by decision */
    decision?: 'allow' | 'deny';
    /** Filter by tool name */
    tool?: string;
    /** Filter by server name */
    server?: string;
    /** Maximum entries to return */
    limit?: number;
}

export interface AuditStats {
    totalEntries: number;
    allowCount: number;
    denyCount: number;
    deniedTools: Record<string, number>;
}

export class AuditLog {
    private entries: AuditEntry[] = [];
    private maxEntries: number;

    constructor(maxEntries = 1000) {
        this.maxEntries = maxEntries;
    }

    /** Record an authorization decision */
    log(entry: Omit<AuditEntry, 'timestamp'>): void {
        this.entries.push({
            ...entry,
            timestamp: Date.now(),
            // Truncate parameters to avoid memory bloat
            parameters: entry.parameters
                ? JSON.parse(JSON.stringify(entry.parameters).substring(0, 500))
                : undefined,
        });

        // Enforce max entries
        if (this.entries.length > this.maxEntries) {
            this.entries = this.entries.slice(-this.maxEntries);
        }
    }

    /** Query audit entries with optional filters */
    getEntries(query: AuditQuery = {}): AuditEntry[] {
        let result = [...this.entries];

        if (query.since) {
            result = result.filter(e => e.timestamp >= query.since!);
        }
        if (query.decision) {
            result = result.filter(e => e.decision === query.decision);
        }
        if (query.tool) {
            result = result.filter(e => e.tool.includes(query.tool!));
        }
        if (query.server) {
            result = result.filter(e => e.server.includes(query.server!));
        }
        if (query.limit) {
            result = result.slice(-query.limit);
        }

        return result;
    }

    /** Get aggregate statistics */
    getStats(): AuditStats {
        const deniedTools: Record<string, number> = {};
        let allowCount = 0;
        let denyCount = 0;

        for (const entry of this.entries) {
            if (entry.decision === 'allow') allowCount++;
            else {
                denyCount++;
                const key = `${entry.server}.${entry.tool}`;
                deniedTools[key] = (deniedTools[key] || 0) + 1;
            }
        }

        return {
            totalEntries: this.entries.length,
            allowCount,
            denyCount,
            deniedTools,
        };
    }

    /** Clear all entries */
    clear(): void {
        this.entries = [];
    }

    /** Export for serialization */
    toJSON(): AuditEntry[] {
        return [...this.entries];
    }

    /** Import from serialized data */
    fromJSON(entries: AuditEntry[]): void {
        this.entries = [...entries];
    }
}

/** Global singleton audit log */
export const auditLog = new AuditLog();
