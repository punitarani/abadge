import type { Database } from "@abadge/db";

export type Bindings = {
  HYPERDRIVE?: Hyperdrive;
  DATABASE_URL?: string;
  API_URL: string;
  APP_URL: string;
  ENCRYPTION_KEY: string;
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
};

export type Env = {
  Bindings: Bindings;
  Variables: {
    userId: string;
    db: Database;
  };
};

export type AgentEnv = {
  Bindings: Bindings;
  Variables: {
    agent: Record<string, unknown>;
    db: Database;
    sessionId?: string;
  };
};
