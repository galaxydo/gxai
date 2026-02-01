// Test script to verify the analytics integration
import { z } from 'zod';

// Simulate what an Agent would send to the analytics API
async function sendTestAnalytics() {
    const testRequests = [
        {
            id: `test-${Date.now()}-1`,
            agentName: 'WeatherBot',
            llm: 'gpt-4o-mini',
            timestamp: Date.now(),
            duration: 1234,
            status: 'success',
            input: { city: 'Tokyo', units: 'celsius' },
            output: { temperature: 18, condition: 'Cloudy' }
        },
        {
            id: `test-${Date.now()}-2`,
            agentName: 'CodeAssistant',
            llm: 'claude-3-5-sonnet',
            timestamp: Date.now() - 5000,
            duration: 3456,
            status: 'success',
            input: { language: 'TypeScript', task: 'Create a REST API' },
            output: { code: 'const app = new Hono(); app.get("/", (c) => c.json({ hello: "world" }));' },
            toolInvocations: [
                { server: 'filesystem', tool: 'read_file', parameters: { path: '/package.json' }, result: '{"name": "test"}' }
            ]
        },
        {
            id: `test-${Date.now()}-3`,
            agentName: 'WeatherBot',
            llm: 'gpt-4o-mini',
            timestamp: Date.now() - 10000,
            duration: 890,
            status: 'error',
            input: { city: 'InvalidCity123' },
            output: {},
            error: 'City not found in weather database'
        },
        {
            id: `test-${Date.now()}-4`,
            agentName: 'TranslatorAgent',
            llm: 'deepseek',
            timestamp: Date.now() - 2000,
            duration: 567,
            status: 'success',
            input: { text: 'Hello world', targetLanguage: 'Japanese' },
            output: { translation: 'こんにちは世界' }
        }
    ];

    console.log('🧪 Sending test analytics data...\n');

    for (const request of testRequests) {
        try {
            const response = await fetch('http://localhost:3001/api/record', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(request)
            });

            const result = await response.json();
            console.log(`✅ Sent: ${request.agentName} (${request.status}) - ${result.success ? 'recorded' : 'failed'}`);
        } catch (e) {
            console.error(`❌ Failed to send ${request.agentName}:`, e);
        }
    }

    console.log('\n📊 Verifying data...');

    // Verify the data was stored
    const agentsRes = await fetch('http://localhost:3001/api/agents');
    const agents = await agentsRes.json();
    console.log(`\n🤖 Agents found: ${agents.length}`);
    for (const agent of agents) {
        console.log(`   - ${agent.name}: ${agent.totalRequests} requests (${agent.successfulRequests} success, ${agent.failedRequests} failed)`);
    }

    const requestsRes = await fetch('http://localhost:3001/api/requests');
    const requests = await requestsRes.json();
    console.log(`\n📋 Total requests: ${requests.length}`);

    console.log('\n✨ Test complete! Open http://localhost:3001 to view the dashboard.');
}

sendTestAnalytics().catch(console.error);
