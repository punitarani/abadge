import type { ConnectorType } from "../types";
import { AwsSecretsManagerConnector } from "./aws";
import { GcloudSecretManagerConnector } from "./gcloud-secret-manager";
import type { Connector } from "./interface";
import { NativeConnector } from "./native";
import { OnePasswordConnector } from "./onepassword";

export { AwsSecretsManagerConnector } from "./aws";
export { GcloudSecretManagerConnector } from "./gcloud-secret-manager";
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
    case "gcloud_secret_manager":
      return new GcloudSecretManagerConnector();
  }
}
