import type { Database } from "@abadge/db";

export type Bindings = {
  HYPERDRIVE?: Hyperdrive;
  DATABASE_URL?: string;
  ABADGE_API_URL: string;
  ABADGE_APP_URL: string;
  ENCRYPTION_KEY: string;
  BETTER_AUTH_SECRET: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
};

/** Environment for session-authenticated routes (human users). */
export type Env = {
  Bindings: Bindings;
  Variables: {
    userId: string;
    db: Database;
  };
};

/** Environment for principal-authenticated routes (agents/devices). */
export type PrincipalEnv = {
  Bindings: Bindings;
  Variables: {
    principalId: string;
    principalUserId: string;
    principalLocality: string;
    db: Database;
  };
};
