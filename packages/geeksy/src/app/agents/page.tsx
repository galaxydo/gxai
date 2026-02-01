/**
 * Agent Detail Page - Server Component
 */

import { AgentDetail } from './AgentDetail';
import '../new-dashboard.css';

export default function AgentPage({
    searchParams
}: {
    searchParams: { id?: string }
}) {
    const agentId = searchParams.id || '';

    return <AgentDetail agentId={agentId} />;
}
