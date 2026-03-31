import { execFileAsync } from "./exec";
import type { Connector, ConnectorConfig, FetchedSecret, SecretReference } from "./interface";

/** Fetches secrets from AWS Secrets Manager via the `aws` CLI. */
export class AwsSecretsManagerConnector implements Connector {
  readonly type = "aws_secrets_manager";

  async fetchSecret(ref: SecretReference, config: ConnectorConfig): Promise<FetchedSecret> {
    const args = [
      "secretsmanager",
      "get-secret-value",
      "--secret-id",
      ref.name,
      "--output",
      "json",
    ];
    if (config.region) args.push("--region", config.region as string);
    if (config.profile) args.push("--profile", config.profile as string);

    const { stdout } = await execFileAsync("aws", args);
    const result = JSON.parse(stdout) as {
      SecretString?: string;
      SecretBinary?: string;
      ARN?: string;
      VersionId?: string;
    };

    return {
      value: result.SecretString ?? Buffer.from(result.SecretBinary ?? "", "base64").toString(),
      metadata: {
        ...(result.ARN ? { arn: result.ARN } : {}),
        ...(result.VersionId ? { versionId: result.VersionId } : {}),
      },
    };
  }

  async testConnection(config: ConnectorConfig): Promise<{ success: boolean; error?: string }> {
    try {
      const args = ["sts", "get-caller-identity"];
      if (config.profile) args.push("--profile", config.profile as string);
      await execFileAsync("aws", args);
      return { success: true };
    } catch {
      return { success: false, error: "AWS CLI not configured. Run 'aws configure' first." };
    }
  }
}
