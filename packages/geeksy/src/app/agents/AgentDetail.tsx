'use client';

/**
 * Agent Detail Page - View and edit agent code
 */

import React, { useState, useEffect } from 'react';
import { createIsland } from 'melina/island';
import '../new-dashboard.css';

interface Agent {
    agentId: string;
    name: string;
    emoji: string;
    description: string;
    code: string;
    systemPrompt?: string;
    version: number;
    enabled: boolean;
    canCreateAgents: boolean;
    canAttachContacts: boolean;
    canSendMessages: boolean;
    contactCount: number;
    jobCount: number;
    successCount: number;
    failureCount: number;
    contacts?: Array<{ contactId: string; displayName: string }>;
}

function AgentDetailImpl({ agentId }: { agentId: string }) {
    const [agent, setAgent] = useState<Agent | null>(null);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState(false);
    const [code, setCode] = useState('');
    const [systemPrompt, setSystemPrompt] = useState('');

    useEffect(() => {
        fetchAgent();
    }, [agentId]);

    const fetchAgent = async () => {
        try {
            const res = await fetch(`/api/v2/agents/${agentId}`);
            if (res.ok) {
                const data = await res.json();
                setAgent(data);
                setCode(data.code);
                setSystemPrompt(data.systemPrompt || '');
            }
            setLoading(false);
        } catch (e) {
            console.error('Failed to fetch agent:', e);
            setLoading(false);
        }
    };

    const saveAgent = async () => {
        await fetch(`/api/v2/agents/${agentId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, systemPrompt }),
        });
        setEditing(false);
        fetchAgent();
    };

    const toggleEnabled = async () => {
        await fetch(`/api/v2/agents/${agentId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: !agent?.enabled }),
        });
        fetchAgent();
    };

    if (loading) {
        return (
            <div className="dashboard-loading">
                <div className="loader-emoji">🤖</div>
                <p>Loading agent...</p>
            </div>
        );
    }

    if (!agent) {
        return (
            <div className="dashboard-loading">
                <div className="loader-emoji">❌</div>
                <p>Agent not found</p>
                <a href="/" className="btn btn-primary">← Back to Dashboard</a>
            </div>
        );
    }

    return (
        <div className="agent-detail-page">
            <header className="agent-header">
                <a href="/" className="back-link">← Back</a>
                <div className="agent-title">
                    <span className="agent-emoji-large">{agent.emoji}</span>
                    <div>
                        <h1>{agent.name}</h1>
                        <p className="agent-description">{agent.description}</p>
                    </div>
                </div>
                <div className="agent-actions">
                    <button
                        className={`btn ${agent.enabled ? 'btn-danger' : 'btn-primary'}`}
                        onClick={toggleEnabled}
                    >
                        {agent.enabled ? 'Disable' : 'Enable'}
                    </button>
                </div>
            </header>

            <div className="agent-content">
                <div className="agent-sidebar">
                    <div className="sidebar-section">
                        <h3>Stats</h3>
                        <div className="stats-grid">
                            <div className="stat-box">
                                <div className="stat-value">{agent.contactCount}</div>
                                <div className="stat-label">Contacts</div>
                            </div>
                            <div className="stat-box">
                                <div className="stat-value">{agent.jobCount}</div>
                                <div className="stat-label">Jobs</div>
                            </div>
                            <div className="stat-box success">
                                <div className="stat-value">{agent.successCount}</div>
                                <div className="stat-label">Success</div>
                            </div>
                            <div className="stat-box failure">
                                <div className="stat-value">{agent.failureCount}</div>
                                <div className="stat-label">Failed</div>
                            </div>
                        </div>
                    </div>

                    <div className="sidebar-section">
                        <h3>Capabilities</h3>
                        <div className="capabilities">
                            <label>
                                <input type="checkbox" checked={agent.canCreateAgents} disabled />
                                <span>Can create agents</span>
                            </label>
                            <label>
                                <input type="checkbox" checked={agent.canAttachContacts} disabled />
                                <span>Can attach contacts</span>
                            </label>
                            <label>
                                <input type="checkbox" checked={agent.canSendMessages} disabled />
                                <span>Can send messages</span>
                            </label>
                        </div>
                    </div>

                    {agent.contacts && agent.contacts.length > 0 && (
                        <div className="sidebar-section">
                            <h3>Connected Contacts</h3>
                            <div className="contact-chips">
                                {agent.contacts.map(c => (
                                    <span key={c.contactId} className="contact-chip">
                                        {c.displayName}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="sidebar-section">
                        <h3>Version</h3>
                        <p className="version-info">v{agent.version}</p>
                    </div>
                </div>

                <div className="agent-code-section">
                    <div className="code-header">
                        <h3>System Prompt</h3>
                        {!editing && (
                            <button className="btn btn-secondary" onClick={() => setEditing(true)}>
                                Edit
                            </button>
                        )}
                        {editing && (
                            <div className="edit-actions">
                                <button className="btn btn-secondary" onClick={() => setEditing(false)}>
                                    Cancel
                                </button>
                                <button className="btn btn-primary" onClick={saveAgent}>
                                    Save
                                </button>
                            </div>
                        )}
                    </div>
                    <textarea
                        className="system-prompt-input"
                        value={systemPrompt}
                        onChange={(e) => setSystemPrompt(e.target.value)}
                        disabled={!editing}
                        placeholder="Optional system prompt for LLM calls..."
                    />

                    <div className="code-header">
                        <h3>Agent Code</h3>
                    </div>
                    <div className="code-editor">
                        <textarea
                            className="code-input"
                            value={code}
                            onChange={(e) => setCode(e.target.value)}
                            disabled={!editing}
                            spellCheck={false}
                        />
                    </div>
                </div>
            </div>

            <style>{`
                .agent-detail-page {
                    min-height: 100vh;
                    background: var(--bg-dark);
                }

                .agent-header {
                    display: flex;
                    align-items: center;
                    gap: 2rem;
                    padding: 1.5rem 2rem;
                    background: rgba(10, 10, 15, 0.95);
                    border-bottom: 1px solid var(--border-glow);
                }

                .back-link {
                    color: var(--text-secondary);
                    text-decoration: none;
                    padding: 0.5rem 1rem;
                    border-radius: 8px;
                    transition: all 0.2s;
                }

                .back-link:hover {
                    background: var(--bg-hover);
                    color: var(--text-primary);
                }

                .agent-title {
                    display: flex;
                    align-items: center;
                    gap: 1rem;
                    flex: 1;
                }

                .agent-emoji-large {
                    font-size: 3rem;
                }

                .agent-title h1 {
                    font-size: 1.5rem;
                    background: var(--gradient-primary);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                }

                .agent-description {
                    color: var(--text-secondary);
                    font-size: 0.9rem;
                }

                .agent-content {
                    display: grid;
                    grid-template-columns: 280px 1fr;
                    gap: 2rem;
                    padding: 2rem;
                    min-height: calc(100vh - 100px);
                }

                .agent-sidebar {
                    display: flex;
                    flex-direction: column;
                    gap: 1.5rem;
                }

                .sidebar-section {
                    background: var(--bg-card);
                    border: 1px solid var(--border-glow);
                    border-radius: 12px;
                    padding: 1.25rem;
                }

                .sidebar-section h3 {
                    font-size: 0.8rem;
                    text-transform: uppercase;
                    color: var(--text-muted);
                    margin-bottom: 1rem;
                }

                .stats-grid {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 0.75rem;
                }

                .stat-box {
                    text-align: center;
                    padding: 0.75rem;
                    background: rgba(0, 0, 0, 0.2);
                    border-radius: 8px;
                }

                .stat-box .stat-value {
                    font-size: 1.25rem;
                    font-weight: 700;
                    color: var(--accent-purple);
                }

                .stat-box.success .stat-value {
                    color: var(--accent-green);
                }

                .stat-box.failure .stat-value {
                    color: var(--accent-red);
                }

                .stat-box .stat-label {
                    font-size: 0.7rem;
                    color: var(--text-muted);
                }

                .capabilities label {
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                    margin-bottom: 0.5rem;
                    font-size: 0.85rem;
                    color: var(--text-secondary);
                }

                .contact-chips {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 0.5rem;
                }

                .contact-chip {
                    padding: 0.25rem 0.75rem;
                    background: rgba(139, 92, 246, 0.2);
                    border-radius: 20px;
                    font-size: 0.8rem;
                }

                .version-info {
                    color: var(--text-secondary);
                    font-family: monospace;
                }

                .agent-code-section {
                    display: flex;
                    flex-direction: column;
                    gap: 1rem;
                }

                .code-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }

                .code-header h3 {
                    font-size: 0.9rem;
                    color: var(--text-primary);
                }

                .edit-actions {
                    display: flex;
                    gap: 0.5rem;
                }

                .system-prompt-input {
                    width: 100%;
                    min-height: 80px;
                    padding: 1rem;
                    background: rgba(0, 0, 0, 0.3);
                    border: 1px solid var(--border-subtle);
                    border-radius: 12px;
                    color: var(--text-primary);
                    font-size: 0.9rem;
                    resize: vertical;
                }

                .code-editor {
                    flex: 1;
                    min-height: 400px;
                }

                .code-input {
                    width: 100%;
                    height: 100%;
                    min-height: 400px;
                    padding: 1rem;
                    background: rgba(0, 0, 0, 0.5);
                    border: 1px solid var(--border-subtle);
                    border-radius: 12px;
                    color: var(--accent-cyan);
                    font-family: 'JetBrains Mono', 'Fira Code', monospace;
                    font-size: 0.85rem;
                    line-height: 1.6;
                    resize: vertical;
                }

                .code-input:focus, .system-prompt-input:focus {
                    outline: none;
                    border-color: var(--accent-purple);
                }

                .code-input:disabled, .system-prompt-input:disabled {
                    opacity: 0.7;
                    cursor: not-allowed;
                }
            `}</style>
        </div>
    );
}

export const AgentDetail = createIsland(AgentDetailImpl);
