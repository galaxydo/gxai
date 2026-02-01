// Analytics data store for GXAI
// Uses a simple JSON file for persistence

import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Store data in user's home directory
const DATA_DIR = join(process.env.HOME || process.env.USERPROFILE || "/tmp", ".gxai");
const DATA_FILE = join(DATA_DIR, "analytics.json");

export interface InferenceRequest {
    id: string;
    agentName: string;
    llm: string;
    timestamp: number;
    duration: number;
    status: 'success' | 'error' | 'pending';
    input: any;
    output: any;
    rawPrompt?: string;
    rawResponse?: string;
    toolInvocations?: Array<{
        server: string;
        tool: string;
        parameters: any;
        result: any;
    }>;
    error?: string;
}

export interface AnalyticsData {
    requests: InferenceRequest[];
    version: number;
}

function ensureDataDir(): void {
    if (!existsSync(DATA_DIR)) {
        mkdirSync(DATA_DIR, { recursive: true });
    }
}

function loadData(): AnalyticsData {
    ensureDataDir();
    if (!existsSync(DATA_FILE)) {
        return { requests: [], version: 1 };
    }
    try {
        const content = readFileSync(DATA_FILE, 'utf-8');
        return JSON.parse(content);
    } catch {
        return { requests: [], version: 1 };
    }
}

function saveData(data: AnalyticsData): void {
    ensureDataDir();
    writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

export function getAllRequests(): InferenceRequest[] {
    const data = loadData();
    // Return sorted by timestamp descending (newest first)
    return data.requests.sort((a, b) => b.timestamp - a.timestamp);
}

export function addRequest(request: InferenceRequest): void {
    const data = loadData();
    data.requests.push(request);
    // Keep only last 1000 requests
    if (data.requests.length > 1000) {
        data.requests = data.requests.slice(-1000);
    }
    saveData(data);
}

export function getRequestsByAgent(agentName: string): InferenceRequest[] {
    return getAllRequests().filter(r => r.agentName === agentName);
}

export interface AgentStats {
    name: string;
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    avgDuration: number;
    lastUsed: number;
}

export function getAgentStats(): AgentStats[] {
    const requests = getAllRequests();
    const agentMap = new Map<string, InferenceRequest[]>();

    for (const request of requests) {
        const existing = agentMap.get(request.agentName) || [];
        existing.push(request);
        agentMap.set(request.agentName, existing);
    }

    const stats: AgentStats[] = [];
    for (const [name, agentRequests] of agentMap) {
        const successfulRequests = agentRequests.filter(r => r.status === 'success').length;
        const failedRequests = agentRequests.filter(r => r.status === 'error').length;
        const totalDuration = agentRequests.reduce((acc, r) => acc + r.duration, 0);
        const avgDuration = agentRequests.length > 0 ? Math.round(totalDuration / agentRequests.length) : 0;
        const lastUsed = Math.max(...agentRequests.map(r => r.timestamp));

        stats.push({
            name,
            totalRequests: agentRequests.length,
            successfulRequests,
            failedRequests,
            avgDuration,
            lastUsed
        });
    }

    // Sort by last used (most recent first)
    return stats.sort((a, b) => b.lastUsed - a.lastUsed);
}

export function clearAllData(): void {
    saveData({ requests: [], version: 1 });
}
