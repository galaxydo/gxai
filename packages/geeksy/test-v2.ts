/**
 * Test script for Geeksy v2 Agent System
 * 
 * Run: bun run packages/geeksy/test-v2.ts
 */

import { getAuthManager } from './src/core/auth-manager';
import { getContactManager } from './src/core/contact-manager';
import { getAgentManager } from './src/core/agent-manager';
import { getJobExecutor } from './src/core/job-executor';

async function main() {
    console.log('🧪 Testing Geeksy v2 Agent System\n');

    // Initialize managers
    const authManager = getAuthManager();
    const contactManager = getContactManager();
    const agentManager = getAgentManager();
    const jobExecutor = getJobExecutor();

    // Test Auth Manager
    console.log('📡 Auth Manager');
    console.log(`   Status: ${authManager.isConnected() ? 'Connected' : 'Disconnected'}`);

    // Simulate connection
    authManager.initAuth('+1234567890');
    authManager.completeAuth({
        sessionString: 'test_session',
        userId: 'test_user_123',
        username: 'testuser',
        firstName: 'Test User',
    });
    console.log(`   After connect: ${authManager.isConnected()}\n`);

    // Test Agent Manager
    console.log('🤖 Agent Manager');
    const agents = agentManager.getAllAgents();
    console.log(`   Built-in agents: ${agents.length}`);
    for (const agent of agents) {
        console.log(`   - ${agent.emoji} ${agent.name} (${agent.agentId})`);
        console.log(`     Capabilities: create=${agent.canCreateAgents}, attach=${agent.canAttachContacts}, send=${agent.canSendMessages}`);
    }
    console.log();

    // Test Contact Manager
    console.log('👥 Contact Manager');

    // Create some demo contacts
    const contact1 = contactManager.upsertFromTelegram({
        telegramId: '111111',
        telegramUsername: 'alice',
        firstName: 'Alice',
        lastName: 'Smith',
    });
    console.log(`   Created: ${contact1.displayName} (${contact1.contactId})`);

    const contact2 = contactManager.upsertFromTelegram({
        telegramId: '222222',
        telegramUsername: 'bob',
        firstName: 'Bob',
    });
    console.log(`   Created: ${contact2.displayName} (${contact2.contactId})`);

    const contact3 = contactManager.upsertFromTelegram({
        telegramId: '333333',
        firstName: 'Charlie',
    });
    console.log(`   Created: ${contact3.displayName} (${contact3.contactId})`);
    console.log();

    // Bind agents to contacts
    console.log('🔗 Binding Agents to Contacts');
    const simpleResponder = agents.find(a => a.name === 'Simple Responder');
    if (simpleResponder) {
        contactManager.bindAgent(contact1.contactId, simpleResponder.agentId);
        console.log(`   Bound Simple Responder to Alice`);

        contactManager.bindAgent(contact2.contactId, simpleResponder.agentId);
        console.log(`   Bound Simple Responder to Bob`);
    }
    console.log();

    // Test message processing
    console.log('⚡ Testing Job Execution');

    // Set up message callback
    jobExecutor.setSendMessageCallback(async (contactId, content) => {
        console.log(`   📤 Would send to ${contactId}: "${content.slice(0, 50)}..."`);
    });

    // Simulate incoming messages
    console.log('\n   Simulating message from Alice...');
    const msg1 = contactManager.recordIncoming(contact1.contactId, 'Hello! How are you today?');
    const results1 = await jobExecutor.executeForMessage(contact1.contactId, msg1.messageId, msg1.content);
    console.log(`   Results: ${JSON.stringify(results1, null, 2)}`);

    console.log('\n   Simulating message from Bob...');
    const msg2 = contactManager.recordIncoming(contact2.contactId, 'Can you help me with something?');
    const results2 = await jobExecutor.executeForMessage(contact2.contactId, msg2.messageId, msg2.content);
    console.log(`   Results: ${JSON.stringify(results2, null, 2)}`);

    console.log('\n   Simulating message from Charlie (no agent)...');
    const msg3 = contactManager.recordIncoming(contact3.contactId, 'Is anyone there?');
    const results3 = await jobExecutor.executeForMessage(contact3.contactId, msg3.messageId, msg3.content);
    console.log(`   Results: ${results3.length === 0 ? 'No agents bound' : JSON.stringify(results3, null, 2)}`);

    // Show stats
    console.log('\n📊 Job Stats');
    const stats = jobExecutor.getStats();
    console.log(`   Total: ${stats.total}`);
    console.log(`   Running: ${stats.running}`);
    console.log(`   Completed: ${stats.completed}`);
    console.log(`   Failed: ${stats.failed}`);

    // Show conversation history
    console.log('\n💬 Alice Conversation History');
    const aliceConversation = contactManager.getConversation(contact1.contactId);
    for (const msg of aliceConversation) {
        console.log(`   [${msg.role}] ${msg.content.slice(0, 50)}${msg.content.length > 50 ? '...' : ''}`);
    }

    console.log('\n✅ Test complete!\n');
}

main().catch(console.error);
