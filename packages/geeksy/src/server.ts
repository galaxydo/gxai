/**
 * Geeksy Dashboard Server v2 - New Architecture
 * 
 * Architecture:
 * - Auth Manager: Telegram account connection
 * - Contact Manager: Contacts with message history
 * - Agent Manager: Code templates that process messages
 * - Job Executor: Runs agent code with gxai inference
 */

import { serve, createAppRouter } from 'melina';
import { getAuthManager } from './core/auth-manager';
import { getContactManager } from './core/contact-manager';
import { getAgentManager } from './core/agent-manager';
import { getJobExecutor } from './core/job-executor';

// Legacy imports for backwards compatibility
import { MessageBus } from './core/message-bus';
import { AgentRegistry } from './core/agent-registry';
import { ActivityStream } from './core/activity-stream';
import { ResponseChannel } from './core/response-channel';
import { JobManager } from './core/job-manager';
import { ChannelManager } from './core/channel-manager';
import { Orchestrator, createResponseJob } from './core/orchestrator';
import { BuiltInAgents } from './core/builtin-agents';
import { getOnboardingManager } from './core/onboarding';

// New v2 managers
let authManager: ReturnType<typeof getAuthManager>;
let contactManager: ReturnType<typeof getContactManager>;
let agentManager: ReturnType<typeof getAgentManager>;
let jobExecutor: ReturnType<typeof getJobExecutor>;

// Legacy shared instances
let messageBus: MessageBus;
let agentRegistry: AgentRegistry;
let activityStream: ActivityStream;
let responseChannel: ResponseChannel;
let jobManager: JobManager;
let channelManager: ChannelManager;
let orchestrator: Orchestrator;

// ============================================
// New v2 Getters
// ============================================

export { getAuthManager } from './core/auth-manager';
export { getContactManager } from './core/contact-manager';
export { getAgentManager } from './core/agent-manager';
export { getJobExecutor } from './core/job-executor';

// ============================================
// Legacy Getters (for backwards compatibility)
// ============================================

export function getMessageBus(): MessageBus {
    if (!messageBus) messageBus = new MessageBus();
    return messageBus;
}

export function getAgentRegistry(): AgentRegistry {
    if (!agentRegistry) agentRegistry = new AgentRegistry();
    return agentRegistry;
}

export function getActivityStream(): ActivityStream {
    if (!activityStream) activityStream = new ActivityStream();
    return activityStream;
}

export function getResponseChannel(): ResponseChannel {
    if (!responseChannel) responseChannel = new ResponseChannel();
    return responseChannel;
}

export function getJobManager(): JobManager {
    if (!jobManager) jobManager = new JobManager();
    return jobManager;
}

export function getChannelManager(): ChannelManager {
    if (!channelManager) channelManager = new ChannelManager();
    return channelManager;
}

export function getOrchestrator(): Orchestrator {
    if (!orchestrator) {
        orchestrator = new Orchestrator(
            getMessageBus(),
            getActivityStream(),
            getResponseChannel()
        );
    }
    return orchestrator;
}

/**
 * Initialize new v2 system
 */
function initializeV2(): void {
    console.log('🚀 Initializing Geeksy v2...');

    // Initialize managers (they auto-init built-in agents)
    authManager = getAuthManager();
    contactManager = getContactManager();
    agentManager = getAgentManager();
    jobExecutor = getJobExecutor();

    // Set up the send message callback
    jobExecutor.setSendMessageCallback(async (contactId, content) => {
        console.log(`📤 Sending message to ${contactId}: ${content.slice(0, 50)}...`);
        // In production, this would call the Telegram API
        // For now, just log it
    });

    console.log('✅ Geeksy v2 initialized');
    console.log(`   → Auth status: ${authManager.isConnected() ? 'Connected' : 'Disconnected'}`);
    console.log(`   → Agents: ${agentManager.getAllAgents().length}`);
}

/**
 * Register built-in agents and demo jobs (legacy)
 */
function registerAgentsAndJobs(): void {
    const orch = getOrchestrator();
    const registry = getAgentRegistry();

    // Register built-in agents from onboarding selection
    const onboardingManager = getOnboardingManager();
    const state = onboardingManager.getState();
    const selectedAgents = state?.selectedAgents || ['agent-builder', 'media-generator', 'personal-assistant'];

    for (const { definition, handler } of BuiltInAgents) {
        if (selectedAgents.includes(definition.id)) {
            orch.registerAgent(definition, handler);

            // Also register in legacy AgentRegistry for dashboard display
            registry.register({
                id: definition.id,
                name: definition.name,
                description: definition.description,
                emoji: definition.emoji,
                port: 0,
                scriptPath: '',
                capabilities: definition.capabilities,
            });
            registry.setRunning(definition.id, true);
        }
    }

    // Register admin from onboarding
    if (state?.adminUsername) {
        orch.registerAdmin(state.adminUsername);
    }
    // Always register 'test' as admin for development
    orch.registerAdmin('test');
    orch.registerAdmin('admin');

    // Register demo jobs for testing
    const helloJob = createResponseJob(
        'Hello Responder',
        '👋',
        { containsWords: ['hello', 'hi', 'hey'] },
        'Hey there! Nice to meet you! 👋',
        'agent-builder'
    );
    orch.registerJob(helloJob);

    const pingJob = createResponseJob(
        'Ping Pong',
        '🏓',
        { containsWords: ['ping'] },
        'Pong! 🏓',
        'agent-builder'
    );
    orch.registerJob(pingJob);
}

export async function startDashboard(port: number = 3005): Promise<void> {
    // Initialize new v2 system
    initializeV2();

    // Initialize legacy systems (for backwards compatibility)
    const bus = getMessageBus();
    const registry = getAgentRegistry();
    const activity = getActivityStream();
    const responses = getResponseChannel();
    const jobs = getJobManager();
    const orch = getOrchestrator();

    // Register agents and jobs (legacy)
    registerAgentsAndJobs();

    // Start the orchestrator (legacy)
    orch.start();

    // Start health checks (legacy)
    registry.startHealthChecks();

    // Create app router pointing to our app directory
    const appDir = new URL('app', import.meta.url).pathname;
    const handler = createAppRouter({ appDir });

    // Start the server
    await serve(handler, { port });

    console.log(`
╭────────────────────────────────────────────────────╮
│                                                    │
│   👾 Geeksy v2 - Agent Orchestration Platform      │
│                                                    │
│   Dashboard:  http://localhost:${port}               │
│                                                    │
│   New v2 Features:                                 │
│   - 📡 Auth: Telegram account connection           │
│   - 👥 Contacts: With message history              │
│   - 🤖 Agents: Code templates with gxai inference  │
│   - ⚡ Jobs: Execution instances                    │
│                                                    │
│   Built-in Agents:                                 │
│   - 👑 Admin Agent (meta-agent)                    │
│   - 💬 Simple Responder                            │
│                                                    │
│   API Endpoints:                                   │
│   - GET  /api/v2/auth                              │
│   - POST /api/v2/auth/connect                      │
│   - GET  /api/v2/contacts                          │
│   - GET  /api/v2/agents                            │
│   - GET  /api/v2/jobs                              │
│   - POST /api/v2/messages/process                  │
│                                                    │
╰────────────────────────────────────────────────────╯
`);
}
