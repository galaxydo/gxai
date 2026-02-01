/**
 * Auth Manager - Handles Telegram account authentication
 * 
 * Manages the connection state for our assistant's Telegram account
 */

import { getNewDatabase, generateId, type Auth } from './schemas';

export interface AuthStatus {
    connected: boolean;
    type?: string;
    phoneNumber?: string;
    username?: string;
    firstName?: string;
    lastConnectedAt?: number;
}

export class AuthManager {
    private db = getNewDatabase();

    /** Get current auth status */
    getStatus(): AuthStatus {
        const auth = this.db.auth.findOne({ authId: 'main' });

        if (!auth || auth.status !== 'connected') {
            return { connected: false };
        }

        return {
            connected: true,
            type: auth.type,
            phoneNumber: auth.phoneNumber,
            username: auth.username,
            firstName: auth.firstName,
            lastConnectedAt: auth.lastConnectedAt,
        };
    }

    /** Get full auth record */
    getAuth(): Auth | null {
        return this.db.auth.findOne({ authId: 'main' }) || null;
    }

    /** Initialize auth with phone number (pending state) */
    initAuth(phoneNumber: string): Auth {
        const existing = this.db.auth.findOne({ authId: 'main' });
        const now = Date.now();

        if (existing) {
            this.db.auth.update({ authId: 'main' }, {
                phoneNumber,
                status: 'pending',
                updatedAt: now,
            });
            return this.db.auth.findOne({ authId: 'main' })!;
        }

        this.db.auth.insert({
            authId: 'main',
            type: 'telegram-account',
            status: 'pending',
            phoneNumber,
            createdAt: now,
            updatedAt: now,
        });

        return this.db.auth.findOne({ authId: 'main' })!;
    }

    /** Complete auth with verification (connected state) */
    completeAuth(data: {
        sessionString: string;
        userId: string;
        username?: string;
        firstName?: string;
    }): Auth {
        const now = Date.now();
        const auth = this.db.auth.findOne({ authId: 'main' });

        if (!auth) {
            throw new Error('No pending auth to complete');
        }

        this.db.auth.update({ authId: 'main' }, {
            status: 'connected',
            sessionString: data.sessionString,
            userId: data.userId,
            username: data.username,
            firstName: data.firstName,
            lastConnectedAt: now,
            updatedAt: now,
        });

        console.log(`✅ Auth completed for ${data.username || data.userId}`);
        return this.db.auth.findOne({ authId: 'main' })!;
    }

    /** Disconnect and clear auth */
    disconnect(): void {
        const auth = this.db.auth.findOne({ authId: 'main' });
        if (auth) {
            this.db.auth.update({ authId: 'main' }, {
                status: 'disconnected',
                sessionString: undefined,
                updatedAt: Date.now(),
            });
            console.log('🔌 Auth disconnected');
        }
    }

    /** Check if we're connected */
    isConnected(): boolean {
        const auth = this.db.auth.findOne({ authId: 'main' });
        return auth?.status === 'connected';
    }
}

let authManager: AuthManager | null = null;

export function getAuthManager(): AuthManager {
    if (!authManager) {
        authManager = new AuthManager();
    }
    return authManager;
}
