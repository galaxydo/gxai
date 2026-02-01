'use client';

import { useState, useEffect } from 'react';
import { island } from 'melina/island';

interface InferenceRequest {
    id: string;
    agentName: string;
    llm: string;
    timestamp: number;
    duration: number;
    status: 'success' | 'error' | 'pending';
    input: Record<string, any>;
    output: Record<string, any>;
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

interface AgentStats {
    name: string;
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    avgDuration: number;
    lastUsed: number;
}

const PREVIEW_LIMIT = 5;

function AnalyticsDashboardImpl() {
    const [requests, setRequests] = useState<InferenceRequest[]>([]);
    const [agents, setAgents] = useState<AgentStats[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
    const [fullPageAgent, setFullPageAgent] = useState<string | null>(null);
    const [searchFilters, setSearchFilters] = useState<Record<string, Record<string, string>>>({});

    const fetchData = async () => {
        try {
            const [requestsRes, agentsRes] = await Promise.all([
                fetch('/api/requests'),
                fetch('/api/agents')
            ]);

            if (!requestsRes.ok || !agentsRes.ok) {
                throw new Error('Failed to fetch data');
            }

            const requestsData = await requestsRes.json() as InferenceRequest[];
            const agentsData = await agentsRes.json() as AgentStats[];

            setRequests(requestsData);
            setAgents(agentsData);
            setError(null);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Unknown error');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 10000);
        return () => clearInterval(interval);
    }, []);

    // Get all unique fields for an agent's requests
    const getAgentFields = (agentName: string): { inputFields: string[]; outputFields: string[] } => {
        const agentRequests = requests.filter(r => r.agentName === agentName);
        const inputFields = new Set<string>();
        const outputFields = new Set<string>();

        agentRequests.forEach(req => {
            if (req.input && typeof req.input === 'object') {
                Object.keys(req.input).forEach(key => inputFields.add(key));
            }
            if (req.output && typeof req.output === 'object') {
                Object.keys(req.output).forEach(key => outputFields.add(key));
            }
        });

        return {
            inputFields: Array.from(inputFields),
            outputFields: Array.from(outputFields)
        };
    };

    // Get filtered requests for an agent
    const getFilteredRequests = (agentName: string): InferenceRequest[] => {
        const agentRequests = requests.filter(r => r.agentName === agentName);
        const filters = searchFilters[agentName] || {};

        return agentRequests.filter(req => {
            return Object.entries(filters).every(([key, searchValue]) => {
                if (!searchValue) return true;

                const [type, field] = key.split(':');
                const data = type === 'input' ? req.input : req.output;
                const value = field ? data?.[field] : undefined;

                if (value === undefined || value === null) return false;

                const strValue = typeof value === 'object'
                    ? JSON.stringify(value)
                    : String(value);

                return strValue.toLowerCase().includes(searchValue.toLowerCase());
            });
        });
    };

    const formatDuration = (ms: number): string => {
        if (ms < 1000) return `${ms}ms`;
        if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
        return `${(ms / 60000).toFixed(1)}m`;
    };

    const formatTimestamp = (ts: number): string => {
        const date = new Date(ts);
        return date.toLocaleTimeString();
    };

    const formatDate = (ts: number): string => {
        const date = new Date(ts);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    };

    const formatValue = (value: any): string => {
        if (value === undefined || value === null) return '-';
        if (typeof value === 'object') return JSON.stringify(value);
        return String(value);
    };

    const truncateValue = (value: string, maxLength: number = 50): string => {
        if (value.length <= maxLength) return value;
        return value.substring(0, maxLength) + '...';
    };

    const updateFilter = (agentName: string, key: string, value: string) => {
        setSearchFilters(prev => ({
            ...prev,
            [agentName]: {
                ...(prev[agentName] || {}),
                [key]: value
            }
        }));
    };

    const totalRequests = requests.length;
    const successfulRequests = requests.filter(r => r.status === 'success').length;
    const failedRequests = requests.filter(r => r.status === 'error').length;
    const avgDuration = requests.length > 0
        ? Math.round(requests.reduce((acc, r) => acc + r.duration, 0) / requests.length)
        : 0;

    if (isLoading) {
        return (
            <div className="loading-state">
                <div className="loading-spinner">⏳</div>
                <p>Loading analytics...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="error-state">
                <div className="error-icon">❌</div>
                <h3>Error loading analytics</h3>
                <p>{error}</p>
                <button className="btn btn-primary" onClick={fetchData}>Retry</button>
            </div>
        );
    }

    // Full Page Agent View
    if (fullPageAgent) {
        const agent = agents.find(a => a.name === fullPageAgent);
        const { inputFields, outputFields } = getAgentFields(fullPageAgent);
        const filteredRequests = getFilteredRequests(fullPageAgent);
        const agentFilters = searchFilters[fullPageAgent] || {};

        return (
            <div className="full-page-agent animate-in">
                {/* Header */}
                <div className="full-page-header">
                    <button className="btn btn-ghost" onClick={() => setFullPageAgent(null)}>
                        ← Back to Agents
                    </button>
                    <div className="full-page-title">
                        <div className="agent-icon large">
                            {fullPageAgent.charAt(0).toUpperCase()}
                        </div>
                        <div>
                            <h1>{fullPageAgent}</h1>
                            <div className="agent-header-stats">
                                <span className="stat-pill">{agent?.totalRequests || 0} requests</span>
                                <span className="stat-pill success">{agent?.successfulRequests || 0} ✓</span>
                                {(agent?.failedRequests || 0) > 0 && (
                                    <span className="stat-pill error">{agent?.failedRequests} ✗</span>
                                )}
                                <span className="stat-pill">{formatDuration(agent?.avgDuration || 0)} avg</span>
                            </div>
                        </div>
                    </div>
                    <button className="btn btn-ghost" onClick={fetchData}>
                        🔄 Refresh
                    </button>
                </div>

                {/* Stats Cards */}
                <div className="stats-grid compact">
                    <div className="stat-card">
                        <div className="stat-label">Total</div>
                        <div className="stat-value">{agent?.totalRequests || 0}</div>
                    </div>
                    <div className="stat-card success">
                        <div className="stat-label">Successful</div>
                        <div className="stat-value">{agent?.successfulRequests || 0}</div>
                    </div>
                    <div className="stat-card error">
                        <div className="stat-label">Failed</div>
                        <div className="stat-value">{agent?.failedRequests || 0}</div>
                    </div>
                    <div className="stat-card info">
                        <div className="stat-label">Avg Duration</div>
                        <div className="stat-value">{formatDuration(agent?.avgDuration || 0)}</div>
                    </div>
                </div>

                {/* Full Table */}
                <div className="full-page-table-container">
                    <div className="table-header-bar">
                        <h3>📋 All Requests</h3>
                        <span className="results-count">
                            Showing {filteredRequests.length} of {requests.filter(r => r.agentName === fullPageAgent).length} requests
                        </span>
                        {Object.keys(agentFilters).some(k => agentFilters[k]) && (
                            <button
                                className="btn btn-ghost btn-sm"
                                onClick={() => setSearchFilters(prev => ({ ...prev, [fullPageAgent]: {} }))}
                            >
                                Clear Filters
                            </button>
                        )}
                    </div>

                    <div className="fields-table-wrapper full-height">
                        <table className="fields-table">
                            <thead>
                                <tr>
                                    <th className="col-status">Status</th>
                                    <th className="col-datetime">Date & Time</th>
                                    <th className="col-duration">Duration</th>
                                    <th className="col-llm">LLM</th>
                                    {inputFields.map(field => (
                                        <th key={`input-${field}`} className="col-input">
                                            <div className="col-header">
                                                <span className="field-type-badge input">IN</span>
                                                <span className="field-name">{field}</span>
                                            </div>
                                            <input
                                                type="text"
                                                className="column-filter"
                                                placeholder={`Filter ${field}...`}
                                                value={agentFilters[`input:${field}`] || ''}
                                                onChange={(e) => updateFilter(fullPageAgent, `input:${field}`, e.target.value)}
                                            />
                                        </th>
                                    ))}
                                    {outputFields.map(field => (
                                        <th key={`output-${field}`} className="col-output">
                                            <div className="col-header">
                                                <span className="field-type-badge output">OUT</span>
                                                <span className="field-name">{field}</span>
                                            </div>
                                            <input
                                                type="text"
                                                className="column-filter"
                                                placeholder={`Filter ${field}...`}
                                                value={agentFilters[`output:${field}`] || ''}
                                                onChange={(e) => updateFilter(fullPageAgent, `output:${field}`, e.target.value)}
                                            />
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {filteredRequests.length === 0 ? (
                                    <tr>
                                        <td colSpan={4 + inputFields.length + outputFields.length}>
                                            <div className="empty-table-state">
                                                No matching requests found
                                            </div>
                                        </td>
                                    </tr>
                                ) : (
                                    filteredRequests.map((request) => (
                                        <tr key={request.id} className={`status-${request.status}`}>
                                            <td className="col-status">
                                                <span className={`status-badge ${request.status}`}>
                                                    <span className="status-dot"></span>
                                                    {request.status === 'success' ? '✓' : request.status === 'error' ? '✗' : '○'}
                                                </span>
                                            </td>
                                            <td className="col-datetime">
                                                {formatDate(request.timestamp)}
                                            </td>
                                            <td className="col-duration">
                                                {formatDuration(request.duration)}
                                            </td>
                                            <td className="col-llm">
                                                <span className="llm-badge">{request.llm}</span>
                                            </td>
                                            {inputFields.map(field => (
                                                <td key={`input-${field}`} className="col-input">
                                                    <div className="cell-value" title={formatValue(request.input?.[field])}>
                                                        {truncateValue(formatValue(request.input?.[field]))}
                                                    </div>
                                                </td>
                                            ))}
                                            {outputFields.map(field => (
                                                <td key={`output-${field}`} className="col-output">
                                                    <div className="cell-value" title={formatValue(request.output?.[field])}>
                                                        {request.status === 'error' && field === 'error'
                                                            ? <span className="error-text">{request.error || 'Error'}</span>
                                                            : truncateValue(formatValue(request.output?.[field]))}
                                                    </div>
                                                </td>
                                            ))}
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        );
    }

    // Main Dashboard View
    return (
        <>
            {/* Stats Overview */}
            <div className="stats-grid">
                <div className="stat-card">
                    <div className="stat-label">Total Requests</div>
                    <div className="stat-value">{totalRequests}</div>
                </div>
                <div className="stat-card success">
                    <div className="stat-label">Successful</div>
                    <div className="stat-value">{successfulRequests}</div>
                </div>
                <div className="stat-card error">
                    <div className="stat-label">Failed</div>
                    <div className="stat-value">{failedRequests}</div>
                </div>
                <div className="stat-card info">
                    <div className="stat-label">Avg Duration</div>
                    <div className="stat-value">{formatDuration(avgDuration)}</div>
                </div>
            </div>

            <div className="toolbar">
                <h2>🤖 Agents</h2>
                <button className="btn btn-ghost" onClick={fetchData}>
                    🔄 Refresh
                </button>
            </div>

            {agents.length === 0 ? (
                <div className="empty-state">
                    <div className="empty-icon">🤖</div>
                    <h3>No agents registered yet</h3>
                    <p>Configure an agent with an analytics hook to start tracking</p>
                </div>
            ) : (
                <div className="agents-list">
                    {agents.map((agent) => {
                        const isExpanded = expandedAgent === agent.name;
                        const { inputFields, outputFields } = getAgentFields(agent.name);
                        const allFilteredRequests = getFilteredRequests(agent.name);
                        const previewRequests = allFilteredRequests.slice(0, PREVIEW_LIMIT);
                        const hasMore = allFilteredRequests.length > PREVIEW_LIMIT;
                        const totalAgentRequests = requests.filter(r => r.agentName === agent.name).length;
                        const agentFilters = searchFilters[agent.name] || {};

                        return (
                            <div key={agent.name} className={`agent-section ${isExpanded ? 'expanded' : ''}`}>
                                {/* Agent Header */}
                                <div
                                    className="agent-section-header"
                                    onClick={() => setExpandedAgent(isExpanded ? null : agent.name)}
                                >
                                    <div className="agent-header-left">
                                        <div className="agent-icon">
                                            {agent.name.charAt(0).toUpperCase()}
                                        </div>
                                        <div className="agent-header-info">
                                            <h3>{agent.name}</h3>
                                            <div className="agent-header-stats">
                                                <span className="stat-pill">{agent.totalRequests} requests</span>
                                                <span className="stat-pill success">{agent.successfulRequests} ✓</span>
                                                {agent.failedRequests > 0 && (
                                                    <span className="stat-pill error">{agent.failedRequests} ✗</span>
                                                )}
                                                <span className="stat-pill">{formatDuration(agent.avgDuration)} avg</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="agent-header-right">
                                        <span className="expand-icon">{isExpanded ? '▼' : '▶'}</span>
                                    </div>
                                </div>

                                {/* Agent Preview Table */}
                                {isExpanded && (
                                    <div className="agent-table-container animate-in">
                                        {/* Preview Table */}
                                        <div className="fields-table-wrapper">
                                            <table className="fields-table">
                                                <thead>
                                                    <tr>
                                                        <th className="col-status">Status</th>
                                                        <th className="col-time">Time</th>
                                                        <th className="col-duration">Duration</th>
                                                        {inputFields.map(field => (
                                                            <th key={`input-${field}`} className="col-input">
                                                                <div className="col-header">
                                                                    <span className="field-type-badge input">IN</span>
                                                                    <span className="field-name">{field}</span>
                                                                </div>
                                                                <input
                                                                    type="text"
                                                                    className="column-filter"
                                                                    placeholder={`Filter...`}
                                                                    value={agentFilters[`input:${field}`] || ''}
                                                                    onChange={(e) => updateFilter(agent.name, `input:${field}`, e.target.value)}
                                                                    onClick={(e) => e.stopPropagation()}
                                                                />
                                                            </th>
                                                        ))}
                                                        {outputFields.map(field => (
                                                            <th key={`output-${field}`} className="col-output">
                                                                <div className="col-header">
                                                                    <span className="field-type-badge output">OUT</span>
                                                                    <span className="field-name">{field}</span>
                                                                </div>
                                                                <input
                                                                    type="text"
                                                                    className="column-filter"
                                                                    placeholder={`Filter...`}
                                                                    value={agentFilters[`output:${field}`] || ''}
                                                                    onChange={(e) => updateFilter(agent.name, `output:${field}`, e.target.value)}
                                                                    onClick={(e) => e.stopPropagation()}
                                                                />
                                                            </th>
                                                        ))}
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {previewRequests.length === 0 ? (
                                                        <tr>
                                                            <td colSpan={3 + inputFields.length + outputFields.length}>
                                                                <div className="empty-table-state">
                                                                    No matching requests found
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    ) : (
                                                        previewRequests.map((request) => (
                                                            <tr key={request.id} className={`status-${request.status}`}>
                                                                <td className="col-status">
                                                                    <span className={`status-badge ${request.status}`}>
                                                                        <span className="status-dot"></span>
                                                                        {request.status === 'success' ? '✓' : request.status === 'error' ? '✗' : '○'}
                                                                    </span>
                                                                </td>
                                                                <td className="col-time">
                                                                    {formatTimestamp(request.timestamp)}
                                                                </td>
                                                                <td className="col-duration">
                                                                    {formatDuration(request.duration)}
                                                                </td>
                                                                {inputFields.map(field => (
                                                                    <td key={`input-${field}`} className="col-input">
                                                                        <div className="cell-value" title={formatValue(request.input?.[field])}>
                                                                            {truncateValue(formatValue(request.input?.[field]))}
                                                                        </div>
                                                                    </td>
                                                                ))}
                                                                {outputFields.map(field => (
                                                                    <td key={`output-${field}`} className="col-output">
                                                                        <div className="cell-value" title={formatValue(request.output?.[field])}>
                                                                            {request.status === 'error' && field === 'error'
                                                                                ? <span className="error-text">{request.error || 'Error'}</span>
                                                                                : truncateValue(formatValue(request.output?.[field]))}
                                                                        </div>
                                                                    </td>
                                                                ))}
                                                            </tr>
                                                        ))
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>

                                        {/* Footer with View All button */}
                                        <div className="table-footer">
                                            <span className="results-count">
                                                Showing {previewRequests.length} of {totalAgentRequests} requests
                                                {allFilteredRequests.length !== totalAgentRequests && ` (${allFilteredRequests.length} filtered)`}
                                            </span>
                                            <div className="footer-actions">
                                                {Object.keys(agentFilters).some(k => agentFilters[k]) && (
                                                    <button
                                                        className="btn btn-ghost btn-sm"
                                                        onClick={() => setSearchFilters(prev => ({ ...prev, [agent.name]: {} }))}
                                                    >
                                                        Clear Filters
                                                    </button>
                                                )}
                                                {(hasMore || totalAgentRequests > PREVIEW_LIMIT) && (
                                                    <button
                                                        className="btn btn-primary btn-sm view-all-btn"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setFullPageAgent(agent.name);
                                                        }}
                                                    >
                                                        View All {totalAgentRequests} Requests →
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </>
    );
}

export const AnalyticsDashboard = island(AnalyticsDashboardImpl, 'AnalyticsDashboard');
