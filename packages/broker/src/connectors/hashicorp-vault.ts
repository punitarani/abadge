import { execFileAsync } from "./exec";
import type { Connector, ConnectorConfig, FetchedSecret, SecretReference } from "./interface";

/** Fetches secrets from HashiCorp Vault via the `vault` CLI (KV v2). */
export class HashicorpVaultConnector implements Connector {
  readonly type = "hashicorp_vault" as const;

  async fetchSecret(ref: SecretReference, config: ConnectorConfig): Promise<FetchedSecret> {
    const mount = (config.mount as string | undefined) ?? "secret";
    const field = ref.path ?? "value";
    const args = ["kv", "get", `-mount=${mount}`, `-field=${field}`, ref.name];
    const env = this.buildEnv(config);

    const { stdout } = await execFileAsync("vault", args, { env });
    return { value: stdout.trim() };
  }

  async testConnection(config: ConnectorConfig): Promise<{ success: boolean; error?: string }> {
    try {
      const env = this.buildEnv(config);
      const { stdout } = await execFileAsync("vault", ["status", "-format=json"], { env });
      const status = JSON.parse(stdout) as { sealed: boolean };
      if (status.sealed) return { success: false, error: "Vault is sealed." };
      return { success: true };
    } catch {
      return {
        success: false,
        error: "Vault CLI not available or server unreachable. Check VAULT_ADDR and VAULT_TOKEN.",
      };
    }
  }

  private buildEnv(config: ConnectorConfig): NodeJS.ProcessEnv {
    // biome-ignore lint/style/noRestrictedGlobals: broker needs process.env to construct child process environment
    const env = { ...process.env };
    if (config.addr) env.VAULT_ADDR = config.addr as string;
    if (config.token) env.VAULT_TOKEN = config.token as string;
    if (config.namespace) env.VAULT_NAMESPACE = config.namespace as string;
    return env;
  }
}
