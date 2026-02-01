/**
 * Jobs Stats API - Get job execution statistics
 */

import { getJobExecutor } from '../../../../../core/job-executor';

export function GET() {
    const jobExecutor = getJobExecutor();
    const stats = jobExecutor.getStats();

    return Response.json(stats);
}
