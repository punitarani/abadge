// Auto-grants: grant an agent access to credentials matching a pattern.
// The SDK does not yet expose auto-grant methods, so this uses fetch directly
// against the /v1/auto-grants endpoint.

const API_URL = "http://localhost:8787";
const SESSION_TOKEN = "your-session-token";

async function createAutoGrant(body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${API_URL}/v1/auto-grants`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SESSION_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Auto-grant creation failed (${res.status}): ${text}`);
  }
  return res.json();
}

// Grant agent access to ALL staging credentials.
// Any new staging credential created later will automatically be accessible.
const stagingGrant = await createAutoGrant({
  agentId: "agent-id",
  matchEnvironment: "staging",
  allowedDeliveryModes: ["env_inject", "file_mount"],
});
console.log("Staging auto-grant:", stagingGrant);

// Grant agent access to credentials of a specific type with medium sensitivity
const tokenGrant = await createAutoGrant({
  agentId: "agent-id",
  matchType: "token",
  matchSensitivity: "medium",
});
console.log("Token auto-grant:", tokenGrant);

// Grant agent access to credentials for a specific service
const serviceGrant = await createAutoGrant({
  agentId: "agent-id",
  matchService: "stripe",
  allowedDeliveryModes: ["env_inject"],
});
console.log("Service auto-grant:", serviceGrant);
