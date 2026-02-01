'use client';

import { useState, useEffect, useRef } from 'react';
import { island } from 'melina/island';

interface Agent {
    name: string;
    port: number;
    emoji: string;
    description: string;
    running: boolean;
    pid?: number;
}

interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    agentResults?: Record<string, any>;
    timestamp: number;
}

function MultiAgentChatImpl() {
    const [agents, setAgents] = useState<Agent[]>([]);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Fetch agent statuses
    const fetchAgents = async () => {
        try {
            const res = await fetch('/api/processes');
            const data = await res.json() as Agent[];
            setAgents(data);
        } catch (e) {
            console.error('Failed to fetch agents:', e);
        }
    };

    // Fetch chat history
    const fetchHistory = async () => {
        try {
            const res = await fetch('/api/chat');
            const data = await res.json() as ChatMessage[];
            setMessages(data);
        } catch (e) {
            console.error('Failed to fetch history:', e);
        }
    };

    useEffect(() => {
        fetchAgents();
        fetchHistory();
        const interval = setInterval(fetchAgents, 5000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // Start an agent
    const startAgent = async (name: string) => {
        setIsRefreshing(true);
        try {
            await fetch('/api/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
            });
            await fetchAgents();
        } catch (e) {
            console.error('Failed to start agent:', e);
        }
        setIsRefreshing(false);
    };

    // Stop an agent
    const stopAgent = async (name: string) => {
        setIsRefreshing(true);
        try {
            await fetch('/api/stop', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
            });
            await fetchAgents();
        } catch (e) {
            console.error('Failed to stop agent:', e);
        }
        setIsRefreshing(false);
    };

    // Start all agents
    const startAllAgents = async () => {
        setIsRefreshing(true);
        for (const agent of agents) {
            if (!agent.running) {
                await startAgent(agent.name);
            }
        }
        setIsRefreshing(false);
    };

    // Send message
    const sendMessage = async () => {
        if (!input.trim() || isLoading) return;

        const prompt = input.trim();
        setInput('');
        setIsLoading(true);

        // Optimistically add user message
        const userMessage: ChatMessage = {
            id: `user-${Date.now()}`,
            role: 'user',
            content: prompt,
            timestamp: Date.now(),
        };
        setMessages(prev => [...prev, userMessage]);

        try {
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt }),
            });
            const data = await res.json();

            // Update with actual response
            setMessages(prev => [
                ...prev.filter(m => m.id !== userMessage.id),
                data.userMessage,
                data.assistantMessage,
            ]);
        } catch (e) {
            console.error('Failed to send message:', e);
        }

        setIsLoading(false);
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    };

    const runningCount = agents.filter(a => a.running).length;

    const renderAgentResult = (agentName: string, data: any) => {
        if (data.error) {
            return (
                <div className="agent-result" key={agentName}>
                    <div className="agent-result-header">
                        <span>{data.emoji}</span>
                        <span>{agentName}</span>
                    </div>
                    <div className="agent-result-body">
                        <p className="error-result">⚠️ {data.error}</p>
                    </div>
                </div>
            );
        }

        const result = data.result;
        return (
            <div className="agent-result" key={agentName}>
                <div className="agent-result-header">
                    <span>{data.emoji}</span>
                    <span>{agentName}</span>
                </div>
                <div className="agent-result-body">
                    {Object.entries(result || {}).map(([key, value]) => (
                        <div className="result-field" key={key}>
                            <div className="result-field-label">{key.replace(/([A-Z])/g, ' $1').trim()}</div>
                            <div className={`result-field-value ${key === 'poem' ? 'poem' : ''}`}>
                                {Array.isArray(value) ? (
                                    <ul className="result-list">
                                        {(value as string[]).map((item, i) => (
                                            <li key={i}>{item}</li>
                                        ))}
                                    </ul>
                                ) : typeof value === 'object' ? (
                                    <ul className="result-list">
                                        {Object.entries(value as Record<string, string>).map(([k, v]) => (
                                            <li key={k}><strong>{k}:</strong> {v}</li>
                                        ))}
                                    </ul>
                                ) : (
                                    String(value)
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    return (
        <>
            {/* Sidebar - Agent Process Manager */}
            <aside className="sidebar">
                <h2>🔌 Agent Processes</h2>
                <div className="agent-list">
                    {agents.map((agent) => (
                        <div key={agent.name} className={`agent-item ${agent.running ? 'running' : ''}`}>
                            <div className="agent-item-header">
                                <div className="agent-name">
                                    <span className="agent-emoji">{agent.emoji}</span>
                                    {agent.name}
                                </div>
                                <div className="agent-status">
                                    <span className={`status-indicator ${agent.running ? 'running' : ''}`}></span>
                                    {agent.running ? 'Running' : 'Stopped'}
                                </div>
                            </div>
                            <div className="agent-description">{agent.description}</div>
                            <div className="agent-actions">
                                {agent.running ? (
                                    <button
                                        className="btn btn-stop"
                                        onClick={() => stopAgent(agent.name)}
                                        disabled={isRefreshing}
                                    >
                                        ⏹ Stop
                                    </button>
                                ) : (
                                    <button
                                        className="btn btn-start"
                                        onClick={() => startAgent(agent.name)}
                                        disabled={isRefreshing}
                                    >
                                        ▶ Start
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
                <button className="btn btn-start-all" onClick={startAllAgents} disabled={isRefreshing}>
                    🚀 Start All Agents
                </button>
            </aside>

            {/* Chat Area */}
            <main className="chat-area">
                <div className="chat-header">
                    <h2>💬 Chat with Agents</h2>
                    <span className={`running-count ${runningCount > 0 ? 'active' : ''}`}>
                        {runningCount} / {agents.length} agents running
                    </span>
                </div>

                <div className="messages">
                    {messages.length === 0 && !isLoading ? (
                        <div className="empty-state">
                            <div className="empty-icon">💬</div>
                            <h3>Start a conversation</h3>
                            <p>Type a message to chat with all running agents simultaneously</p>
                        </div>
                    ) : (
                        <>
                            {messages.map((message) => (
                                <div key={message.id} className={`message ${message.role}`}>
                                    <div className="message-avatar">
                                        {message.role === 'user' ? '👤' : '🤖'}
                                    </div>
                                    <div className="message-content">
                                        <div className="message-text">{message.content}</div>
                                        {message.agentResults && (
                                            <div className="agent-results">
                                                {Object.entries(message.agentResults).map(([name, data]) =>
                                                    renderAgentResult(name, data)
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                            {isLoading && (
                                <div className="message assistant">
                                    <div className="message-avatar">🤖</div>
                                    <div className="message-content">
                                        <div className="loading-message">
                                            Processing with {runningCount} agents
                                            <div className="loading-dots">
                                                <span></span>
                                                <span></span>
                                                <span></span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                    <div ref={messagesEndRef} />
                </div>

                <div className="chat-input-container">
                    <div className="chat-input-wrapper">
                        <input
                            type="text"
                            className="chat-input"
                            placeholder={runningCount > 0 ? "Type your message..." : "Start some agents first..."}
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={handleKeyPress}
                            disabled={isLoading || runningCount === 0}
                        />
                        <button
                            className="btn-send"
                            onClick={sendMessage}
                            disabled={isLoading || !input.trim() || runningCount === 0}
                        >
                            Send →
                        </button>
                    </div>
                </div>
            </main>
        </>
    );
}

export const MultiAgentChat = island(MultiAgentChatImpl, 'MultiAgentChat');
