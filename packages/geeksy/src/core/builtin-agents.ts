/**
 * Built-in Agents for Geeksy
 * 
 * These are the default agents that handle admin commands:
 * 
 * 1. Simple Agent Builder - Creates jobs from natural language
 * 2. Media Generator - Creates images and media
 * 3. Personal Assistant - Task management
 */

import type { MessageData } from './message-bus';
import type {
    AgentDefinition,
    AgentProcessResult,
    PersistentJob,
    JobFilter,
    JobAction
} from './orchestrator';
import { generateJobId, createResponseJob } from './orchestrator';

// ============================================
// Simple Agent Builder
// ============================================

export const AgentBuilderDefinition: AgentDefinition = {
    id: 'agent-builder',
    name: 'Simple Agent Builder',
    emoji: '🛠️',
    description: 'Creates new jobs and automations from natural language commands. Tell it what you want to automate.',
    capabilities: ['create', 'build', 'make', 'automate', 'respond', 'listen', 'trigger'],
    keywords: ['create', 'make', 'build', 'when', 'whenever', 'if someone', 'respond to', 'reply to', 'answer', 'bot', 'automation'],
    running: true,
};

/** Parse a natural language command to create a job */
function parseJobCommand(content: string): { filter: JobFilter; action: JobAction; name: string } | null {
    const lowerContent = content.toLowerCase();

    // Pattern: "when someone says X, respond with Y"
    // Pattern: "respond to X with Y"  
    // Pattern: "if message contains X, reply Y"

    let filter: JobFilter = {};
    let action: JobAction = { type: 'respond' };
    let name = 'Custom Job';

    // Extract trigger words
    const containsPatterns = [
        /when\s+(?:someone\s+)?(?:says?|sends?|writes?)\s+["']([^"']+)["']/i,
        /respond\s+to\s+["']([^"']+)["']/i,
        /if\s+(?:message\s+)?contains?\s+["']([^"']+)["']/i,
        /whenever\s+["']([^"']+)["']/i,
        /listen\s+for\s+["']([^"']+)["']/i,
    ];

    for (const pattern of containsPatterns) {
        const match = content.match(pattern);
        if (match) {
            filter.containsWords = match[1].split(/\s*,\s*|\s+or\s+/i);
            name = `"${match[1]}" responder`;
            break;
        }
    }

    // Extract response
    const responsePatterns = [
        /(?:respond|reply|answer|say)\s+(?:with\s+)?["']([^"']+)["']/i,
        /send\s+["']([^"']+)["']/i,
    ];

    for (const pattern of responsePatterns) {
        const match = content.match(pattern);
        if (match) {
            action.responseContent = match[1];
            break;
        }
    }

    // Check for specific user filter
    const userPattern = /from\s+(?:user\s+)?["']?@?(\w+)["']?/i;
    const userMatch = content.match(userPattern);
    if (userMatch) {
        filter.fromUser = userMatch[1];
    }

    // Validate we have enough info
    if (!filter.containsWords && !filter.fromUser && !filter.matchAll) {
        return null;
    }

    if (!action.responseContent && action.type === 'respond') {
        return null;
    }

    return { filter, action, name };
}

export async function AgentBuilderHandler(message: MessageData, args: any): Promise<AgentProcessResult> {
    console.log(`🛠️ Agent Builder processing: "${message.content.slice(0, 50)}..."`);

    const parsed = parseJobCommand(message.content);

    if (!parsed) {
        return {
            success: false,
            message: 'Could not understand the command',
            adminResponse: `I couldn't understand that command. Try something like:\n` +
                `• "When someone says 'hello', respond with 'Hi there!'"\n` +
                `• "Create a bot that replies 'Thanks!' to 'thank you'"`,
        };
    }

    // Create the job
    const job: PersistentJob = {
        id: generateJobId(),
        name: parsed.name,
        emoji: '🤖',
        description: `Responds to ${JSON.stringify(parsed.filter.containsWords)} with "${parsed.action.responseContent?.slice(0, 30)}..."`,
        createdByAgentId: 'agent-builder',
        filter: parsed.filter,
        action: parsed.action,
        active: true,
        triggerCount: 0,
        createdAt: Date.now(),
    };

    console.log(`   ✅ Created job: ${job.name}`);

    return {
        success: true,
        message: `Created job: ${job.name}`,
        createdJobs: [job],
        adminResponse: `✅ Created "${job.name}"!\n\n` +
            `📋 This job will:\n` +
            `• Listen for messages containing: ${parsed.filter.containsWords?.join(', ')}\n` +
            `• Respond with: "${parsed.action.responseContent}"\n\n` +
            `The job is now active and listening!`,
    };
}

// ============================================
// Media Generator
// ============================================

export const MediaGeneratorDefinition: AgentDefinition = {
    id: 'media-generator',
    name: 'Media Generator',
    emoji: '🎨',
    description: 'Generates images, artwork, and other media content based on your descriptions.',
    capabilities: ['generate', 'create', 'draw', 'design', 'image', 'picture', 'art', 'photo'],
    keywords: ['generate', 'create', 'draw', 'make', 'image', 'picture', 'photo', 'art', 'design', 'illustration'],
    running: true,
};

export async function MediaGeneratorHandler(message: MessageData, args: any): Promise<AgentProcessResult> {
    console.log(`🎨 Media Generator processing: "${message.content.slice(0, 50)}..."`);

    // Extract what to generate
    const patterns = [
        /(?:generate|create|draw|make)\s+(?:an?\s+)?(?:image|picture|photo|art|illustration)\s+of\s+(.+)/i,
        /(?:generate|create|draw|make)\s+(.+)/i,
    ];

    let prompt = '';
    for (const pattern of patterns) {
        const match = message.content.match(pattern);
        if (match) {
            prompt = match[1].trim();
            break;
        }
    }

    if (!prompt) {
        return {
            success: false,
            message: 'Could not understand prompt',
            adminResponse: `I need a description of what to generate. Try:\n` +
                `• "Generate an image of a sunset over mountains"\n` +
                `• "Create a logo for a coffee shop"`,
        };
    }

    // TODO: Integrate with actual image generation API
    console.log(`   🖼️ Would generate image for: "${prompt}"`);

    return {
        success: true,
        message: `Generating image: ${prompt}`,
        adminResponse: `🎨 Generating image: "${prompt}"\n\n` +
            `⏳ This may take a moment...\n\n` +
            `(Image generation will be sent when ready)`,
    };
}

// ============================================
// Personal Assistant
// ============================================

export const PersonalAssistantDefinition: AgentDefinition = {
    id: 'personal-assistant',
    name: 'Personal Assistant',
    emoji: '📋',
    description: 'Helps manage tasks, reminders, and schedules. Your personal organizer.',
    capabilities: ['remind', 'schedule', 'task', 'todo', 'note', 'remember', 'calendar'],
    keywords: ['remind', 'reminder', 'schedule', 'task', 'todo', 'note', 'remember', 'meeting', 'appointment', 'calendar'],
    running: true,
};

export async function PersonalAssistantHandler(message: MessageData, args: any): Promise<AgentProcessResult> {
    console.log(`📋 Personal Assistant processing: "${message.content.slice(0, 50)}..."`);

    const lowerContent = message.content.toLowerCase();

    // Reminder pattern
    if (lowerContent.includes('remind')) {
        const reminderMatch = message.content.match(/remind\s+(?:me\s+)?(?:to\s+)?(.+?)(?:\s+(?:in|at|on)\s+(.+))?$/i);
        if (reminderMatch) {
            const what = reminderMatch[1];
            const when = reminderMatch[2] || 'later';

            return {
                success: true,
                message: `Reminder set: ${what}`,
                adminResponse: `⏰ Reminder set!\n\n` +
                    `📝 "${what}"\n` +
                    `🕐 ${when}\n\n` +
                    `I'll remind you when the time comes.`,
            };
        }
    }

    // Task pattern
    if (lowerContent.includes('task') || lowerContent.includes('todo')) {
        const taskMatch = message.content.match(/(?:add\s+)?(?:task|todo):\s*(.+)/i);
        if (taskMatch) {
            return {
                success: true,
                message: `Task added: ${taskMatch[1]}`,
                adminResponse: `✅ Task added!\n\n` +
                    `📝 "${taskMatch[1]}"`,
            };
        }
    }

    return {
        success: false,
        message: 'Could not understand request',
        adminResponse: `I can help with:\n` +
            `• "Remind me to call John at 3pm"\n` +
            `• "Add task: review documents"\n` +
            `• "Schedule meeting for tomorrow"`,
    };
}

// ============================================
// Export All
// ============================================

export const BuiltInAgents = [
    { definition: AgentBuilderDefinition, handler: AgentBuilderHandler },
    { definition: MediaGeneratorDefinition, handler: MediaGeneratorHandler },
    { definition: PersonalAssistantDefinition, handler: PersonalAssistantHandler },
];
