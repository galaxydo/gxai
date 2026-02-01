/**
 * Onboarding State - Manages user onboarding progress
 */

import { getDatabase, generateId, stringifyJSON, parseJSON } from './database';

export type OnboardingStep =
    | 'welcome'
    | 'select-messaging'
    | 'configure-messaging'
    | 'verify-messaging'
    | 'select-admin'
    | 'select-agents'
    | 'complete';

export type MessagingMethod =
    | 'telegram-account'
    | 'telegram-bot'
    | 'twitter-api'
    | 'discord';

export interface OnboardingState {
    id: string;
    currentStep: OnboardingStep;
    messagingMethod?: MessagingMethod;
    messagingConfig?: {
        // Telegram Account
        phoneNumber?: string;
        sessionString?: string;
        verified?: boolean;
        // Telegram Bot
        botToken?: string;
        // Twitter
        apiKey?: string;
        apiSecret?: string;
        accessToken?: string;
        accessTokenSecret?: string;
        // Discord
        discordToken?: string;
    };
    adminUserId?: string;
    adminUsername?: string;
    contacts?: Array<{
        id: string;
        name: string;
        username?: string;
        isAdmin: boolean;
    }>;
    selectedAgents: string[];
    completedAt?: number;
    createdAt: number;
    updatedAt: number;
}

// Default agents available during onboarding
export const AVAILABLE_AGENTS = [
    {
        id: 'agent-builder',
        name: 'Simple Agent Builder',
        emoji: '🛠️',
        description: 'Creates new agents based on your instructions. Great for adding custom capabilities.',
        enabled: true,
        default: true,
    },
    {
        id: 'media-generator',
        name: 'Media Generator',
        emoji: '🎨',
        description: 'Generates images, videos, and other media content on demand.',
        enabled: true,
        default: true,
    },
    {
        id: 'personal-assistant',
        name: 'Personal Assistant',
        emoji: '📋',
        description: 'Manages your tasks, calendar, and reminders. Helps organize your day.',
        enabled: true,
        default: true,
    },
    {
        id: 'browser-explorer',
        name: 'Browser Explorer',
        emoji: '🌐',
        description: 'Browses the web, extracts data, and automates web tasks. Requires browser extension.',
        enabled: false,
        requiresExtension: true,
        default: false,
    },
];

export class OnboardingManager {
    private stateId: string = 'main';

    constructor() { }

    /** Get the current onboarding state */
    getState(): OnboardingState | null {
        const db = getDatabase();
        const row = db.onboarding?.findOne({ stateId: this.stateId });
        if (!row) return null;
        return this.rowToState(row);
    }

    /** Start a new onboarding session */
    startOnboarding(): OnboardingState {
        const db = getDatabase();
        const existing = this.getState();

        if (existing && existing.currentStep !== 'complete') {
            return existing;
        }

        const state: OnboardingState = {
            id: this.stateId,
            currentStep: 'welcome',
            selectedAgents: ['agent-builder', 'media-generator', 'personal-assistant'],
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };

        // Check if table exists, create if not
        try {
            db.onboarding?.delete({ stateId: this.stateId });
        } catch { }

        db.onboarding?.insert({
            stateId: state.id,
            currentStep: state.currentStep,
            selectedAgents: stringifyJSON(state.selectedAgents),
            createdAt: state.createdAt,
            updatedAt: state.updatedAt,
        });

        return state;
    }

    /** Update onboarding state */
    updateState(updates: Partial<OnboardingState>): OnboardingState | null {
        const db = getDatabase();
        const current = this.getState();
        if (!current) return null;

        const updateData: any = {
            updatedAt: Date.now(),
        };

        if (updates.currentStep) updateData.currentStep = updates.currentStep;
        if (updates.messagingMethod) updateData.messagingMethod = updates.messagingMethod;
        if (updates.messagingConfig) updateData.messagingConfig = stringifyJSON(updates.messagingConfig);
        if (updates.adminUserId) updateData.adminUserId = updates.adminUserId;
        if (updates.adminUsername) updateData.adminUsername = updates.adminUsername;
        if (updates.contacts) updateData.contacts = stringifyJSON(updates.contacts);
        if (updates.selectedAgents) updateData.selectedAgents = stringifyJSON(updates.selectedAgents);
        if (updates.completedAt) updateData.completedAt = updates.completedAt;

        db.onboarding?.update({ stateId: this.stateId }, updateData);

        return this.getState();
    }

    /** Move to next step */
    nextStep(): OnboardingState | null {
        const state = this.getState();
        if (!state) return null;

        const steps: OnboardingStep[] = [
            'welcome',
            'select-messaging',
            'configure-messaging',
            'verify-messaging',
            'select-admin',
            'select-agents',
            'complete'
        ];

        const currentIndex = steps.indexOf(state.currentStep);
        if (currentIndex === -1 || currentIndex >= steps.length - 1) {
            return state;
        }

        return this.updateState({
            currentStep: steps[currentIndex + 1],
            completedAt: steps[currentIndex + 1] === 'complete' ? Date.now() : undefined
        });
    }

    /** Go back to previous step */
    previousStep(): OnboardingState | null {
        const state = this.getState();
        if (!state) return null;

        const steps: OnboardingStep[] = [
            'welcome',
            'select-messaging',
            'configure-messaging',
            'verify-messaging',
            'select-admin',
            'select-agents',
            'complete'
        ];

        const currentIndex = steps.indexOf(state.currentStep);
        if (currentIndex <= 0) {
            return state;
        }

        return this.updateState({ currentStep: steps[currentIndex - 1] });
    }

    /** Check if onboarding is complete */
    isComplete(): boolean {
        const state = this.getState();
        return state?.currentStep === 'complete';
    }

    /** Reset onboarding */
    reset(): void {
        const db = getDatabase();
        db.onboarding?.delete({ stateId: this.stateId });
    }

    private rowToState(row: any): OnboardingState {
        return {
            id: row.stateId,
            currentStep: row.currentStep as OnboardingStep,
            messagingMethod: row.messagingMethod as MessagingMethod | undefined,
            messagingConfig: row.messagingConfig ? parseJSON(row.messagingConfig, undefined) : undefined,
            adminUserId: row.adminUserId,
            adminUsername: row.adminUsername,
            contacts: row.contacts ? parseJSON(row.contacts, []) : undefined,
            selectedAgents: parseJSON(row.selectedAgents, []),
            completedAt: row.completedAt,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
        };
    }
}

// Singleton instance
let onboardingManager: OnboardingManager;

export function getOnboardingManager(): OnboardingManager {
    if (!onboardingManager) {
        onboardingManager = new OnboardingManager();
    }
    return onboardingManager;
}
