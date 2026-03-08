/**
 * structured-log.ts — Structured JSON Logging
 *
 * Structured log records with levels, correlation IDs,
 * context fields, and configurable transports.
 *
 * Usage:
 *   const logger = new StructuredLogger({ name: 'my-agent' });
 *   logger.info('Processing request', { userId: '123' });
 *   logger.error('Failed', { error: err.message });
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

const LOG_LEVEL_VALUES: Record<LogLevel, number> = {
    debug: 0, info: 1, warn: 2, error: 3, fatal: 4,
};

export interface LogRecord {
    timestamp: string;
    level: LogLevel;
    message: string;
    logger: string;
    correlationId?: string;
    fields: Record<string, any>;
}

export type LogTransport = (record: LogRecord) => void;

export interface StructuredLoggerConfig {
    /** Logger name */
    name: string;
    /** Minimum log level (default: 'info') */
    minLevel?: LogLevel;
    /** Correlation ID for request tracing */
    correlationId?: string;
    /** Default fields added to every log */
    defaultFields?: Record<string, any>;
    /** Custom transports (default: console) */
    transports?: LogTransport[];
    /** Max records to keep in buffer (default: 500) */
    bufferSize?: number;
}

/** Console transport — pretty prints to console */
export function consoleTransport(): LogTransport {
    const colors: Record<LogLevel, string> = {
        debug: '\x1b[90m', info: '\x1b[36m', warn: '\x1b[33m',
        error: '\x1b[31m', fatal: '\x1b[35m',
    };
    const reset = '\x1b[0m';

    return (record) => {
        const color = colors[record.level] || '';
        const fields = Object.keys(record.fields).length > 0
            ? ` ${JSON.stringify(record.fields)}`
            : '';
        const corr = record.correlationId ? ` [${record.correlationId}]` : '';
        console.log(`${color}[${record.level.toUpperCase()}]${reset} ${record.timestamp} ${record.logger}${corr}: ${record.message}${fields}`);
    };
}

/** JSON transport — outputs raw JSON lines */
export function jsonTransport(writer: (line: string) => void = console.log): LogTransport {
    return (record) => writer(JSON.stringify(record));
}

/** Buffer transport — stores records in memory */
export function bufferTransport(buffer: LogRecord[]): LogTransport {
    return (record) => { buffer.push(record); };
}

export class StructuredLogger {
    private config: Required<StructuredLoggerConfig>;
    private records: LogRecord[] = [];
    private transports: LogTransport[];

    constructor(config: StructuredLoggerConfig) {
        this.config = {
            name: config.name,
            minLevel: config.minLevel ?? 'info',
            correlationId: config.correlationId ?? '',
            defaultFields: config.defaultFields ?? {},
            transports: config.transports ?? [consoleTransport()],
            bufferSize: config.bufferSize ?? 500,
        };
        this.transports = this.config.transports;
    }

    /** Create a child logger with additional context */
    child(fields: Record<string, any>, correlationId?: string): StructuredLogger {
        return new StructuredLogger({
            ...this.config,
            defaultFields: { ...this.config.defaultFields, ...fields },
            correlationId: correlationId ?? this.config.correlationId,
        });
    }

    /** Set correlation ID for request tracing */
    setCorrelationId(id: string): void {
        this.config.correlationId = id;
    }

    debug(message: string, fields?: Record<string, any>): void { this.log('debug', message, fields); }
    info(message: string, fields?: Record<string, any>): void { this.log('info', message, fields); }
    warn(message: string, fields?: Record<string, any>): void { this.log('warn', message, fields); }
    error(message: string, fields?: Record<string, any>): void { this.log('error', message, fields); }
    fatal(message: string, fields?: Record<string, any>): void { this.log('fatal', message, fields); }

    private log(level: LogLevel, message: string, fields?: Record<string, any>): void {
        if (LOG_LEVEL_VALUES[level] < LOG_LEVEL_VALUES[this.config.minLevel]) return;

        const record: LogRecord = {
            timestamp: new Date().toISOString(),
            level,
            message,
            logger: this.config.name,
            correlationId: this.config.correlationId || undefined,
            fields: { ...this.config.defaultFields, ...fields },
        };

        // Buffer
        this.records.push(record);
        if (this.records.length > this.config.bufferSize) {
            this.records = this.records.slice(-this.config.bufferSize);
        }

        // Dispatch to transports
        for (const transport of this.transports) {
            try { transport(record); } catch { /* non-fatal */ }
        }
    }

    /** Get buffered records, optionally filtered by level */
    getRecords(level?: LogLevel): LogRecord[] {
        if (!level) return [...this.records];
        const minVal = LOG_LEVEL_VALUES[level];
        return this.records.filter(r => LOG_LEVEL_VALUES[r.level] >= minVal);
    }

    /** Clear buffer */
    clearRecords(): void {
        this.records = [];
    }

    /** Get record count */
    get recordCount(): number {
        return this.records.length;
    }
}
