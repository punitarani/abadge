import { execFileAsync } from "./exec";
import type { Connector, ConnectorConfig, FetchedSecret, SecretReference } from "./interface";

/** Fetches secrets from Doppler via the `doppler` CLI. */
export class DopplerConnector implements Connector {
  readonly type = "doppler";

  async fetchSecret(ref: SecretReference, config: ConnectorConfig): Promise<FetchedSecret> {
    const project = config.project as string | undefined;
    const configName = config.config as string | undefined;
    if (!project || !configName) {
      throw new Error("DopplerConnector requires 'project' and 'config' in config");
    }

    const args = [
      "secrets",
      "get",
      ref.name,
      "--plain",
      "--project",
      project,
      "--config",
      configName,
    ];
    const env = this.buildEnv(config);

    const { stdout } = await execFileAsync("doppler", args, { env });
    return { value: stdout.trim() };
  }

  async testConnection(config: ConnectorConfig): Promise<{ success: boolean; error?: string }> {
    try {
      const env = this.buildEnv(config);
      await execFileAsync("doppler", ["me"], { env });
      return { success: true };
    } catch {
      return { success: false, error: "Doppler CLI not authenticated. Run 'doppler login' first." };
    }
  }

  private buildEnv(config: ConnectorConfig): NodeJS.ProcessEnv {
    const env = { ...process.env };
    if (config.token) env.DOPPLER_TOKEN = config.token as string;
    return env;
  }
}
