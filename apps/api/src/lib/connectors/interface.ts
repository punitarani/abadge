export interface ExternalRef {
  name?: string;
  path?: string;
  version?: string;
}

export interface ConnectorConfig {
  [key: string]: unknown;
}

export interface FetchedSecret {
  value: string;
  metadata?: Record<string, string>;
}

export interface HttpConnector {
  readonly type: string;
  fetchSecret(ref: ExternalRef, config: ConnectorConfig): Promise<FetchedSecret>;
  testConnection(config: ConnectorConfig): Promise<{ success: boolean; error?: string }>;
}

/** Extract a required string from connector config, throw with connector name on failure. */
export function requireString(connector: string, config: ConnectorConfig, key: string): string {
  const val = config[key];
  if (typeof val !== "string" || val.length === 0) {
    throw new Error(`${connector} connector requires "${key}" in config`);
  }
  return val;
}

/** Extract an optional string from connector config with a fallback default. */
export function optionalString(
  connector: string,
  config: ConnectorConfig,
  key: string,
  fallback?: string,
): string | undefined {
  const val = config[key];
  if (val === undefined || val === null) return fallback;
  if (typeof val !== "string") {
    throw new Error(`${connector} connector: "${key}" must be a string`);
  }
  return val;
}
