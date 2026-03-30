import type { Connector, ConnectorConfig, FetchedSecret, SecretReference } from "./interface";

/** Fetches credentials from the abadge API itself. */
export class NativeConnector implements Connector {
  readonly type = "native";

  async fetchSecret(ref: SecretReference, config: ConnectorConfig): Promise<FetchedSecret> {
    const apiUrl = config.apiUrl as string | undefined;
    const token = config.token as string | undefined;
    if (!apiUrl || !token) {
      throw new Error("NativeConnector requires 'apiUrl' and 'token' in config");
    }

    const res = await fetch(`${apiUrl}/api/v1/credentials/access`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ credentialName: ref.name, deliveryMode: "reveal" }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Native API returned ${String(res.status)}: ${body}`);
    }

    const data = (await res.json()) as { value: string; metadata?: Record<string, string> };
    return { value: data.value, metadata: data.metadata };
  }

  async testConnection(config: ConnectorConfig): Promise<{ success: boolean; error?: string }> {
    const apiUrl = config.apiUrl as string | undefined;
    if (!apiUrl) {
      return { success: false, error: "Missing 'apiUrl' in config" };
    }

    try {
      const res = await fetch(`${apiUrl}/health`);
      if (res.ok) return { success: true };
      return { success: false, error: `Health check returned ${String(res.status)}` };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return { success: false, error: message };
    }
  }
}
