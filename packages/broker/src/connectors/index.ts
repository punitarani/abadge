import type { ConnectorType } from "../types";
import { HashicorpVaultConnector } from "./hashicorp-vault";
import type { Connector } from "./interface";

export { HashicorpVaultConnector } from "./hashicorp-vault";
export type { Connector, ConnectorConfig, FetchedSecret, SecretReference } from "./interface";

export function createConnector(type: ConnectorType): Connector {
  switch (type) {
    case "hashicorp_vault":
      return new HashicorpVaultConnector();
    default:
      throw new Error(`Unsupported connector type: ${type}`);
  }
}
