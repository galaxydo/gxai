/**
 * Onboarding API - Manages user onboarding flow
 */
import { getOnboardingManager, AVAILABLE_AGENTS } from '../../../core/onboarding';

export async function GET() {
    const manager = getOnboardingManager();
    let state = manager.getState();

    // Start onboarding if not started
    if (!state) {
        state = manager.startOnboarding();
    }

    return Response.json({
        state,
        availableAgents: AVAILABLE_AGENTS,
    });
}

export async function POST(req: Request) {
    const manager = getOnboardingManager();
    const body = await req.json();
    const { action, data } = body;

    switch (action) {
        case 'start':
            const newState = manager.startOnboarding();
            return Response.json({ state: newState });

        case 'next':
            const nextState = manager.nextStep();
            return Response.json({ state: nextState });

        case 'back':
            const prevState = manager.previousStep();
            return Response.json({ state: prevState });

        case 'update':
            const updatedState = manager.updateState(data);
            return Response.json({ state: updatedState });

        case 'select-messaging':
            manager.updateState({
                messagingMethod: data.method,
                currentStep: 'configure-messaging'
            });
            return Response.json({ state: manager.getState() });

        case 'configure-messaging':
            manager.updateState({
                messagingConfig: data.config,
            });
            return Response.json({ state: manager.getState() });

        case 'verify-messaging':
            // TODO: Actually verify the messaging connection
            manager.updateState({
                messagingConfig: { ...manager.getState()?.messagingConfig, verified: true },
                currentStep: 'select-admin'
            });
            return Response.json({ state: manager.getState() });

        case 'select-admin':
            manager.updateState({
                adminUserId: data.userId,
                adminUsername: data.username,
                currentStep: 'select-agents'
            });
            return Response.json({ state: manager.getState() });

        case 'select-agents':
            manager.updateState({
                selectedAgents: data.agents,
                currentStep: 'complete',
                completedAt: Date.now()
            });
            return Response.json({ state: manager.getState() });

        case 'reset':
            manager.reset();
            return Response.json({ state: null });

        default:
            return Response.json({ error: 'Unknown action' }, { status: 400 });
    }
}
