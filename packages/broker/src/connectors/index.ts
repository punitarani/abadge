import type { ConnectorType } from "../types";
import { AwsSecretsManagerConnector } from "./aws";
import { BitwardenConnector } from "./bitwarden";
import { GcloudSecretManagerConnector } from "./gcloud-secret-manager";
import { InfisicalConnector } from "./infisical";
import type { Connector } from "./interface";
import { NativeConnector } from "./native";
import { OnePasswordConnector } from "./onepassword";

export { AwsSecretsManagerConnector } from "./aws";
export { BitwardenConnector } from "./bitwarden";
export { GcloudSecretManagerConnector } from "./gcloud-secret-manager";
export { InfisicalConnector } from "./infisical";
export type { Connector, ConnectorConfig, FetchedSecret, SecretReference } from "./interface";
export { NativeConnector } from "./native";
export { OnePasswordConnector } from "./onepassword";

export function createConnector(type: ConnectorType): Connector {
  switch (type) {
    case "native":
      return new NativeConnector();
    case "onepassword":
      return new OnePasswordConnector();
    case "aws_secrets_manager":
      return new AwsSecretsManagerConnector();
    case "bitwarden":
      return new BitwardenConnector();
    case "infisical":
      return new InfisicalConnector();
    case "gcloud_secret_manager":
      return new GcloudSecretManagerConnector();
  }
}
