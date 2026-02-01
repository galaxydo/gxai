import { getAgentStats } from "../../../src/analytics";

export async function GET() {
    try {
        const agents = getAgentStats();
        return Response.json(agents);
    } catch (error) {
        console.error("Error fetching agents:", error);
        return Response.json({ error: "Failed to fetch agents" }, { status: 500 });
    }
}
