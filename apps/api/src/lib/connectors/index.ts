import { DopplerHttpConnector } from "./doppler";
import { HashiCorpVaultHttpConnector } from "./hashicorp-vault";
import { InfisicalHttpConnector } from "./infisical";
import type { HttpConnector } from "./interface";

export type { ConnectorConfig, ExternalRef, FetchedSecret, HttpConnector } from "./interface";

const httpConnectorTypes = ["doppler", "hashicorp_vault", "infisical"] as const;

export function createHttpConnector(type: string): HttpConnector | null {
  switch (type) {
    case "doppler":
      return new DopplerHttpConnector();
    case "hashicorp_vault":
      return new HashiCorpVaultHttpConnector();
    case "infisical":
      return new InfisicalHttpConnector();
    default:
      return null;
  }
}

export function isHttpConnectorType(type: string): boolean {
  return (httpConnectorTypes as readonly string[]).includes(type);
}
