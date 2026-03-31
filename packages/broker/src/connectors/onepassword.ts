import { execFileAsync } from "./exec";
import type { Connector, ConnectorConfig, FetchedSecret, SecretReference } from "./interface";

/** Fetches secrets from 1Password via the `op` CLI. */
export class OnePasswordConnector implements Connector {
  readonly type = "onepassword";

  async fetchSecret(ref: SecretReference, config: ConnectorConfig): Promise<FetchedSecret> {
    const vault = (config.vault as string | undefined) ?? "Private";
    const path = ref.path ?? `op://${vault}/${ref.name}/password`;

    const { stdout } = await execFileAsync("op", ["read", path]);
    return { value: stdout.trim() };
  }

  async testConnection(_config: ConnectorConfig): Promise<{ success: boolean; error?: string }> {
    try {
      await execFileAsync("op", ["whoami"]);
      return { success: true };
    } catch {
      return { success: false, error: "1Password CLI not authenticated. Run 'op signin' first." };
    }
  }
}
