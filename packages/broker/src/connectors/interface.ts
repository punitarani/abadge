import type { ConnectorType } from "../types";

export type ConnectorConfig = Record<string, unknown>;

export interface SecretReference {
  /** Secret path within the connector (e.g. vault path, 1Password item). */
  name: string;
  /** Optional sub-field within the secret. */
  path?: string;
}

export interface FetchedSecret {
  value: string;
}

export interface Connector {
  readonly type: ConnectorType;
  fetchSecret(ref: SecretReference, config: ConnectorConfig): Promise<FetchedSecret>;
  testConnection(config: ConnectorConfig): Promise<{ success: boolean; error?: string }>;
}
