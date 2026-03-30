export interface BrokerConfig {
  apiUrl: string;
  token: string;
}

export interface SecretAccessResult {
  name: string;
  type: string;
  value?: string;
  metadata?: Record<string, string> | null;
  deliveryMode: string;
  sessionId?: string;
}

export interface RunResult {
  exitCode: number;
  signal?: string;
}

export interface MountResult {
  path: string;
  cleanup: () => void;
}

export type ConnectorType = "native" | "onepassword" | "aws_secrets_manager" | "infisical";
