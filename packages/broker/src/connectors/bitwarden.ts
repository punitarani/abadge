import { execFileAsync } from "./exec";
import type { Connector, ConnectorConfig, FetchedSecret, SecretReference } from "./interface";

/** Fetches secrets from Bitwarden via the `bw` CLI. */
export class BitwardenConnector implements Connector {
  readonly type = "bitwarden";

  async fetchSecret(ref: SecretReference, config: ConnectorConfig): Promise<FetchedSecret> {
    const args = ["get", "password", ref.name];
    if (config.session) args.push("--session", config.session as string);

    const env = this.buildEnv(config);
    const { stdout } = await execFileAsync("bw", args, { env });
    return { value: stdout.trim() };
  }

  async testConnection(config: ConnectorConfig): Promise<{ success: boolean; error?: string }> {
    try {
      const args = ["status"];
      if (config.session) args.push("--session", config.session as string);

      const env = this.buildEnv(config);
      const { stdout } = await execFileAsync("bw", args, { env });
      const status = JSON.parse(stdout) as { status: string };
      if (status.status === "unlocked") return { success: true };
      return {
        success: false,
        error: `Bitwarden vault is ${status.status}. Run 'bw unlock' first.`,
      };
    } catch {
      return {
        success: false,
        error: "Bitwarden CLI not available or not logged in. Run 'bw login' first.",
      };
    }
  }

  private buildEnv(config: ConnectorConfig): NodeJS.ProcessEnv {
    const env = { ...process.env };
    if (config.session) env.BW_SESSION = config.session as string;
    return env;
  }
}
