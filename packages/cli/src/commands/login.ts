import { DEVICE_AUTH_CLIENT_ID } from "@abadge/auth";
import { Command } from "commander";
import { ApiClient } from "../client";
import {
  type CliProfileConfig,
  DEFAULT_API_URL,
  loadConfig,
  mergeLoginConfig,
  saveConfig,
} from "../config";
import { daemonSetOperatorSession } from "../daemon";
import { error, success, warn } from "../output";
import { ensureLocalRuntimeAgent } from "../runtime-agent";
import { ensureDaemonRunning } from "./daemon";

interface DeviceCodeResponse {
  device_code?: string;
  user_code?: string;
  verification_uri?: string;
  verification_uri_complete?: string;
  interval?: number;
}

interface DeviceTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface SessionLookupResponse {
  user?: {
    id?: string | null;
  } | null;
  session?: {
    expiresAt?: string | null;
    userId?: string | null;
  } | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestDeviceCode(apiUrl: string): Promise<Required<DeviceCodeResponse>> {
  const response = await fetch(`${apiUrl.replace(/\/$/, "")}/api/auth/device/code`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: DEVICE_AUTH_CLIENT_ID,
      scope: "openid profile email",
    }),
  });
  const data = (await response.json().catch(() => ({}))) as DeviceCodeResponse & {
    error?: string;
    error_description?: string;
  };

  if (!response.ok || !data.device_code || !data.user_code || !data.verification_uri) {
    throw new Error(
      data.error_description ??
        data.error ??
        `Failed to start device authorization (${response.status})`,
    );
  }

  return {
    device_code: data.device_code,
    user_code: data.user_code,
    verification_uri: data.verification_uri,
    verification_uri_complete: data.verification_uri_complete ?? data.verification_uri,
    interval: data.interval ?? 5,
  };
}

async function pollForAccessToken(
  apiUrl: string,
  deviceCode: string,
  initialIntervalSeconds: number,
): Promise<string> {
  let pollingIntervalSeconds = Math.max(initialIntervalSeconds, 1);

  while (true) {
    await sleep(pollingIntervalSeconds * 1000);

    const response = await fetch(`${apiUrl.replace(/\/$/, "")}/api/auth/device/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: deviceCode,
        client_id: DEVICE_AUTH_CLIENT_ID,
      }),
    });
    const data = (await response.json().catch(() => ({}))) as DeviceTokenResponse;

    if (response.ok && data.access_token) {
      return data.access_token;
    }

    switch (data.error) {
      case "authorization_pending":
        continue;
      case "slow_down":
        pollingIntervalSeconds += 5;
        continue;
      case "access_denied":
        throw new Error("Device authorization was denied.");
      case "expired_token":
        throw new Error("The device code expired. Run `abadge login` again.");
      default:
        throw new Error(
          data.error_description ??
            data.error ??
            `Failed to complete device authorization (${response.status})`,
        );
    }
  }
}

async function lookupSession(
  apiUrl: string,
  accessToken: string,
): Promise<{ userId: string | null; expiresAt: string | null }> {
  const response = await fetch(`${apiUrl.replace(/\/$/, "")}/api/auth/get-session`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const data = (await response.json().catch(() => ({}))) as SessionLookupResponse;

  if (!response.ok) {
    return { userId: null, expiresAt: null };
  }

  return {
    userId: data.user?.id ?? data.session?.userId ?? null,
    expiresAt: data.session?.expiresAt ?? null,
  };
}

async function tryOpenBrowser(url: string): Promise<boolean> {
  const commands =
    process.platform === "darwin"
      ? [["open", url]]
      : process.platform === "win32"
        ? [["cmd", "/c", "start", "", url]]
        : [["xdg-open", url]];

  for (const command of commands) {
    try {
      const proc = Bun.spawn(command, {
        stdout: "ignore",
        stderr: "ignore",
      });
      const exitCode = await proc.exited;
      if (exitCode === 0) {
        return true;
      }
    } catch {
      // Try the next launcher.
    }
  }

  return false;
}

async function maybeOpenVerificationUrl(
  verificationUrl: string,
  openBrowser: boolean | undefined,
): Promise<void> {
  if (openBrowser === false) {
    return;
  }

  const opened = await tryOpenBrowser(verificationUrl);
  if (!opened) {
    warn("Could not open a browser automatically. Open the verification URL manually.");
  }
}

async function recordLoginAudit(apiUrl: string, accessToken: string): Promise<void> {
  try {
    const operatorClient = new ApiClient({ apiUrl, token: accessToken });
    await operatorClient.recordLogin();
  } catch {
    warn("Logged in, but login audit recording failed.");
  }
}

async function provisionLocalAgents(config: CliProfileConfig): Promise<void> {
  for (const kind of ["local_cli", "local_mcp"] as const) {
    try {
      await ensureLocalRuntimeAgent(kind, config);
    } catch (provisionError) {
      warn(
        provisionError instanceof Error
          ? provisionError.message
          : `Logged in, but ${kind} provisioning failed.`,
      );
    }
  }
}

async function finishLogin(
  apiUrl: string,
  accessToken: string,
  existing: CliProfileConfig | null,
): Promise<void> {
  const session = await lookupSession(apiUrl, accessToken);
  const config = mergeLoginConfig(apiUrl, existing, session.userId);
  saveConfig(config);
  await ensureDaemonRunning(apiUrl);

  const daemonSession = await daemonSetOperatorSession({
    accessToken,
    userId: session.userId,
    expiresAt: session.expiresAt,
  });
  if (!daemonSession.ok) {
    throw new Error(daemonSession.error ?? "Failed to store operator session in daemon");
  }

  await recordLoginAudit(apiUrl, accessToken);
  await provisionLocalAgents(config);
}

async function runLogin(
  apiUrl: string,
  existing: CliProfileConfig | null,
  openBrowser: boolean | undefined,
): Promise<void> {
  const device = await requestDeviceCode(apiUrl);

  console.log(`Verification URL: ${device.verification_uri}`);
  console.log(`User code: ${device.user_code}`);

  await maybeOpenVerificationUrl(device.verification_uri_complete, openBrowser);

  console.log("Waiting for authorization...");
  const accessToken = await pollForAccessToken(apiUrl, device.device_code, device.interval);
  await finishLogin(apiUrl, accessToken, existing);
}

export function createLoginCommand(): Command {
  return new Command("login")
    .description("Authenticate with abadge using browser-based device authorization")
    .option("--api-url <url>", "API base URL")
    .option("--no-open-browser", "Do not try to open the browser automatically")
    .action(async (opts: { apiUrl?: string; openBrowser?: boolean }) => {
      const existing = loadConfig();
      const apiUrl = opts.apiUrl ?? existing?.apiUrl ?? DEFAULT_API_URL;

      try {
        await runLogin(apiUrl, existing, opts.openBrowser);
        success("Logged in successfully.");
      } catch (loginError) {
        error(loginError instanceof Error ? loginError.message : "Login failed.");
        process.exit(1);
      }
    });
}
