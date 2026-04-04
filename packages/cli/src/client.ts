import { AbadgeApiError, AbadgeClient } from "@abadge/sdk";
import { type CliProfileConfig, requireConfig } from "./config";
import { daemonClearOperatorSession, daemonOperatorToken, readOperatorSession } from "./daemon";

export interface ApiClientConfig {
  apiUrl: string;
  token?: string;
}

export class ApiClient extends AbadgeClient {
  constructor(config: ApiClientConfig) {
    super({
      apiUrl: config.apiUrl,
      token: config.token,
    });
  }
}

export function createAnonymousClient(apiUrl: string): ApiClient {
  return new ApiClient({ apiUrl });
}

export async function createOperatorClient(
  config: CliProfileConfig = requireConfig(),
): Promise<ApiClient> {
  const response = await daemonOperatorToken();
  if (!response.ok) {
    throw new Error(response.error ?? "Operator session is unavailable");
  }

  const session = readOperatorSession(response);
  if (!session?.authenticated || !session.token) {
    throw new Error("Operator session is not authenticated. Run `abadge login` first.");
  }

  return new ApiClient({
    apiUrl: config.apiUrl,
    token: session.token,
  });
}

export async function clearOperatorSessionIfExpired(error: unknown): Promise<void> {
  if (!(error instanceof AbadgeApiError) || error.code !== "UNAUTHORIZED") {
    return;
  }

  await daemonClearOperatorSession();
}
