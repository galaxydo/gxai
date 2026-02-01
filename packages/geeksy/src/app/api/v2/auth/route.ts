/**
 * Auth API - Get auth status
 */

import { getAuthManager } from '../../../../core/auth-manager';

export function GET() {
    const authManager = getAuthManager();
    const status = authManager.getStatus();

    return Response.json(status);
}
