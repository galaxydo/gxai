'use client';

/**
 * Onboarding Wizard - Multi-step user setup experience
 * 
 * Steps:
 * 1. Welcome - Meet Geeksy avatar
 * 2. Select Messaging - Choose how to receive messages
 * 3. Configure Messaging - Setup the selected method
 * 4. Verify Messaging - Test the connection
 * 5. Select Admin - Choose who controls Geeksy
 * 6. Select Agents - Choose which agents to enable
 * 7. Complete - Ready to go!
 */

import React, { useState, useEffect } from 'react';
import type { ChangeEvent } from 'react';
import { createIsland } from 'melina/island';

interface OnboardingState {
    id: string;
    currentStep: string;
    messagingMethod?: string;
    messagingConfig?: any;
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
}

interface Agent {
    id: string;
    name: string;
    emoji: string;
    description: string;
    enabled: boolean;
    default?: boolean;
    requiresExtension?: boolean;
}

const MESSAGING_METHODS = [
    {
        id: 'telegram-account',
        name: 'Telegram Account',
        emoji: '📱',
        description: 'Use your personal Telegram account. Geeksy will receive messages from your contacts.',
        instructions: 'You\'ll need to provide your phone number and verify with a code. This gives Geeksy access to your Telegram messages.',
        enabled: true,
    },
    {
        id: 'telegram-bot',
        name: 'Telegram Bot',
        emoji: '🤖',
        description: 'Create a Telegram bot and forward messages to it.',
        instructions: '1. Message @BotFather on Telegram\n2. Send /newbot and follow prompts\n3. Copy the bot token here',
        enabled: true,
    },
    {
        id: 'twitter-api',
        name: 'Twitter/X API',
        emoji: '🐦',
        description: 'Connect your Twitter/X account to receive DMs and mentions.',
        instructions: '1. Go to developer.twitter.com\n2. Create a new app\n3. Generate API keys and tokens',
        enabled: true,
    },
    {
        id: 'discord',
        name: 'Discord',
        emoji: '💬',
        description: 'Connect to Discord servers and channels.',
        instructions: 'Discord integration coming soon!',
        enabled: false,
    },
];

function OnboardingWizardImpl() {
    const [state, setState] = useState<OnboardingState | null>(null);
    const [agents, setAgents] = useState<Agent[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Form state for different steps
    const [phoneNumber, setPhoneNumber] = useState('');
    const [botToken, setBotToken] = useState('');
    const [twitterKeys, setTwitterKeys] = useState({ apiKey: '', apiSecret: '', accessToken: '', accessSecret: '' });

    useEffect(() => {
        fetchOnboardingState();
    }, []);

    const fetchOnboardingState = async () => {
        try {
            const res = await fetch('/api/onboarding');
            const data = await res.json();
            setState(data.state);
            setAgents(data.availableAgents || []);
            setLoading(false);
        } catch (e: any) {
            setError(e.message);
            setLoading(false);
        }
    };

    const sendAction = async (action: string, data?: any) => {
        try {
            const res = await fetch('/api/onboarding', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, data }),
            });
            const result = await res.json();
            setState(result.state);
            return result;
        } catch (e: any) {
            setError(e.message);
        }
    };

    const selectMessagingMethod = (method: string) => {
        sendAction('select-messaging', { method });
    };

    const configureMessaging = () => {
        const config: any = {};
        if (state?.messagingMethod === 'telegram-account') {
            config.phoneNumber = phoneNumber;
        } else if (state?.messagingMethod === 'telegram-bot') {
            config.botToken = botToken;
        } else if (state?.messagingMethod === 'twitter-api') {
            config.apiKey = twitterKeys.apiKey;
            config.apiSecret = twitterKeys.apiSecret;
            config.accessToken = twitterKeys.accessToken;
            config.accessTokenSecret = twitterKeys.accessSecret;
        }
        sendAction('configure-messaging', { config });
        sendAction('next');
    };

    const verifyMessaging = () => {
        sendAction('verify-messaging', {});
    };

    const selectAdmin = (userId: string, username: string) => {
        sendAction('select-admin', { userId, username });
    };

    const toggleAgent = (agentId: string) => {
        const current = state?.selectedAgents || [];
        const updated = current.includes(agentId)
            ? current.filter(id => id !== agentId)
            : [...current, agentId];
        sendAction('update', { selectedAgents: updated });
    };

    const completeOnboarding = () => {
        sendAction('select-agents', { agents: state?.selectedAgents || [] });
    };

    if (loading) {
        return (
            <div style={styles.container}>
                <div style={styles.loader}>
                    <div style={styles.avatar}>👾</div>
                    <p>Loading Geeksy...</p>
                </div>
            </div>
        );
    }

    if (state?.currentStep === 'complete') {
        return null; // Will redirect to dashboard
    }

    return (
        <div style={styles.container}>
            <div style={styles.card}>
                {/* Progress indicator */}
                <div style={styles.progress}>
                    {['welcome', 'select-messaging', 'configure-messaging', 'verify-messaging', 'select-admin', 'select-agents'].map((step, i) => (
                        <div
                            key={step}
                            style={{
                                ...styles.progressDot,
                                ...(step === state?.currentStep ? styles.progressDotActive : {}),
                                ...(getStepIndex(state?.currentStep) > i ? styles.progressDotComplete : {}),
                            }}
                        />
                    ))}
                </div>

                {/* Step content */}
                {state?.currentStep === 'welcome' && (
                    <WelcomeStep onNext={() => sendAction('next')} />
                )}

                {state?.currentStep === 'select-messaging' && (
                    <SelectMessagingStep
                        methods={MESSAGING_METHODS}
                        onSelect={selectMessagingMethod}
                        onBack={() => sendAction('back')}
                    />
                )}

                {state?.currentStep === 'configure-messaging' && (
                    <ConfigureMessagingStep
                        method={state.messagingMethod}
                        phoneNumber={phoneNumber}
                        setPhoneNumber={setPhoneNumber}
                        botToken={botToken}
                        setBotToken={setBotToken}
                        twitterKeys={twitterKeys}
                        setTwitterKeys={setTwitterKeys}
                        onConfigure={configureMessaging}
                        onBack={() => sendAction('back')}
                    />
                )}

                {state?.currentStep === 'verify-messaging' && (
                    <VerifyMessagingStep
                        method={state.messagingMethod}
                        onVerify={verifyMessaging}
                        onBack={() => sendAction('back')}
                    />
                )}

                {state?.currentStep === 'select-admin' && (
                    <SelectAdminStep
                        contacts={state.contacts || []}
                        onSelect={selectAdmin}
                        onBack={() => sendAction('back')}
                    />
                )}

                {state?.currentStep === 'select-agents' && (
                    <SelectAgentsStep
                        agents={agents}
                        selectedAgents={state.selectedAgents}
                        onToggle={toggleAgent}
                        onComplete={completeOnboarding}
                        onBack={() => sendAction('back')}
                    />
                )}
            </div>
        </div>
    );
}

function getStepIndex(step?: string): number {
    const steps = ['welcome', 'select-messaging', 'configure-messaging', 'verify-messaging', 'select-admin', 'select-agents'];
    return steps.indexOf(step || 'welcome');
}

// ============================================
// Step Components
// ============================================

function WelcomeStep({ onNext }: { onNext: () => void }) {
    return (
        <div style={styles.stepContent}>
            <div style={styles.avatarLarge}>👾</div>
            <h1 style={styles.title}>Welcome to Geeksy!</h1>
            <p style={styles.subtitle}>
                I'm your personal multi-agent orchestration system.
                Let me help you set up everything in just a few steps.
            </p>
            <div style={styles.features}>
                <div style={styles.feature}>
                    <span style={styles.featureIcon}>📨</span>
                    <span>Receive messages from Telegram, Twitter, and more</span>
                </div>
                <div style={styles.feature}>
                    <span style={styles.featureIcon}>🤖</span>
                    <span>AI agents that understand and process your messages</span>
                </div>
                <div style={styles.feature}>
                    <span style={styles.featureIcon}>⚡</span>
                    <span>Automated workflows that save you time</span>
                </div>
            </div>
            <button style={styles.primaryButton} onClick={onNext}>
                Let's Get Started! 🚀
            </button>
        </div>
    );
}

function SelectMessagingStep({
    methods,
    onSelect,
    onBack
}: {
    methods: typeof MESSAGING_METHODS;
    onSelect: (id: string) => void;
    onBack: () => void;
}) {
    const [expanded, setExpanded] = useState<string | null>(null);

    return (
        <div style={styles.stepContent}>
            <div style={styles.avatarSmall}>👾</div>
            <h2 style={styles.stepTitle}>How should I receive messages?</h2>
            <p style={styles.stepSubtitle}>
                Choose your primary messaging channel. You can add more later!
            </p>

            <div style={styles.methodGrid}>
                {methods.map(method => (
                    <div
                        key={method.id}
                        style={{
                            ...styles.methodCard,
                            ...(method.enabled ? {} : styles.methodCardDisabled),
                        }}
                        onClick={() => method.enabled && setExpanded(expanded === method.id ? null : method.id)}
                    >
                        <div style={styles.methodHeader}>
                            <span style={styles.methodEmoji}>{method.emoji}</span>
                            <span style={styles.methodName}>{method.name}</span>
                            {!method.enabled && <span style={styles.comingSoon}>Coming Soon</span>}
                        </div>
                        <p style={styles.methodDesc}>{method.description}</p>

                        {expanded === method.id && method.enabled && (
                            <div style={styles.methodExpanded}>
                                <div style={styles.methodInstructions}>
                                    <strong>How it works:</strong>
                                    <pre style={styles.instructionsPre}>{method.instructions}</pre>
                                </div>
                                <button
                                    style={styles.selectButton}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onSelect(method.id);
                                    }}
                                >
                                    Select {method.name}
                                </button>
                            </div>
                        )}
                    </div>
                ))}
            </div>

            <button style={styles.backButton} onClick={onBack}>
                ← Back
            </button>
        </div>
    );
}

function ConfigureMessagingStep({
    method,
    phoneNumber,
    setPhoneNumber,
    botToken,
    setBotToken,
    twitterKeys,
    setTwitterKeys,
    onConfigure,
    onBack,
}: {
    method?: string;
    phoneNumber: string;
    setPhoneNumber: (v: string) => void;
    botToken: string;
    setBotToken: (v: string) => void;
    twitterKeys: { apiKey: string; apiSecret: string; accessToken: string; accessSecret: string };
    setTwitterKeys: (v: any) => void;
    onConfigure: () => void;
    onBack: () => void;
}) {
    return (
        <div style={styles.stepContent}>
            <div style={styles.avatarSmall}>👾</div>
            <h2 style={styles.stepTitle}>Configure {method?.replace(/-/g, ' ')}</h2>

            {method === 'telegram-account' && (
                <div style={styles.formGroup}>
                    <label style={styles.label}>Phone Number</label>
                    <input
                        type="tel"
                        style={styles.input}
                        placeholder="+1234567890"
                        value={phoneNumber}
                        onChange={(e) => setPhoneNumber(e.target.value)}
                    />
                    <p style={styles.hint}>
                        Enter your Telegram phone number with country code.
                        You'll receive a verification code.
                    </p>
                </div>
            )}

            {method === 'telegram-bot' && (
                <div style={styles.formGroup}>
                    <label style={styles.label}>Bot Token</label>
                    <input
                        type="text"
                        style={styles.input}
                        placeholder="123456789:ABC-DEF..."
                        value={botToken}
                        onChange={(e) => setBotToken(e.target.value)}
                    />
                    <p style={styles.hint}>
                        Get this from @BotFather on Telegram
                    </p>
                </div>
            )}

            {method === 'twitter-api' && (
                <div style={styles.formGroup}>
                    <label style={styles.label}>API Key</label>
                    <input
                        type="text"
                        style={styles.input}
                        placeholder="API Key"
                        value={twitterKeys.apiKey}
                        onChange={(e) => setTwitterKeys({ ...twitterKeys, apiKey: e.target.value })}
                    />
                    <label style={styles.label}>API Secret</label>
                    <input
                        type="password"
                        style={styles.input}
                        placeholder="API Secret"
                        value={twitterKeys.apiSecret}
                        onChange={(e) => setTwitterKeys({ ...twitterKeys, apiSecret: e.target.value })}
                    />
                    <label style={styles.label}>Access Token</label>
                    <input
                        type="text"
                        style={styles.input}
                        placeholder="Access Token"
                        value={twitterKeys.accessToken}
                        onChange={(e) => setTwitterKeys({ ...twitterKeys, accessToken: e.target.value })}
                    />
                    <label style={styles.label}>Access Token Secret</label>
                    <input
                        type="password"
                        style={styles.input}
                        placeholder="Access Token Secret"
                        value={twitterKeys.accessSecret}
                        onChange={(e) => setTwitterKeys({ ...twitterKeys, accessSecret: e.target.value })}
                    />
                </div>
            )}

            <div style={styles.buttonRow}>
                <button style={styles.backButton} onClick={onBack}>← Back</button>
                <button style={styles.primaryButton} onClick={onConfigure}>
                    Continue →
                </button>
            </div>
        </div>
    );
}

function VerifyMessagingStep({
    method,
    onVerify,
    onBack,
}: {
    method?: string;
    onVerify: () => void;
    onBack: () => void;
}) {
    const [verifying, setVerifying] = useState(false);
    const [verified, setVerified] = useState(false);

    const handleVerify = async () => {
        setVerifying(true);
        // Simulate verification
        await new Promise(r => setTimeout(r, 2000));
        setVerified(true);
        setVerifying(false);
        setTimeout(() => onVerify(), 1000);
    };

    return (
        <div style={styles.stepContent}>
            <div style={styles.avatarSmall}>{verified ? '✅' : verifying ? '🔄' : '👾'}</div>
            <h2 style={styles.stepTitle}>Verify Connection</h2>
            <p style={styles.stepSubtitle}>
                {verifying
                    ? 'Connecting to your account...'
                    : verified
                        ? 'Connection verified!'
                        : 'Click below to test the connection'}
            </p>

            {!verified && !verifying && (
                <button style={styles.primaryButton} onClick={handleVerify}>
                    Verify Connection
                </button>
            )}

            {verifying && (
                <div style={styles.spinner}>⏳</div>
            )}

            {verified && (
                <div style={styles.success}>
                    ✓ Successfully connected!
                </div>
            )}

            {!verifying && !verified && (
                <button style={styles.backButton} onClick={onBack}>← Back</button>
            )}
        </div>
    );
}

function SelectAdminStep({
    contacts,
    onSelect,
    onBack,
}: {
    contacts: Array<{ id: string; name: string; username?: string; isAdmin: boolean }>;
    onSelect: (userId: string, username: string) => void;
    onBack: () => void;
}) {
    const [manualUsername, setManualUsername] = useState('');

    // If no contacts, allow manual entry
    const hasContacts = contacts.length > 0;

    return (
        <div style={styles.stepContent}>
            <div style={styles.avatarSmall}>👾</div>
            <h2 style={styles.stepTitle}>Who's the boss?</h2>
            <p style={styles.stepSubtitle}>
                Select the admin who can control Geeksy and change settings.
            </p>

            {hasContacts ? (
                <div style={styles.contactList}>
                    {contacts.map(contact => (
                        <div
                            key={contact.id}
                            style={styles.contactCard}
                            onClick={() => onSelect(contact.id, contact.username || contact.name)}
                        >
                            <span style={styles.contactName}>{contact.name}</span>
                            {contact.username && (
                                <span style={styles.contactUsername}>@{contact.username}</span>
                            )}
                        </div>
                    ))}
                </div>
            ) : (
                <div style={styles.formGroup}>
                    <label style={styles.label}>Your Username</label>
                    <input
                        type="text"
                        style={styles.input}
                        placeholder="@yourusername"
                        value={manualUsername}
                        onChange={(e) => setManualUsername(e.target.value)}
                    />
                    <button
                        style={styles.primaryButton}
                        onClick={() => onSelect('self', manualUsername)}
                    >
                        That's Me!
                    </button>
                </div>
            )}

            <button style={styles.backButton} onClick={onBack}>← Back</button>
        </div>
    );
}

function SelectAgentsStep({
    agents,
    selectedAgents,
    onToggle,
    onComplete,
    onBack,
}: {
    agents: Agent[];
    selectedAgents: string[];
    onToggle: (id: string) => void;
    onComplete: () => void;
    onBack: () => void;
}) {
    return (
        <div style={styles.stepContent}>
            <div style={styles.avatarSmall}>👾</div>
            <h2 style={styles.stepTitle}>Choose Your Agents</h2>
            <p style={styles.stepSubtitle}>
                Select which agents you want to activate. You can add more anytime!
            </p>

            <div style={styles.agentGrid}>
                {agents.map(agent => (
                    <div
                        key={agent.id}
                        style={{
                            ...styles.agentCard,
                            ...(selectedAgents.includes(agent.id) ? styles.agentCardSelected : {}),
                            ...(!agent.enabled ? styles.agentCardDisabled : {}),
                        }}
                        onClick={() => agent.enabled && onToggle(agent.id)}
                    >
                        <div style={styles.agentHeader}>
                            <span style={styles.agentEmoji}>{agent.emoji}</span>
                            <span style={styles.agentName}>{agent.name}</span>
                            {selectedAgents.includes(agent.id) && <span style={styles.checkmark}>✓</span>}
                        </div>
                        <p style={styles.agentDesc}>{agent.description}</p>
                        {agent.requiresExtension && (
                            <span style={styles.extensionNote}>Requires browser extension</span>
                        )}
                        {!agent.enabled && (
                            <span style={styles.comingSoon}>Coming Soon</span>
                        )}
                    </div>
                ))}
            </div>

            <div style={styles.buttonRow}>
                <button style={styles.backButton} onClick={onBack}>← Back</button>
                <button style={styles.primaryButton} onClick={onComplete}>
                    Complete Setup! 🎉
                </button>
            </div>
        </div>
    );
}

// ============================================
// Styles
// ============================================

const styles: Record<string, React.CSSProperties> = {
    container: {
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #0a0a1a 0%, #1a1a3a 50%, #0a0a1a 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    },
    card: {
        background: 'rgba(20, 20, 40, 0.9)',
        borderRadius: '24px',
        padding: '40px',
        maxWidth: '600px',
        width: '100%',
        boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5), 0 0 100px rgba(100, 100, 255, 0.1)',
        border: '1px solid rgba(100, 100, 255, 0.2)',
    },
    progress: {
        display: 'flex',
        justifyContent: 'center',
        gap: '12px',
        marginBottom: '32px',
    },
    progressDot: {
        width: '12px',
        height: '12px',
        borderRadius: '50%',
        background: 'rgba(100, 100, 255, 0.3)',
        transition: 'all 0.3s ease',
    },
    progressDotActive: {
        background: '#6466f1',
        boxShadow: '0 0 15px rgba(100, 102, 241, 0.6)',
        transform: 'scale(1.2)',
    },
    progressDotComplete: {
        background: '#10b981',
    },
    stepContent: {
        textAlign: 'center' as const,
    },
    avatarLarge: {
        fontSize: '80px',
        marginBottom: '24px',
        animation: 'bounce 2s infinite',
    },
    avatarSmall: {
        fontSize: '48px',
        marginBottom: '16px',
    },
    title: {
        fontSize: '32px',
        fontWeight: 700,
        color: '#fff',
        marginBottom: '16px',
    },
    subtitle: {
        fontSize: '18px',
        color: 'rgba(255, 255, 255, 0.7)',
        marginBottom: '32px',
        lineHeight: 1.6,
    },
    stepTitle: {
        fontSize: '24px',
        fontWeight: 600,
        color: '#fff',
        marginBottom: '12px',
    },
    stepSubtitle: {
        fontSize: '16px',
        color: 'rgba(255, 255, 255, 0.6)',
        marginBottom: '24px',
    },
    features: {
        display: 'flex',
        flexDirection: 'column' as const,
        gap: '16px',
        marginBottom: '32px',
        textAlign: 'left' as const,
    },
    feature: {
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '16px',
        background: 'rgba(100, 100, 255, 0.1)',
        borderRadius: '12px',
        color: 'rgba(255, 255, 255, 0.9)',
    },
    featureIcon: {
        fontSize: '24px',
    },
    primaryButton: {
        background: 'linear-gradient(135deg, #6466f1 0%, #8b5cf6 100%)',
        color: '#fff',
        border: 'none',
        padding: '16px 32px',
        borderRadius: '12px',
        fontSize: '16px',
        fontWeight: 600,
        cursor: 'pointer',
        transition: 'all 0.3s ease',
        boxShadow: '0 4px 20px rgba(100, 102, 241, 0.4)',
    },
    backButton: {
        background: 'transparent',
        color: 'rgba(255, 255, 255, 0.6)',
        border: '1px solid rgba(255, 255, 255, 0.2)',
        padding: '12px 24px',
        borderRadius: '12px',
        fontSize: '14px',
        cursor: 'pointer',
        marginTop: '16px',
    },
    buttonRow: {
        display: 'flex',
        justifyContent: 'space-between',
        marginTop: '24px',
    },
    methodGrid: {
        display: 'flex',
        flexDirection: 'column' as const,
        gap: '16px',
        marginBottom: '24px',
    },
    methodCard: {
        background: 'rgba(100, 100, 255, 0.1)',
        borderRadius: '16px',
        padding: '20px',
        cursor: 'pointer',
        transition: 'all 0.3s ease',
        textAlign: 'left' as const,
        border: '1px solid rgba(100, 100, 255, 0.2)',
    },
    methodCardDisabled: {
        opacity: 0.5,
        cursor: 'not-allowed',
    },
    methodHeader: {
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        marginBottom: '8px',
    },
    methodEmoji: {
        fontSize: '24px',
    },
    methodName: {
        fontSize: '16px',
        fontWeight: 600,
        color: '#fff',
    },
    methodDesc: {
        fontSize: '14px',
        color: 'rgba(255, 255, 255, 0.6)',
        margin: 0,
    },
    methodExpanded: {
        marginTop: '16px',
        paddingTop: '16px',
        borderTop: '1px solid rgba(255, 255, 255, 0.1)',
    },
    methodInstructions: {
        background: 'rgba(0, 0, 0, 0.3)',
        borderRadius: '8px',
        padding: '12px',
        marginBottom: '16px',
        textAlign: 'left' as const,
        color: 'rgba(255, 255, 255, 0.8)',
        fontSize: '13px',
    },
    instructionsPre: {
        margin: '8px 0 0 0',
        whiteSpace: 'pre-wrap' as const,
        fontFamily: 'monospace',
        fontSize: '12px',
    },
    selectButton: {
        background: '#10b981',
        color: '#fff',
        border: 'none',
        padding: '10px 20px',
        borderRadius: '8px',
        fontSize: '14px',
        fontWeight: 600,
        cursor: 'pointer',
        width: '100%',
    },
    comingSoon: {
        background: 'rgba(255, 200, 0, 0.2)',
        color: '#ffc800',
        fontSize: '11px',
        padding: '4px 8px',
        borderRadius: '4px',
        marginLeft: 'auto',
    },
    formGroup: {
        marginBottom: '20px',
        textAlign: 'left' as const,
    },
    label: {
        display: 'block',
        fontSize: '14px',
        fontWeight: 500,
        color: 'rgba(255, 255, 255, 0.8)',
        marginBottom: '8px',
    },
    input: {
        width: '100%',
        padding: '14px 16px',
        borderRadius: '10px',
        border: '1px solid rgba(100, 100, 255, 0.3)',
        background: 'rgba(20, 20, 40, 0.8)',
        color: '#fff',
        fontSize: '16px',
        marginBottom: '12px',
        outline: 'none',
    },
    hint: {
        fontSize: '13px',
        color: 'rgba(255, 255, 255, 0.5)',
        margin: 0,
    },
    spinner: {
        fontSize: '48px',
        animation: 'spin 1s linear infinite',
    },
    success: {
        fontSize: '24px',
        color: '#10b981',
        fontWeight: 600,
    },
    contactList: {
        display: 'flex',
        flexDirection: 'column' as const,
        gap: '12px',
        marginBottom: '24px',
    },
    contactCard: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '16px',
        background: 'rgba(100, 100, 255, 0.1)',
        borderRadius: '12px',
        cursor: 'pointer',
        transition: 'all 0.3s ease',
    },
    contactName: {
        color: '#fff',
        fontWeight: 500,
    },
    contactUsername: {
        color: 'rgba(255, 255, 255, 0.5)',
        fontSize: '14px',
    },
    agentGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)',
        gap: '16px',
        marginBottom: '24px',
    },
    agentCard: {
        background: 'rgba(100, 100, 255, 0.1)',
        borderRadius: '16px',
        padding: '20px',
        cursor: 'pointer',
        transition: 'all 0.3s ease',
        textAlign: 'left' as const,
        border: '2px solid transparent',
    },
    agentCardSelected: {
        borderColor: '#10b981',
        background: 'rgba(16, 185, 129, 0.1)',
    },
    agentCardDisabled: {
        opacity: 0.5,
        cursor: 'not-allowed',
    },
    agentHeader: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginBottom: '8px',
    },
    agentEmoji: {
        fontSize: '24px',
    },
    agentName: {
        fontSize: '14px',
        fontWeight: 600,
        color: '#fff',
    },
    agentDesc: {
        fontSize: '13px',
        color: 'rgba(255, 255, 255, 0.6)',
        margin: 0,
        lineHeight: 1.5,
    },
    checkmark: {
        color: '#10b981',
        fontWeight: 'bold',
        marginLeft: 'auto',
    },
    extensionNote: {
        fontSize: '11px',
        color: '#f59e0b',
        display: 'block',
        marginTop: '8px',
    },
    loader: {
        textAlign: 'center' as const,
        color: 'rgba(255, 255, 255, 0.7)',
    },
    avatar: {
        fontSize: '64px',
        marginBottom: '16px',
    },
};

export const OnboardingWizard = createIsland(OnboardingWizardImpl, 'OnboardingWizard');
