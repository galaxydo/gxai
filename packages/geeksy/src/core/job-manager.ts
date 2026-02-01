/**
 * Job Manager - Manages agent processing jobs
 * 
 * Jobs are spawned instances of agents processing specific messages.
 * One message can spawn multiple jobs (from multiple agent templates).
 * Jobs can be:
 * - pending - Waiting to be processed
 * - processing - Currently being processed
 * - awaiting_callback - Paused, waiting for external input
 * - completed - Successfully finished
 * - failed - Encountered an error
 */

import { getDatabase, generateId, stringifyJSON, parseJSON } from './database';

export type JobStatus = 'pending' | 'processing' | 'awaiting_callback' | 'completed' | 'failed';

export interface JobLogEntry {
    timestamp: number;
    level: 'info' | 'warn' | 'error' | 'debug';
    message: string;
    data?: any;
}

export interface JobData {
    id: string;
    messageId: string;           // The message that triggered this job
    agentId: string;             // Agent template that spawned this job
    agentName: string;
    agentEmoji: string;
    status: JobStatus;
    decision: 'handle' | 'respond' | 'spawn' | 'ignore';
    reason: string;              // Why the agent made this decision
    result?: any;                // Output from the job
    error?: string;              // Error message if failed
    awaitingCallbackType?: string;  // e.g., 'user_confirmation', 'data_fetch'
    awaitingCallbackData?: any;     // Data needed to resume
    startedAt: number;
    completedAt?: number;
    logs: JobLogEntry[];         // Processing logs
}

type JobUpdateHandler = (job: JobData) => void;

export class JobManager {
    private handlers: Set<JobUpdateHandler> = new Set();
    private broadcastChannel = new BroadcastChannel('geeksy-jobs');

    constructor() {
        // Listen for job updates from other processes
        this.broadcastChannel.onmessage = (event) => {
            const job = event.data as JobData;
            this.notifyHandlers(job);
        };
    }

    /** Create a new job */
    createJob(
        messageId: string,
        agentId: string,
        agentName: string,
        agentEmoji: string,
        decision: JobData['decision'],
        reason: string
    ): JobData {
        const db = getDatabase();
        const jobId = generateId('job');

        const logs: JobLogEntry[] = [{
            timestamp: Date.now(),
            level: 'info',
            message: `Job created: ${decision} - ${reason}`
        }];

        const job: JobData = {
            id: jobId,
            messageId,
            agentId,
            agentName,
            agentEmoji,
            status: 'pending',
            decision,
            reason,
            startedAt: Date.now(),
            logs,
        };

        db.jobs.insert({
            jobId: job.id,
            messageId: job.messageId,
            agentId: job.agentId,
            agentName: job.agentName,
            agentEmoji: job.agentEmoji,
            status: job.status,
            decision: job.decision,
            reason: job.reason,
            startedAt: job.startedAt,
            logs: stringifyJSON(job.logs),
        });

        this.broadcastChannel.postMessage(job);
        this.notifyHandlers(job);

        return job;
    }

    /** Update job status */
    updateStatus(jobId: string, status: JobStatus, data?: Partial<JobData>): JobData | null {
        const db = getDatabase();
        const row = db.jobs.findOne({ jobId });
        if (!row) return null;

        const job = this.rowToJob(row);
        const newLog: JobLogEntry = {
            timestamp: Date.now(),
            level: 'info',
            message: `Status changed to: ${status}`
        };

        const updates: any = {
            status,
            logs: stringifyJSON([...job.logs, newLog]),
        };

        if (status === 'completed' || status === 'failed') {
            updates.completedAt = Date.now();
        }

        if (data?.result) updates.result = stringifyJSON(data.result);
        if (data?.error) updates.error = data.error;
        if (data?.awaitingCallbackType) updates.awaitingCallbackType = data.awaitingCallbackType;
        if (data?.awaitingCallbackData) updates.awaitingCallbackData = stringifyJSON(data.awaitingCallbackData);

        db.jobs.update({ jobId }, updates);

        const updatedJob: JobData = {
            ...job,
            status,
            ...data,
            logs: [...job.logs, newLog],
            completedAt: updates.completedAt,
        };

        this.broadcastChannel.postMessage(updatedJob);
        this.notifyHandlers(updatedJob);

        return updatedJob;
    }

    /** Add a log entry to a job */
    log(jobId: string, level: JobLogEntry['level'], message: string, data?: any): void {
        const db = getDatabase();
        const row = db.jobs.findOne({ jobId });
        if (!row) return;

        const job = this.rowToJob(row);
        const newLog: JobLogEntry = { timestamp: Date.now(), level, message, data };

        db.jobs.update({ jobId }, {
            logs: stringifyJSON([...job.logs, newLog])
        });
    }

    /** Pause job to await callback */
    awaitCallback(jobId: string, callbackType: string, callbackData?: any): JobData | null {
        return this.updateStatus(jobId, 'awaiting_callback', {
            awaitingCallbackType: callbackType,
            awaitingCallbackData: callbackData
        });
    }

    /** Resume job after callback received */
    resumeWithCallback(jobId: string, callbackResult: any): JobData | null {
        const db = getDatabase();
        const row = db.jobs.findOne({ jobId });
        if (!row || row.status !== 'awaiting_callback') return null;

        this.log(jobId, 'info', `Callback received: ${row.awaitingCallbackType}`, callbackResult);

        db.jobs.update({ jobId }, {
            awaitingCallbackType: undefined,
            awaitingCallbackData: undefined
        });

        return this.updateStatus(jobId, 'processing');
    }

    /** Complete job with result */
    complete(jobId: string, result: any): JobData | null {
        return this.updateStatus(jobId, 'completed', { result });
    }

    /** Fail job with error */
    fail(jobId: string, error: string): JobData | null {
        return this.updateStatus(jobId, 'failed', { error });
    }

    /** Get jobs for a specific message */
    getByMessage(messageId: string): JobData[] {
        const db = getDatabase();
        const rows = db.jobs.find({ messageId });
        return rows.map(row => this.rowToJob(row));
    }

    /** Get jobs by message (sync for SSR) */
    getByMessageSync(messageId: string): JobData[] {
        return this.getByMessage(messageId);
    }

    /** Get jobs for a specific agent */
    getByAgent(agentId: string, limit: number = 50): JobData[] {
        const db = getDatabase();
        const rows = db.jobs.findMany({
            where: { agentId },
            orderBy: { startedAt: 'desc' },
            take: limit
        });
        return rows.map(row => this.rowToJob(row)).reverse();
    }

    /** Get recent jobs */
    getRecent(limit: number = 100): JobData[] {
        const db = getDatabase();
        const rows = db.jobs.findMany({
            orderBy: { startedAt: 'desc' },
            take: limit
        });
        return rows.map(row => this.rowToJob(row)).reverse();
    }

    /** Get recent jobs (sync for SSR) */
    getRecentSync(limit: number = 100): JobData[] {
        return this.getRecent(limit);
    }

    /** Get jobs awaiting callback */
    getAwaitingCallback(): JobData[] {
        const db = getDatabase();
        const rows = db.jobs.find({ status: 'awaiting_callback' });
        return rows.map(row => this.rowToJob(row));
    }

    /** Subscribe to job updates */
    subscribe(handler: JobUpdateHandler): () => void {
        this.handlers.add(handler);
        return () => this.handlers.delete(handler);
    }

    private notifyHandlers(job: JobData): void {
        for (const handler of this.handlers) {
            try {
                handler(job);
            } catch (e) {
                console.error('Job handler error:', e);
            }
        }
    }

    /** Convert DB row to JobData */
    private rowToJob(row: any): JobData {
        return {
            id: row.jobId,
            messageId: row.messageId,
            agentId: row.agentId,
            agentName: row.agentName,
            agentEmoji: row.agentEmoji,
            status: row.status as JobStatus,
            decision: row.decision as JobData['decision'],
            reason: row.reason,
            result: row.result ? parseJSON(row.result, null) : undefined,
            error: row.error,
            awaitingCallbackType: row.awaitingCallbackType,
            awaitingCallbackData: row.awaitingCallbackData ? parseJSON(row.awaitingCallbackData, null) : undefined,
            startedAt: row.startedAt,
            completedAt: row.completedAt,
            logs: parseJSON(row.logs, []),
        };
    }

    close(): void {
        this.broadcastChannel.close();
    }
}
