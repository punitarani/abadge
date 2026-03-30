import { execFileAsync } from "./exec";
import type { Connector, ConnectorConfig, FetchedSecret, SecretReference } from "./interface";

/** Fetches secrets from Infisical via the `infisical` CLI. */
export class InfisicalConnector implements Connector {
  readonly type = "infisical";

  async fetchSecret(ref: SecretReference, config: ConnectorConfig): Promise<FetchedSecret> {
    const environment = config.environment as string | undefined;
    if (!environment) {
      throw new Error("InfisicalConnector requires 'environment' in config");
    }

    const args = ["secrets", "get", ref.name, `--env=${environment}`, "--plain"];
    if (config.secretPath) args.push(`--path=${config.secretPath as string}`);
    if (config.projectId) args.push(`--projectId=${config.projectId as string}`);

    const env = this.buildEnv(config);
    const { stdout } = await execFileAsync("infisical", args, { env });
    return { value: stdout.trim() };
  }

  async testConnection(config: ConnectorConfig): Promise<{ success: boolean; error?: string }> {
    try {
      const env = this.buildEnv(config);
      await execFileAsync("infisical", ["user"], { env });
      return { success: true };
    } catch {
      return { success: false, error: "Infisical CLI not authenticated. Run 'infisical login' first." };
    }
  }

  private buildEnv(config: ConnectorConfig): NodeJS.ProcessEnv {
    const env = { ...process.env };
    if (config.token) env.INFISICAL_TOKEN = config.token as string;
    if (config.clientId) env.INFISICAL_CLIENT_ID = config.clientId as string;
    if (config.clientSecret) env.INFISICAL_CLIENT_SECRET = config.clientSecret as string;
    if (config.siteUrl) env.INFISICAL_API_URL = config.siteUrl as string;
    return env;
  }
}
