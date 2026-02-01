/**
 * Telegram Connector for Geeksy
 * 
 * Listens for Telegram messages and publishes them to the message bus
 * Also sends agent responses back to Telegram
 */

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GEEKSY_API = process.env.GEEKSY_API || 'http://localhost:3005';

if (!BOT_TOKEN) {
    console.error('❌ TELEGRAM_BOT_TOKEN environment variable is required');
    process.exit(1);
}

const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

interface TelegramUpdate {
    update_id: number;
    message?: {
        message_id: number;
        from: {
            id: number;
            first_name: string;
            last_name?: string;
            username?: string;
        };
        chat: {
            id: number;
            type: string;
        };
        text?: string;
        date: number;
    };
}

let lastUpdateId = 0;

async function getUpdates(): Promise<TelegramUpdate[]> {
    try {
        const response = await fetch(`${TELEGRAM_API}/getUpdates?offset=${lastUpdateId + 1}&timeout=30`);
        const data = await response.json() as { ok: boolean; result: TelegramUpdate[] };

        if (data.ok && data.result.length > 0) {
            lastUpdateId = data.result[data.result.length - 1].update_id;
            return data.result;
        }
    } catch (e) {
        console.error('Failed to get updates:', e);
    }
    return [];
}

async function sendMessage(chatId: number, text: string): Promise<void> {
    try {
        await fetch(`${TELEGRAM_API}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text,
                parse_mode: 'Markdown'
            })
        });
    } catch (e) {
        console.error('Failed to send message:', e);
    }
}

async function publishToGeeksy(update: TelegramUpdate): Promise<void> {
    if (!update.message?.text) return;

    try {
        await fetch(`${GEEKSY_API}/api/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                source: 'telegram',
                content: update.message.text,
                sourceId: String(update.message.chat.id),
                userId: String(update.message.from.id),
                metadata: {
                    chatType: update.message.chat.type,
                    username: update.message.from.username,
                    firstName: update.message.from.first_name,
                    lastName: update.message.from.last_name,
                    messageId: update.message.message_id
                }
            })
        });
        console.log(`📨 Published message from @${update.message.from.username || update.message.from.first_name}`);
    } catch (e) {
        console.error('Failed to publish to Geeksy:', e);
    }
}

async function checkForResponses(): Promise<void> {
    try {
        // Get pending responses for Telegram
        const response = await fetch(`${GEEKSY_API}/api/responses?source=telegram`);
        if (!response.ok) return;

        const responses = await response.json() as any[];

        for (const res of responses) {
            if (res.targetSource === 'telegram' && !res.sent && res.targetSourceId) {
                const chatId = parseInt(res.targetSourceId);
                const text = `🤖 *${res.agentName}*:\n${res.content}`;
                await sendMessage(chatId, text);

                // Mark as sent
                await fetch(`${GEEKSY_API}/api/responses/${res.id}/sent`, { method: 'POST' });
            }
        }
    } catch (e) {
        // Response endpoint may not exist yet
    }
}

async function main() {
    console.log('🤖 Geeksy Telegram Connector starting...');

    // Get bot info
    try {
        const response = await fetch(`${TELEGRAM_API}/getMe`);
        const data = await response.json() as { ok: boolean; result: { username: string } };
        if (data.ok) {
            console.log(`✅ Connected as @${data.result.username}`);
        }
    } catch (e) {
        console.error('❌ Failed to connect to Telegram');
        process.exit(1);
    }

    // Main polling loop
    console.log('📡 Listening for messages...');

    while (true) {
        const updates = await getUpdates();

        for (const update of updates) {
            await publishToGeeksy(update);
        }

        // Check for responses to send back
        await checkForResponses();
    }
}

main().catch(console.error);
