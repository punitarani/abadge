import type { ConnectorType } from "../types";
import { AwsSecretsManagerConnector } from "./aws";
import type { Connector } from "./interface";
import { NativeConnector } from "./native";
import { OnePasswordConnector } from "./onepassword";

export { AwsSecretsManagerConnector } from "./aws";
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
  }
}
