/**
 * Auth Connect API - Initialize Telegram connection
 */

import { getAuthManager } from '../../../../../core/auth-manager';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { phoneNumber } = body;

        if (!phoneNumber) {
            return Response.json(
                { error: 'Phone number is required' },
                { status: 400 }
            );
        }

        const authManager = getAuthManager();
        const auth = authManager.initAuth(phoneNumber);

        // In a real implementation, this would:
        // 1. Use gramjs or telegram client to send verification code
        // 2. Return pending status and await verification

        // For now, simulate immediate connection
        const connected = authManager.completeAuth({
            sessionString: 'mock_session_' + Date.now(),
            userId: 'user_' + phoneNumber.slice(-4),
            username: 'demo_user',
            firstName: 'Demo',
        });

        return Response.json({
            success: true,
            status: connected.status,
            message: 'Connected successfully',
        });
    } catch (error: any) {
        return Response.json(
            { error: error.message },
            { status: 500 }
        );
    }
}
