import { execFileAsync } from "./exec";
import type { Connector, ConnectorConfig, FetchedSecret, SecretReference } from "./interface";

/** Fetches secrets from Google Cloud Secret Manager via the `gcloud` CLI. */
export class GcloudSecretManagerConnector implements Connector {
  readonly type = "gcloud_secret_manager";

  async fetchSecret(ref: SecretReference, config: ConnectorConfig): Promise<FetchedSecret> {
    const project = config.project as string | undefined;
    if (!project) {
      throw new Error("GcloudSecretManagerConnector requires 'project' in config");
    }

    const version = ref.version ?? "latest";
    const args = [
      "secrets",
      "versions",
      "access",
      version,
      `--secret=${ref.name}`,
      `--project=${project}`,
    ];

    const { stdout } = await execFileAsync("gcloud", args);
    // Do NOT trim — gcloud outputs raw bytes; trimming would corrupt binary secrets
    return { value: stdout };
  }

  async testConnection(config: ConnectorConfig): Promise<{ success: boolean; error?: string }> {
    try {
      const args = ["auth", "print-access-token"];
      if (config.project) args.push(`--project=${config.project as string}`);

      await execFileAsync("gcloud", args);
      return { success: true };
    } catch {
      return {
        success: false,
        error: "gcloud CLI not authenticated. Run 'gcloud auth login' first.",
      };
    }
  }
}
