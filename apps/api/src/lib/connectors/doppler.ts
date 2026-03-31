import type { ConnectorConfig, ExternalRef, FetchedSecret, HttpConnector } from "./interface";
import { requireString } from "./interface";

export class DopplerHttpConnector implements HttpConnector {
  readonly type = "doppler";

  async fetchSecret(ref: ExternalRef, config: ConnectorConfig): Promise<FetchedSecret> {
    const token = requireString("Doppler", config, "token");
    const project = requireString("Doppler", config, "project");
    const dopplerConfig = requireString("Doppler", config, "config");

    if (!ref.name) {
      throw new Error("Doppler connector requires ref.name");
    }

    const url = new URL("https://api.doppler.com/v3/configs/config/secret");
    url.searchParams.set("name", ref.name);
    url.searchParams.set("project", project);
    url.searchParams.set("config", dopplerConfig);

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Doppler API error (${res.status}): ${body}`);
    }

    const json = (await res.json()) as { value?: { raw?: string } };
    const raw = json.value?.raw;
    if (typeof raw !== "string") {
      throw new Error(`Doppler: unexpected response shape for secret "${ref.name}"`);
    }

    return { value: raw };
  }

  async testConnection(config: ConnectorConfig): Promise<{ success: boolean; error?: string }> {
    const token = requireString("Doppler", config, "token");

    const res = await fetch("https://api.doppler.com/v3/me", {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const body = await res.text();
      return { success: false, error: `Doppler auth failed (${res.status}): ${body}` };
    }

    return { success: true };
  }
}
