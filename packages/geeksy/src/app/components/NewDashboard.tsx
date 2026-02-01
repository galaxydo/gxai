'use client';

/**
 * New Dashboard - 4-Container Layout
 * 
 * 1. Auth Status - Telegram connection
 * 2. Contacts - List with agent bindings
 * 3. Agents - Templates with stats
 * 4. Jobs - Execution history
 */

import React, { useState, useEffect } from 'react';
import { createIsland } from 'melina/island';

interface AuthStatus {
    connected: boolean;
    type?: string;
    phoneNumber?: string;
    username?: string;
    firstName?: string;
}

interface Contact {
    contactId: string;
    displayName: string;
    telegramUsername?: string;
    messageCount: number;
    lastMessageAt?: number;
    hidden: boolean;
    agents: Array<{
        agentId: string;
        name: string;
        emoji: string;
    }>;
}

interface Agent {
    agentId: string;
    name: string;
    emoji: string;
    description: string;
    contactCount: number;
    jobCount: number;
    successCount: number;
    failureCount: number;
    enabled: boolean;
}

interface Job {
    jobId: string;
    agentId: string;
    agentName: string;
    agentEmoji: string;
    contactId: string;
    status: string;
    inferenceSteps: number;
    responseMessage?: string;
    error?: string;
    durationMs?: number;
    startedAt: number;
}

function NewDashboardImpl() {
    const [authStatus, setAuthStatus] = useState<AuthStatus>({ connected: false });
    const [contacts, setContacts] = useState<Contact[]>([]);
    const [agents, setAgents] = useState<Agent[]>([]);
    const [jobs, setJobs] = useState<Job[]>([]);
    const [loading, setLoading] = useState(true);

    // Filters
    const [showHiddenContacts, setShowHiddenContacts] = useState(false);
    const [onlyWithAgents, setOnlyWithAgents] = useState(false);

    // Dialogs
    const [showConnectDialog, setShowConnectDialog] = useState(false);
    const [showAddAgentDialog, setShowAddAgentDialog] = useState(false);
    const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
    const [phoneNumber, setPhoneNumber] = useState('');

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 5000);
        return () => clearInterval(interval);
    }, [showHiddenContacts, onlyWithAgents]);

    const fetchData = async () => {
        try {
            const [authRes, contactsRes, agentsRes, jobsRes] = await Promise.all([
                fetch('/api/v2/auth'),
                fetch(`/api/v2/contacts?includeHidden=${showHiddenContacts}&onlyWithAgents=${onlyWithAgents}`),
                fetch('/api/v2/agents'),
                fetch('/api/v2/jobs?limit=50'),
            ]);

            setAuthStatus(await authRes.json());
            setContacts(await contactsRes.json());
            setAgents(await agentsRes.json());
            setJobs(await jobsRes.json());
            setLoading(false);
        } catch (e) {
            console.error('Failed to fetch data:', e);
            setLoading(false);
        }
    };

    const connectTelegram = async () => {
        await fetch('/api/v2/auth/connect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phoneNumber }),
        });
        setShowConnectDialog(false);
        fetchData();
    };

    const disconnectTelegram = async () => {
        await fetch('/api/v2/auth/disconnect', { method: 'POST' });
        fetchData();
    };

    const toggleContactHidden = async (contactId: string) => {
        await fetch(`/api/v2/contacts/${contactId}/toggle-hidden`, { method: 'POST' });
        fetchData();
    };

    const attachAgentToContact = async (contactId: string, agentId: string) => {
        await fetch(`/api/v2/contacts/${contactId}/agents`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agentId }),
        });
        fetchData();
    };

    if (loading) {
        return (
            <div className="dashboard-loading">
                <div className="loader-emoji">👾</div>
                <p>Loading Geeksy...</p>
            </div>
        );
    }

    return (
        <div className="new-dashboard">
            <header className="dashboard-header">
                <div className="header-brand">
                    <span className="brand-logo">👾</span>
                    <div className="brand-text">
                        <h1>Geeksy</h1>
                        <span className="brand-subtitle">Agent Orchestration Platform</span>
                    </div>
                </div>
                <div className="header-stats">
                    <div className="stat-pill">
                        <span className="stat-value">{contacts.length}</span>
                        <span className="stat-label">Contacts</span>
                    </div>
                    <div className="stat-pill">
                        <span className="stat-value">{agents.length}</span>
                        <span className="stat-label">Agents</span>
                    </div>
                    <div className="stat-pill">
                        <span className="stat-value">{jobs.filter(j => j.status === 'completed').length}</span>
                        <span className="stat-label">Jobs Run</span>
                    </div>
                </div>
            </header>

            <div className="dashboard-grid">
                {/* Auth Status Container */}
                <section className="container auth-container">
                    <div className="container-header">
                        <h2>
                            <span className="container-icon">📡</span>
                            Connection Status
                        </h2>
                    </div>
                    <div className="container-body">
                        {authStatus.connected ? (
                            <div className="auth-connected">
                                <div className="auth-avatar">✅</div>
                                <div className="auth-info">
                                    <div className="auth-name">{authStatus.firstName || 'Connected'}</div>
                                    <div className="auth-username">@{authStatus.username}</div>
                                    <div className="auth-phone">{authStatus.phoneNumber}</div>
                                </div>
                                <button className="btn btn-danger" onClick={disconnectTelegram}>
                                    Disconnect
                                </button>
                            </div>
                        ) : (
                            <div className="auth-disconnected">
                                <div className="auth-icon">📱</div>
                                <p>Connect your Telegram account to start receiving messages</p>
                                <button
                                    className="btn btn-primary"
                                    onClick={() => setShowConnectDialog(true)}
                                >
                                    Connect Telegram
                                </button>
                            </div>
                        )}
                    </div>
                </section>

                {/* Contacts Container */}
                <section className="container contacts-container">
                    <div className="container-header">
                        <h2>
                            <span className="container-icon">👥</span>
                            Contacts
                        </h2>
                        <div className="container-actions">
                            <label className="filter-toggle">
                                <input
                                    type="checkbox"
                                    checked={onlyWithAgents}
                                    onChange={(e) => setOnlyWithAgents(e.target.checked)}
                                />
                                <span>Only with agents</span>
                            </label>
                            <label className="filter-toggle">
                                <input
                                    type="checkbox"
                                    checked={showHiddenContacts}
                                    onChange={(e) => setShowHiddenContacts(e.target.checked)}
                                />
                                <span>Show hidden</span>
                            </label>
                        </div>
                    </div>
                    <div className="container-body scrollable">
                        {contacts.length === 0 ? (
                            <div className="empty-state">
                                <div className="empty-icon">👤</div>
                                <p>No contacts yet. Connect Telegram to see your contacts.</p>
                            </div>
                        ) : (
                            <div className="contact-list">
                                {contacts.map(contact => (
                                    <div
                                        key={contact.contactId}
                                        className={`contact-item ${contact.hidden ? 'hidden' : ''}`}
                                    >
                                        <div className="contact-avatar">
                                            {contact.displayName[0].toUpperCase()}
                                        </div>
                                        <div className="contact-info">
                                            <div className="contact-name">{contact.displayName}</div>
                                            {contact.telegramUsername && (
                                                <div className="contact-username">@{contact.telegramUsername}</div>
                                            )}
                                            <div className="contact-stats">
                                                {contact.messageCount} messages
                                            </div>
                                        </div>
                                        <div className="contact-agents">
                                            {contact.agents.map(agent => (
                                                <span key={agent.agentId} className="agent-badge">
                                                    {agent.emoji}
                                                </span>
                                            ))}
                                            <button
                                                className="btn-icon add-agent"
                                                title="Add agent"
                                                onClick={() => {/* TODO: Add agent dialog */ }}
                                            >
                                                +
                                            </button>
                                        </div>
                                        <div className="contact-actions">
                                            <button
                                                className="btn-icon"
                                                onClick={() => toggleContactHidden(contact.contactId)}
                                                title={contact.hidden ? 'Show' : 'Hide'}
                                            >
                                                {contact.hidden ? '👁️' : '🙈'}
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </section>

                {/* Agents Container */}
                <section className="container agents-container">
                    <div className="container-header">
                        <h2>
                            <span className="container-icon">🤖</span>
                            Agents
                        </h2>
                        <button
                            className="btn btn-secondary"
                            onClick={() => setShowAddAgentDialog(true)}
                        >
                            + New Agent
                        </button>
                    </div>
                    <div className="container-body scrollable">
                        {agents.length === 0 ? (
                            <div className="empty-state">
                                <div className="empty-icon">🤖</div>
                                <p>No agents yet. Create your first agent!</p>
                            </div>
                        ) : (
                            <div className="agent-list">
                                {agents.map(agent => (
                                    <div
                                        key={agent.agentId}
                                        className="agent-item"
                                        onClick={() => setSelectedAgent(agent)}
                                    >
                                        <div className="agent-emoji">{agent.emoji}</div>
                                        <div className="agent-info">
                                            <div className="agent-name">{agent.name}</div>
                                            <div className="agent-desc">{agent.description}</div>
                                            <div className="agent-stats">
                                                <span className="stat">
                                                    <span className="stat-icon">👥</span>
                                                    {agent.contactCount} contacts
                                                </span>
                                                <span className="stat">
                                                    <span className="stat-icon">⚡</span>
                                                    {agent.jobCount} jobs
                                                </span>
                                                <span className="stat success">
                                                    ✓ {agent.successCount}
                                                </span>
                                                <span className="stat failure">
                                                    ✗ {agent.failureCount}
                                                </span>
                                            </div>
                                        </div>
                                        <div className={`agent-status ${agent.enabled ? 'enabled' : 'disabled'}`}>
                                            {agent.enabled ? '●' : '○'}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </section>

                {/* Jobs Container */}
                <section className="container jobs-container">
                    <div className="container-header">
                        <h2>
                            <span className="container-icon">⚡</span>
                            Jobs
                        </h2>
                        <div className="jobs-stats">
                            <span className="jobs-running">
                                {jobs.filter(j => j.status === 'running').length} running
                            </span>
                        </div>
                    </div>
                    <div className="container-body scrollable">
                        {jobs.length === 0 ? (
                            <div className="empty-state">
                                <div className="empty-icon">⚡</div>
                                <p>No jobs yet. Jobs are created when contacts send messages.</p>
                            </div>
                        ) : (
                            <div className="job-list">
                                {jobs.map(job => (
                                    <div key={job.jobId} className={`job-item status-${job.status}`}>
                                        <div className="job-agent">
                                            <span className="job-emoji">{job.agentEmoji}</span>
                                            <span className="job-name">{job.agentName}</span>
                                        </div>
                                        <div className="job-details">
                                            <div className="job-status">
                                                <span className={`status-badge ${job.status}`}>
                                                    {job.status}
                                                </span>
                                                {job.inferenceSteps > 0 && (
                                                    <span className="inference-count">
                                                        🧠 {job.inferenceSteps}
                                                    </span>
                                                )}
                                            </div>
                                            {job.responseMessage && (
                                                <div className="job-response">
                                                    "{job.responseMessage.slice(0, 50)}..."
                                                </div>
                                            )}
                                            {job.error && (
                                                <div className="job-error">
                                                    ❌ {job.error}
                                                </div>
                                            )}
                                        </div>
                                        <div className="job-meta">
                                            {job.durationMs && (
                                                <span className="job-duration">{job.durationMs}ms</span>
                                            )}
                                            <span className="job-time">
                                                {formatTime(job.startedAt)}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </section>
            </div>

            {/* Connect Dialog */}
            {showConnectDialog && (
                <div className="dialog-overlay" onClick={() => setShowConnectDialog(false)}>
                    <div className="dialog" onClick={e => e.stopPropagation()}>
                        <h3>Connect Telegram</h3>
                        <p>Enter your phone number to connect your Telegram account.</p>
                        <input
                            type="tel"
                            className="dialog-input"
                            placeholder="+1234567890"
                            value={phoneNumber}
                            onChange={e => setPhoneNumber(e.target.value)}
                        />
                        <div className="dialog-actions">
                            <button className="btn btn-secondary" onClick={() => setShowConnectDialog(false)}>
                                Cancel
                            </button>
                            <button className="btn btn-primary" onClick={connectTelegram}>
                                Connect
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Agent Detail Dialog */}
            {selectedAgent && (
                <div className="dialog-overlay" onClick={() => setSelectedAgent(null)}>
                    <div className="dialog dialog-large" onClick={e => e.stopPropagation()}>
                        <div className="dialog-header">
                            <span className="dialog-emoji">{selectedAgent.emoji}</span>
                            <h3>{selectedAgent.name}</h3>
                        </div>
                        <p>{selectedAgent.description}</p>
                        <div className="agent-detail-stats">
                            <div className="detail-stat">
                                <div className="detail-value">{selectedAgent.contactCount}</div>
                                <div className="detail-label">Contacts</div>
                            </div>
                            <div className="detail-stat">
                                <div className="detail-value">{selectedAgent.jobCount}</div>
                                <div className="detail-label">Jobs</div>
                            </div>
                            <div className="detail-stat">
                                <div className="detail-value">{selectedAgent.successCount}</div>
                                <div className="detail-label">Success</div>
                            </div>
                            <div className="detail-stat">
                                <div className="detail-value">{selectedAgent.failureCount}</div>
                                <div className="detail-label">Failed</div>
                            </div>
                        </div>
                        <div className="dialog-actions">
                            <button className="btn btn-secondary" onClick={() => setSelectedAgent(null)}>
                                Close
                            </button>
                            <a
                                href={`/agents/${selectedAgent.agentId}`}
                                className="btn btn-primary"
                            >
                                View Code →
                            </a>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - timestamp;

    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return date.toLocaleDateString();
}

// Create island for client-side hydration
export const NewDashboard = createIsland(NewDashboardImpl);
