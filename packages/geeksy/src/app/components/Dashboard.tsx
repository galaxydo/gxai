'use client';

/**
 * Geeksy Dashboard - 3-column observability UI
 * 
 * Layout:
 * - Left: Messages (from channels)
 * - Center: Agents (templates that can spawn jobs)
 * - Right: Jobs (spawned instances processing messages)
 */

import { useState, useEffect } from 'react';
import { createIsland } from 'melina/island';

interface Message {
    id: string;
    source: string;
    sourceId?: string;
    userId?: string;
    content: string;
    timestamp: number;
}

interface Agent {
    id: string;
    name: string;
    description: string;
    emoji: string;
    port: number;
    capabilities: string[];
    running: boolean;
}

interface Job {
    id: string;
    messageId: string;
    agentId: string;
    agentName: string;
    agentEmoji: string;
    status: 'pending' | 'processing' | 'awaiting_callback' | 'completed' | 'failed';
    decision: string;
    reason: string;
    startedAt: number;
    completedAt?: number;
}

interface Channel {
    id: string;
    name: string;
    type: string;
    emoji: string;
    enabled: boolean;
    messageCount: number;
}

// Source emoji mapping
const sourceEmojis: Record<string, string> = {
    telegram: '📱',
    discord: '💬',
    test: '🧪',
    api: '🔌',
    webhook: '🪝',
};

// Status color mapping
const statusColors: Record<string, string> = {
    pending: '#fbbf24',
    processing: '#3b82f6',
    awaiting_callback: '#a855f7',
    completed: '#22c55e',
    failed: '#ef4444',
};

function DashboardImpl() {
    const [messages, setMessages] = useState<Message[]>([]);
    const [agents, setAgents] = useState<Agent[]>([]);
    const [jobs, setJobs] = useState<Job[]>([]);
    const [channels, setChannels] = useState<Channel[]>([]);
    const [selectedMessage, setSelectedMessage] = useState<string | null>(null);
    const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
    const [testMessage, setTestMessage] = useState('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 2000);
        return () => clearInterval(interval);
    }, []);

    const fetchData = async () => {
        try {
            const [msgRes, agentRes, jobRes, channelRes] = await Promise.all([
                fetch('/api/messages'),
                fetch('/api/agents'),
                fetch('/api/jobs'),
                fetch('/api/channels'),
            ]);

            if (msgRes.ok) setMessages(await msgRes.json());
            if (agentRes.ok) setAgents(await agentRes.json());
            if (jobRes.ok) setJobs(await jobRes.json());
            if (channelRes.ok) setChannels(await channelRes.json());
        } catch (e) {
            console.error('Failed to fetch:', e);
        }
        setLoading(false);
    };

    const sendTestMessage = async () => {
        if (!testMessage.trim()) return;
        try {
            await fetch('/api/messages', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ source: 'test', content: testMessage }),
            });
            setTestMessage('');
            fetchData();
        } catch (e) {
            console.error('Failed to send:', e);
        }
    };

    const toggleAgent = async (agentId: string, action: 'start' | 'stop') => {
        try {
            await fetch('/api/agents', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, agentId }),
            });
            fetchData();
        } catch (e) {
            console.error('Failed to toggle agent:', e);
        }
    };

    const spawnJob = async (messageId: string, agentId: string) => {
        try {
            await fetch('/api/jobs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'create',
                    messageId,
                    agentId,
                }),
            });
            fetchData();
        } catch (e) {
            console.error('Failed to spawn job:', e);
        }
    };

    // Filter jobs by selected message
    const filteredJobs = selectedMessage
        ? jobs.filter(j => j.messageId === selectedMessage)
        : jobs;

    // Filter jobs by selected agent  
    const agentJobs = selectedAgent
        ? filteredJobs.filter(j => j.agentId === selectedAgent)
        : filteredJobs;

    const formatTime = (ts: number) => {
        const d = new Date(ts);
        return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    };

    const formatDuration = (start: number, end?: number) => {
        const ms = (end || Date.now()) - start;
        if (ms < 1000) return `${ms}ms`;
        return `${(ms / 1000).toFixed(1)}s`;
    };

    if (loading) {
        return (
            <div style={styles.loading}>
                <div style={styles.loadingSpinner}>🤖</div>
                <p>Loading Geeksy Dashboard...</p>
            </div>
        );
    }

    return (
        <div style={styles.container}>
            {/* Header */}
            <header style={styles.header}>
                <div style={styles.headerLeft}>
                    <span style={styles.logo}>🤖</span>
                    <h1 style={styles.title}>Geeksy</h1>
                    <span style={styles.subtitle}>Multi-Agent Orchestration</span>
                </div>
                <div style={styles.headerRight}>
                    <div style={styles.stat}>
                        <span style={styles.statValue}>{messages.length}</span>
                        <span style={styles.statLabel}>Messages</span>
                    </div>
                    <div style={styles.stat}>
                        <span style={styles.statValue}>{agents.filter(a => a.running).length}/{agents.length}</span>
                        <span style={styles.statLabel}>Agents</span>
                    </div>
                    <div style={styles.stat}>
                        <span style={styles.statValue}>{jobs.filter(j => j.status === 'processing').length}</span>
                        <span style={styles.statLabel}>Active Jobs</span>
                    </div>
                </div>
            </header>

            {/* Three Column Layout */}
            <div style={styles.columns}>
                {/* Messages Column */}
                <div style={styles.column}>
                    <div style={styles.columnHeader}>
                        <h2 style={styles.columnTitle}>📨 Messages</h2>
                        <div style={styles.channelPills}>
                            {channels.map(ch => (
                                <span
                                    key={ch.id}
                                    style={{
                                        ...styles.pill,
                                        opacity: ch.enabled ? 1 : 0.5
                                    }}
                                >
                                    {ch.emoji} {ch.messageCount}
                                </span>
                            ))}
                        </div>
                    </div>

                    {/* Test Input */}
                    <div style={styles.testInput}>
                        <input
                            type="text"
                            value={testMessage}
                            onChange={e => setTestMessage(e.target.value)}
                            onKeyPress={e => e.key === 'Enter' && sendTestMessage()}
                            placeholder="Send test message..."
                            style={styles.input}
                        />
                        <button onClick={sendTestMessage} style={styles.sendBtn}>
                            Send 🧪
                        </button>
                    </div>

                    {/* Message List */}
                    <div style={styles.list}>
                        {messages.length === 0 ? (
                            <div style={styles.empty}>No messages yet</div>
                        ) : (
                            messages.map(msg => (
                                <div
                                    key={msg.id}
                                    onClick={() => setSelectedMessage(selectedMessage === msg.id ? null : msg.id)}
                                    style={{
                                        ...styles.card,
                                        ...(selectedMessage === msg.id ? styles.cardSelected : {})
                                    }}
                                >
                                    <div style={styles.cardHeader}>
                                        <span style={styles.cardEmoji}>
                                            {sourceEmojis[msg.source] || '📩'}
                                        </span>
                                        <span style={styles.cardTime}>{formatTime(msg.timestamp)}</span>
                                    </div>
                                    <div style={styles.cardContent}>{msg.content}</div>
                                    <div style={styles.cardMeta}>
                                        {msg.userId && <span>👤 {msg.userId}</span>}
                                        <span style={styles.cardId}>{msg.id.substring(0, 12)}...</span>
                                    </div>
                                    {/* Job count for this message */}
                                    <div style={styles.jobPills}>
                                        {jobs.filter(j => j.messageId === msg.id).map(j => (
                                            <span
                                                key={j.id}
                                                style={{
                                                    ...styles.jobPill,
                                                    backgroundColor: statusColors[j.status] + '33',
                                                    borderColor: statusColors[j.status],
                                                }}
                                            >
                                                {j.agentEmoji}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Agents Column */}
                <div style={styles.column}>
                    <div style={styles.columnHeader}>
                        <h2 style={styles.columnTitle}>🤖 Agents</h2>
                        <span style={styles.headerBadge}>
                            {agents.filter(a => a.running).length} running
                        </span>
                    </div>

                    <div style={styles.list}>
                        {agents.length === 0 ? (
                            <div style={styles.empty}>No agents registered</div>
                        ) : (
                            agents.map(agent => (
                                <div
                                    key={agent.id}
                                    onClick={() => setSelectedAgent(selectedAgent === agent.id ? null : agent.id)}
                                    style={{
                                        ...styles.card,
                                        ...(selectedAgent === agent.id ? styles.cardSelected : {})
                                    }}
                                >
                                    <div style={styles.cardHeader}>
                                        <span style={styles.cardEmoji}>{agent.emoji}</span>
                                        <span style={styles.agentName}>{agent.name}</span>
                                        <span style={{
                                            ...styles.statusDot,
                                            backgroundColor: agent.running ? '#22c55e' : '#6b7280'
                                        }} />
                                    </div>
                                    <div style={styles.cardDescription}>{agent.description}</div>
                                    <div style={styles.capabilities}>
                                        {agent.capabilities?.map(cap => (
                                            <span key={cap} style={styles.capPill}>{cap}</span>
                                        ))}
                                    </div>
                                    <div style={styles.agentActions}>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                toggleAgent(agent.id, agent.running ? 'stop' : 'start');
                                            }}
                                            style={{
                                                ...styles.actionBtn,
                                                ...(agent.running ? styles.stopBtn : styles.startBtn)
                                            }}
                                        >
                                            {agent.running ? '⏹ Stop' : '▶ Start'}
                                        </button>
                                        {selectedMessage && (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    spawnJob(selectedMessage, agent.id);
                                                }}
                                                style={styles.spawnBtn}
                                            >
                                                ⚡ Spawn Job
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Jobs Column */}
                <div style={styles.column}>
                    <div style={styles.columnHeader}>
                        <h2 style={styles.columnTitle}>⚡ Jobs</h2>
                        {selectedMessage && (
                            <button
                                onClick={() => setSelectedMessage(null)}
                                style={styles.clearFilter}
                            >
                                Clear filter ✕
                            </button>
                        )}
                    </div>

                    <div style={styles.list}>
                        {agentJobs.length === 0 ? (
                            <div style={styles.empty}>
                                {selectedMessage ? 'No jobs for this message' : 'No jobs yet'}
                            </div>
                        ) : (
                            agentJobs.map(job => (
                                <div key={job.id} style={styles.card}>
                                    <div style={styles.cardHeader}>
                                        <span style={styles.cardEmoji}>{job.agentEmoji}</span>
                                        <span style={styles.jobAgent}>{job.agentName}</span>
                                        <span style={{
                                            ...styles.statusBadge,
                                            backgroundColor: statusColors[job.status] + '33',
                                            color: statusColors[job.status],
                                            borderColor: statusColors[job.status],
                                        }}>
                                            {job.status}
                                        </span>
                                    </div>
                                    <div style={styles.jobDecision}>
                                        <strong>{job.decision}</strong>: {job.reason}
                                    </div>
                                    <div style={styles.cardMeta}>
                                        <span>⏱ {formatDuration(job.startedAt, job.completedAt)}</span>
                                        <span style={styles.cardId}>{job.id.substring(0, 12)}...</span>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

// Styles
const styles: Record<string, React.CSSProperties> = {
    container: {
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #0f0f23 0%, #1a1a2e 50%, #16213e 100%)',
        color: '#e2e8f0',
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    },
    loading: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: 'linear-gradient(135deg, #0f0f23 0%, #1a1a2e 50%, #16213e 100%)',
        color: '#e2e8f0',
    },
    loadingSpinner: {
        fontSize: '48px',
        animation: 'pulse 1.5s infinite',
    },
    header: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px 24px',
        background: 'rgba(255,255,255,0.03)',
        backdropFilter: 'blur(10px)',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
    },
    headerLeft: {
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
    },
    logo: {
        fontSize: '32px',
    },
    title: {
        fontSize: '24px',
        fontWeight: 700,
        background: 'linear-gradient(135deg, #60a5fa, #a78bfa)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        margin: 0,
    },
    subtitle: {
        color: '#94a3b8',
        fontSize: '14px',
    },
    headerRight: {
        display: 'flex',
        gap: '24px',
    },
    stat: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
    },
    statValue: {
        fontSize: '20px',
        fontWeight: 600,
        color: '#60a5fa',
    },
    statLabel: {
        fontSize: '11px',
        color: '#64748b',
        textTransform: 'uppercase',
    },
    columns: {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1fr',
        gap: '16px',
        padding: '16px 24px',
        height: 'calc(100vh - 80px)',
    },
    column: {
        display: 'flex',
        flexDirection: 'column',
        background: 'rgba(255,255,255,0.02)',
        borderRadius: '12px',
        border: '1px solid rgba(255,255,255,0.08)',
        overflow: 'hidden',
    },
    columnHeader: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        background: 'rgba(255,255,255,0.03)',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
    },
    columnTitle: {
        fontSize: '16px',
        fontWeight: 600,
        margin: 0,
    },
    channelPills: {
        display: 'flex',
        gap: '6px',
    },
    pill: {
        padding: '4px 8px',
        background: 'rgba(255,255,255,0.1)',
        borderRadius: '12px',
        fontSize: '11px',
    },
    headerBadge: {
        padding: '4px 10px',
        background: 'rgba(34, 197, 94, 0.2)',
        color: '#22c55e',
        borderRadius: '12px',
        fontSize: '11px',
    },
    testInput: {
        display: 'flex',
        gap: '8px',
        padding: '12px 16px',
        background: 'rgba(0,0,0,0.2)',
    },
    input: {
        flex: 1,
        padding: '10px 14px',
        background: 'rgba(255,255,255,0.05)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '8px',
        color: '#e2e8f0',
        fontSize: '14px',
        outline: 'none',
    },
    sendBtn: {
        padding: '10px 16px',
        background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
        border: 'none',
        borderRadius: '8px',
        color: 'white',
        fontSize: '14px',
        fontWeight: 500,
        cursor: 'pointer',
    },
    list: {
        flex: 1,
        overflow: 'auto',
        padding: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
    },
    empty: {
        textAlign: 'center',
        color: '#64748b',
        padding: '40px 20px',
    },
    card: {
        padding: '14px',
        background: 'rgba(255,255,255,0.03)',
        borderRadius: '10px',
        border: '1px solid rgba(255,255,255,0.06)',
        cursor: 'pointer',
        transition: 'all 0.2s',
    },
    cardSelected: {
        background: 'rgba(59, 130, 246, 0.1)',
        borderColor: '#3b82f6',
    },
    cardHeader: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginBottom: '8px',
    },
    cardEmoji: {
        fontSize: '18px',
    },
    cardTime: {
        marginLeft: 'auto',
        fontSize: '11px',
        color: '#64748b',
    },
    cardContent: {
        fontSize: '14px',
        lineHeight: 1.5,
        marginBottom: '8px',
        wordBreak: 'break-word',
    },
    cardDescription: {
        fontSize: '13px',
        color: '#94a3b8',
        marginBottom: '8px',
    },
    cardMeta: {
        display: 'flex',
        gap: '12px',
        fontSize: '11px',
        color: '#64748b',
    },
    cardId: {
        marginLeft: 'auto',
        fontFamily: 'monospace',
    },
    jobPills: {
        display: 'flex',
        gap: '4px',
        marginTop: '8px',
    },
    jobPill: {
        width: '24px',
        height: '24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '6px',
        fontSize: '12px',
        border: '1px solid',
    },
    agentName: {
        fontWeight: 600,
        fontSize: '14px',
    },
    statusDot: {
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        marginLeft: 'auto',
    },
    capabilities: {
        display: 'flex',
        flexWrap: 'wrap',
        gap: '4px',
        marginBottom: '10px',
    },
    capPill: {
        padding: '2px 8px',
        background: 'rgba(139, 92, 246, 0.2)',
        color: '#a78bfa',
        borderRadius: '10px',
        fontSize: '10px',
    },
    agentActions: {
        display: 'flex',
        gap: '8px',
    },
    actionBtn: {
        padding: '6px 12px',
        border: 'none',
        borderRadius: '6px',
        fontSize: '12px',
        fontWeight: 500,
        cursor: 'pointer',
    },
    startBtn: {
        background: 'rgba(34, 197, 94, 0.2)',
        color: '#22c55e',
    },
    stopBtn: {
        background: 'rgba(239, 68, 68, 0.2)',
        color: '#ef4444',
    },
    spawnBtn: {
        padding: '6px 12px',
        background: 'linear-gradient(135deg, #f59e0b, #f97316)',
        border: 'none',
        borderRadius: '6px',
        color: 'white',
        fontSize: '12px',
        fontWeight: 500,
        cursor: 'pointer',
    },
    clearFilter: {
        padding: '4px 10px',
        background: 'rgba(239, 68, 68, 0.2)',
        color: '#ef4444',
        border: 'none',
        borderRadius: '10px',
        fontSize: '11px',
        cursor: 'pointer',
    },
    jobAgent: {
        fontWeight: 600,
        fontSize: '14px',
    },
    statusBadge: {
        marginLeft: 'auto',
        padding: '3px 8px',
        borderRadius: '10px',
        fontSize: '10px',
        fontWeight: 600,
        border: '1px solid',
        textTransform: 'uppercase',
    },
    jobDecision: {
        fontSize: '13px',
        color: '#94a3b8',
        marginBottom: '8px',
    },
};

// Export the island-wrapped version for proper hydration
export const Dashboard = createIsland(DashboardImpl, 'Dashboard');
