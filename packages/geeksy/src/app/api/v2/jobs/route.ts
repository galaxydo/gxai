/**
 * Jobs API - Get job executions
 */

import { getJobExecutor } from '../../../../core/job-executor';

export function GET(request: Request) {
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const agentId = url.searchParams.get('agentId');
    const contactId = url.searchParams.get('contactId');

    const jobExecutor = getJobExecutor();

    let jobs;
    if (agentId) {
        jobs = jobExecutor.getAgentJobs(agentId, limit);
    } else if (contactId) {
        jobs = jobExecutor.getContactJobs(contactId, limit);
    } else {
        jobs = jobExecutor.getRecentJobs(limit);
    }

    return Response.json(jobs);
}
