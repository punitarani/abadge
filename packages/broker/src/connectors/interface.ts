export interface ConnectorConfig {
  type: string;
  [key: string]: unknown;
}

export interface SecretReference {
  name: string;
  /** Vault-specific path (e.g. "op://vault/item/field" for 1Password) */
  path?: string;
  version?: string;
}

export interface FetchedSecret {
  value: string;
  metadata?: Record<string, string>;
  expiresAt?: Date;
}

export interface Connector {
  readonly type: string;
  fetchSecret(ref: SecretReference, config: ConnectorConfig): Promise<FetchedSecret>;
  testConnection(config: ConnectorConfig): Promise<{ success: boolean; error?: string }>;
}
