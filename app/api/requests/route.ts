import { getAllRequests } from "../../../src/analytics";

export async function GET() {
    try {
        const requests = getAllRequests();
        return Response.json(requests);
    } catch (error) {
        console.error("Error fetching requests:", error);
        return Response.json({ error: "Failed to fetch requests" }, { status: 500 });
    }
}
