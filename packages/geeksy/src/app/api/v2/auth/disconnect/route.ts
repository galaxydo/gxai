/**
 * Auth Disconnect API - Disconnect Telegram
 */

import { getAuthManager } from '../../../../../core/auth-manager';

export async function POST() {
    try {
        const authManager = getAuthManager();
        authManager.disconnect();

        return Response.json({
            success: true,
            message: 'Disconnected successfully',
        });
    } catch (error: any) {
        return Response.json(
            { error: error.message },
            { status: 500 }
        );
    }
}
