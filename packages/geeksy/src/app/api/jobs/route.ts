/**
 * Jobs API - Manage agent processing jobs
 */
import { getJobManager } from '../../../server';

export async function GET(req: Request) {
    const jobs = getJobManager();
    const url = new URL(req.url);
    const messageId = url.searchParams.get('messageId');
    const agentId = url.searchParams.get('agentId');

    if (messageId) {
        return Response.json(await jobs.getByMessage(messageId));
    }

    if (agentId) {
        return Response.json(await jobs.getByAgent(agentId));
    }

    return Response.json(await jobs.getRecent(100));
}

export async function POST(req: Request) {
    const jobs = getJobManager();
    const body = await req.json();
    const { action, ...data } = body;

    if (action === 'create') {
        const { messageId, agentId, agentName, agentEmoji, decision, reason } = data;

        if (!messageId || !agentId || !decision || !reason) {
            return Response.json(
                { error: 'messageId, agentId, decision, and reason are required' },
                { status: 400 }
            );
        }

        const job = await jobs.createJob(
            messageId,
            agentId,
            agentName || agentId,
            agentEmoji || '🤖',
            decision,
            reason
        );

        return Response.json(job);
    }

    if (action === 'update') {
        const { jobId, status, result, error } = data;

        if (!jobId) {
            return Response.json({ error: 'jobId is required' }, { status: 400 });
        }

        const job = await jobs.updateStatus(jobId, status, { result, error });
        return Response.json(job);
    }

    if (action === 'complete') {
        const { jobId, result } = data;
        const job = await jobs.complete(jobId, result);
        return Response.json(job);
    }

    if (action === 'fail') {
        const { jobId, error } = data;
        const job = await jobs.fail(jobId, error);
        return Response.json(job);
    }

    if (action === 'await_callback') {
        const { jobId, callbackType, callbackData } = data;
        const job = await jobs.awaitCallback(jobId, callbackType, callbackData);
        return Response.json(job);
    }

    if (action === 'resume') {
        const { jobId, callbackResult } = data;
        const job = await jobs.resumeWithCallback(jobId, callbackResult);
        return Response.json(job);
    }

    if (action === 'log') {
        const { jobId, level, message, logData } = data;
        await jobs.log(jobId, level || 'info', message, logData);
        return Response.json({ success: true });
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 });
}
