import type { ConnectorConfig, ExternalRef, FetchedSecret, HttpConnector } from "./interface";
import { optionalString, requireString } from "./interface";

const NAME = "Infisical";
const DEFAULT_SITE_URL = "https://app.infisical.com";

export class InfisicalHttpConnector implements HttpConnector {
  readonly type = "infisical";

  async fetchSecret(ref: ExternalRef, config: ConnectorConfig): Promise<FetchedSecret> {
    const token = requireString(NAME, config, "token");
    const siteUrl = (optionalString(NAME, config, "siteUrl") ?? DEFAULT_SITE_URL).replace(
      /\/+$/,
      "",
    );
    const environment = optionalString(NAME, config, "environment") ?? "dev";
    const secretPath = optionalString(NAME, config, "secretPath") ?? "/";

    if (!ref.name) {
      throw new Error("Infisical connector requires ref.name");
    }

    const url = new URL(`${siteUrl}/api/v3/secrets/raw/${encodeURIComponent(ref.name)}`);

    const projectId = optionalString(NAME, config, "projectId");
    if (projectId) {
      url.searchParams.set("workspaceId", projectId);
    }
    url.searchParams.set("environment", environment);
    url.searchParams.set("secretPath", secretPath);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Infisical API error (${res.status}): ${body}`);
    }

    const json = (await res.json()) as { secret?: { secretValue?: string } };
    const secretValue = json.secret?.secretValue;
    if (typeof secretValue !== "string") {
      throw new Error(`Infisical: unexpected response shape for secret "${ref.name}"`);
    }

    return { value: secretValue };
  }

  async testConnection(config: ConnectorConfig): Promise<{ success: boolean; error?: string }> {
    const token = requireString(NAME, config, "token");
    const siteUrl = (optionalString(NAME, config, "siteUrl") ?? DEFAULT_SITE_URL).replace(
      /\/+$/,
      "",
    );

    // Use /api/v2/organizations — works across all Infisical auth methods
    // (service tokens, universal auth, token auth). The token-auth renew
    // endpoint only works for one specific auth type.
    const res = await fetch(`${siteUrl}/api/v2/organizations`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const body = await res.text();
      return { success: false, error: `Infisical auth failed (${res.status}): ${body}` };
    }

    return { success: true };
  }
}
