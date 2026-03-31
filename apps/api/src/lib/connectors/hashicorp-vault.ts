import type { ConnectorConfig, ExternalRef, FetchedSecret, HttpConnector } from "./interface";
import { optionalString, requireString } from "./interface";

const NAME = "HashiCorp Vault";

export class HashiCorpVaultHttpConnector implements HttpConnector {
  readonly type = "hashicorp_vault";

  async fetchSecret(ref: ExternalRef, config: ConnectorConfig): Promise<FetchedSecret> {
    const addr = requireString(NAME, config, "addr").replace(/\/+$/, "");
    const token = requireString(NAME, config, "token");
    const mount = optionalString(NAME, config, "mount") ?? "secret";
    const namespace = optionalString(NAME, config, "namespace");

    const secretPath = ref.path ?? ref.name;
    if (!secretPath) {
      throw new Error("HashiCorp Vault connector requires ref.path or ref.name");
    }

    const url = `${addr}/v1/${mount}/data/${secretPath}`;
    const headers: Record<string, string> = { "X-Vault-Token": token };
    if (namespace) {
      headers["X-Vault-Namespace"] = namespace;
    }

    const res = await fetch(url, { headers });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Vault API error (${res.status}): ${body}`);
    }

    const json = (await res.json()) as { data?: { data?: Record<string, unknown> } };
    const data = json.data?.data;
    if (!data || typeof data !== "object") {
      throw new Error(`Vault: unexpected response shape for path "${secretPath}"`);
    }

    // Use ref.name as field key if present, else return first value
    let value: string;
    if (ref.name && ref.name in data) {
      value = String(data[ref.name]);
    } else {
      const first = Object.entries(data)[0];
      if (!first) {
        throw new Error(`Vault: no keys found at path "${secretPath}"`);
      }
      value = String(first[1]);
    }

    return { value };
  }

  async testConnection(config: ConnectorConfig): Promise<{ success: boolean; error?: string }> {
    const addr = requireString(NAME, config, "addr").replace(/\/+$/, "");
    const token = requireString(NAME, config, "token");

    const res = await fetch(`${addr}/v1/sys/health`, {
      headers: { "X-Vault-Token": token },
    });

    if (!res.ok) {
      const body = await res.text();
      return { success: false, error: `Vault health check failed (${res.status}): ${body}` };
    }

    return { success: true };
  }
}
