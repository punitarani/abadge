import { hostname } from "node:os";
import { AbadgeApiError } from "@abadge/sdk";
import { Command } from "commander";
import {
  ApiClient,
  DeviceAuthorizationError,
  exchangeDeviceToken,
  getBearerSession,
  requestDeviceCode,
  resolveSessionConfig,
  SessionApiClient,
} from "../client";
import { clearConfig, loadConfig, saveConfig } from "../config";
import { daemonClearAuthSession, daemonSetAuthSession } from "../daemon";
import { error, errorMessage, json, success, warn } from "../output";
import { ensureDaemonStarted } from "./daemon";

interface AgentRecord {
  id: string;
  userId: string;
  kind: string;
  locality: string;
  name: string;
  enabled: boolean;
  revokedAt: string | null;
}

interface AgentRegistration {
  agent: AgentRecord;
  apiKey: string;
}

type LocalCliAgentResult = {
  agentId: string;
  apiKey: string;
  action: "reused" | "rotated" | "created";
};

interface LoginOptions {
  apiUrl?: string;
  noOpenBrowser?: boolean;
}

interface StartOptions {
  apiUrl?: string;
  json?: boolean;
}

interface PollOptions {
  apiUrl?: string;
  deviceCode: string;
  interval?: string;
  json?: boolean;
  printToken?: boolean;
}

function resolveApiUrl(apiUrl?: string): string {
  const existing = loadConfig();
  return apiUrl ?? existing?.apiUrl ?? process.env.ABADGE_API_URL ?? "https://api.abadge.io";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function openBrowser(url: string): Promise<boolean> {
  const command =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];

  try {
    const proc = Bun.spawn(command, { stdout: "ignore", stderr: "ignore" });
    return (await proc.exited) === 0;
  } catch {
    return false;
  }
}

function isNotFoundError(error: unknown): error is AbadgeApiError {
  return error instanceof AbadgeApiError && error.statusCode === 404;
}

function isUnauthorizedError(error: unknown): error is AbadgeApiError {
  return error instanceof AbadgeApiError && error.statusCode === 401;
}

function isReusableLocalCliAgent(agent: AgentRecord, sessionUserId: string): boolean {
  return (
    agent.userId === sessionUserId &&
    agent.kind === "local_cli" &&
    agent.locality === "local" &&
    agent.enabled &&
    agent.revokedAt == null
  );
}

async function getExistingLocalCliAgent(
  client: SessionApiClient,
  existingAgentId: string | undefined,
  sessionUserId: string,
): Promise<AgentRecord | null> {
  if (!existingAgentId) {
    return null;
  }

  try {
    const agent = (await client.getAgent(existingAgentId)).agent as AgentRecord;
    return isReusableLocalCliAgent(agent, sessionUserId) ? agent : null;
  } catch (err) {
    if (isNotFoundError(err)) {
      return null;
    }
    throw err;
  }
}

async function reuseExistingAgentKey(
  apiUrl: string,
  sessionUserId: string,
  existingAgentKey: string | undefined,
): Promise<LocalCliAgentResult | null> {
  if (!existingAgentKey) {
    return null;
  }

  try {
    const currentAgent = (
      await new ApiClient({
        apiUrl,
        principalSecret: existingAgentKey,
      }).getCurrentAgent()
    ).agent as AgentRecord;

    if (!isReusableLocalCliAgent(currentAgent, sessionUserId)) {
      return null;
    }

    return {
      agentId: currentAgent.id,
      apiKey: existingAgentKey,
      action: "reused",
    };
  } catch (err) {
    if (isUnauthorizedError(err)) {
      return null;
    }
    throw err;
  }
}

async function rotateExistingAgent(
  client: SessionApiClient,
  agentId: string,
): Promise<LocalCliAgentResult | null> {
  try {
    const rotated = await client.rotateAgent(agentId);
    return {
      agentId,
      apiKey: rotated.apiKey,
      action: "rotated",
    };
  } catch (err) {
    if (isNotFoundError(err)) {
      return null;
    }
    throw err;
  }
}

async function createLocalCliAgent(client: SessionApiClient): Promise<LocalCliAgentResult> {
  const deviceName = hostname().trim() || "local-machine";
  const result = (await client.createAgent({
    kind: "local_cli",
    name: `cli-${deviceName}`,
    metadata: {
      hostname: deviceName,
      platform: process.platform,
    },
  })) as AgentRegistration;

  return { agentId: result.agent.id, apiKey: result.apiKey, action: "created" };
}

async function ensureLocalCliAgent(
  apiUrl: string,
  sessionUserId: string,
  client: SessionApiClient,
  existingAgentId?: string,
  existingAgentKey?: string,
): Promise<LocalCliAgentResult> {
  const existingAgent = await getExistingLocalCliAgent(client, existingAgentId, sessionUserId);
  if (!existingAgent) {
    return createLocalCliAgent(client);
  }

  const reusedAgent = await reuseExistingAgentKey(apiUrl, sessionUserId, existingAgentKey);
  if (reusedAgent) {
    return reusedAgent;
  }

  const rotatedAgent = await rotateExistingAgent(client, existingAgent.id);
  if (rotatedAgent) {
    return rotatedAgent;
  }

  return createLocalCliAgent(client);
}

async function completeDeviceLogin(
  apiUrl: string,
  accessToken: string,
  expiresAt: string,
  printToken: boolean,
): Promise<{ userId: string; agent: LocalCliAgentResult | null }> {
  const existing = loadConfig();
  const sessionClient = new SessionApiClient({
    apiUrl,
    sessionHeaders: { Authorization: `Bearer ${accessToken}` },
  });
  await sessionClient.recordLogin();
  const session = await getBearerSession(apiUrl, accessToken);
  const userId = session.user?.id ?? session.session?.userId;
  if (!userId) {
    throw new Error("Authenticated successfully but could not determine the session user.");
  }

  saveConfig({
    apiUrl,
    operatorUserId: userId,
    principalId: existing?.principalId,
    principalSecret: existing?.principalSecret,
  });

  let agent: LocalCliAgentResult | null = null;
  if (!printToken) {
    await ensureDaemonStarted();
    await daemonSetAuthSession({
      type: "better_auth_session",
      token: accessToken,
      expiresAt,
    });

    agent = await ensureLocalCliAgent(
      apiUrl,
      userId,
      sessionClient,
      existing?.principalId,
      existing?.principalSecret,
    );
  }

  saveConfig({
    apiUrl,
    operatorUserId: userId,
    principalId: agent?.agentId ?? existing?.principalId,
    principalSecret: agent?.apiKey ?? existing?.principalSecret,
  });

  return { userId, agent };
}

function getNextPollInterval(err: unknown, interval: number): number {
  if (!(err instanceof DeviceAuthorizationError)) {
    throw err;
  }

  switch (err.code) {
    case "authorization_pending":
      return interval;
    case "slow_down":
      return err.intervalSeconds ?? interval + 5;
    default:
      throw err;
  }
}

async function pollUntilApproved(
  apiUrl: string,
  deviceCode: string,
  intervalSeconds: number,
  expiresAt?: string,
): Promise<Awaited<ReturnType<typeof exchangeDeviceToken>>> {
  let interval = intervalSeconds;
  const deadline = expiresAt ? new Date(expiresAt).getTime() : Date.now() + 10 * 60 * 1000;

  while (Date.now() < deadline) {
    try {
      return await exchangeDeviceToken(apiUrl, deviceCode, interval);
    } catch (err) {
      interval = getNextPollInterval(err, interval);
      await sleep(interval * 1000);
    }
  }

  throw new DeviceAuthorizationError("expired_token", "Device login expired");
}

async function startDeviceLoginRequest(opts: StartOptions): Promise<void> {
  const apiUrl = resolveApiUrl(opts.apiUrl);
  saveConfig({ ...(loadConfig() ?? { apiUrl }), apiUrl });
  const device = await requestDeviceCode(apiUrl);

  json({
    device_code: device.deviceCode,
    user_code: device.userCode,
    verification_uri: device.verificationUri,
    verification_uri_complete: device.verificationUriComplete,
    interval: device.intervalSeconds,
    expires_at: device.expiresAt,
  });
}

async function startDeviceLogin(opts: LoginOptions): Promise<void> {
  const apiUrl = resolveApiUrl(opts.apiUrl);
  saveConfig({ ...(loadConfig() ?? { apiUrl }), apiUrl });
  const device = await requestDeviceCode(apiUrl);

  console.log("Open this URL to authorize the CLI:");
  console.log(`  ${device.verificationUri}`);
  console.log("");
  console.log("Then enter this code:");
  console.log(`  ${device.userCode}`);
  console.log("");

  if (!opts.noOpenBrowser) {
    const opened = await openBrowser(device.verificationUriComplete);
    if (!opened) {
      warn("Could not open a browser automatically. Use the URL and code above.");
    }
  }

  const result = await pollUntilApproved(
    apiUrl,
    device.deviceCode,
    device.intervalSeconds,
    device.expiresAt,
  );
  const completed = await completeDeviceLogin(apiUrl, result.accessToken, result.expiresAt, false);

  success("Logged in successfully.");
  if (completed.agent?.action === "created") {
    success(`Registered local CLI agent ${completed.agent.agentId}.`);
  } else if (completed.agent?.action === "rotated") {
    success(`Refreshed local CLI agent ${completed.agent.agentId}.`);
  }
}

async function pollDeviceLogin(opts: PollOptions): Promise<void> {
  const apiUrl = resolveApiUrl(opts.apiUrl);
  const interval = opts.interval ? Number.parseInt(opts.interval, 10) : 5;
  const result = await pollUntilApproved(
    apiUrl,
    opts.deviceCode,
    Number.isFinite(interval) ? interval : 5,
  );
  const completed = await completeDeviceLogin(
    apiUrl,
    result.accessToken,
    result.expiresAt,
    Boolean(opts.printToken),
  );

  if (opts.json) {
    json({
      authenticated: true,
      user_id: completed.userId,
      expires_at: result.expiresAt,
      token_loaded_in_daemon: !opts.printToken,
      access_token: opts.printToken ? result.accessToken : undefined,
      agent_id: completed.agent?.agentId ?? null,
      agent_action: completed.agent?.action ?? null,
    });
    return;
  }

  success("Logged in successfully.");
  if (opts.printToken) {
    warn("Save this short-lived session token securely. It will not be shown again:");
    console.log(`  ${result.accessToken}`);
  }
}

export function createLoginCommand(): Command {
  const cmd = new Command("login")
    .description("Authenticate with abadge using browser device login")
    .option("--api-url <url>", "API base URL")
    .option("--no-open-browser", "Do not try to open a browser automatically")
    .action(async (opts: LoginOptions) => {
      try {
        await startDeviceLogin(opts);
      } catch (err) {
        error(errorMessage(err, "Failed to log in."));
        process.exit(1);
      }
    });

  cmd
    .command("start")
    .description("Start device login and print the user code")
    .option("--api-url <url>", "API base URL")
    .requiredOption("--json", "Output as JSON")
    .action(async (opts: StartOptions) => {
      try {
        await startDeviceLoginRequest(opts);
      } catch (err) {
        error(errorMessage(err, "Failed to start device login."));
        process.exit(1);
      }
    });

  cmd
    .command("poll")
    .description("Poll a device login request until it is approved")
    .requiredOption("--device-code <code>", "Device code returned by `abadge login start --json`")
    .option("--api-url <url>", "API base URL")
    .option("--interval <seconds>", "Initial poll interval in seconds")
    .option("--print-token", "Print the short-lived session token instead of loading the daemon")
    .option("--json", "Output as JSON")
    .action(async (opts: PollOptions) => {
      try {
        await pollDeviceLogin(opts);
      } catch (err) {
        error(errorMessage(err, "Failed to poll device login."));
        process.exit(1);
      }
    });

  return cmd;
}

export function createLogoutCommand(): Command {
  return new Command("logout")
    .description("Clear the daemon-held operator session")
    .action(async () => {
      const config = loadConfig();
      try {
        if (config) {
          try {
            const client = new SessionApiClient(await resolveSessionConfig());
            await client.logout();
          } catch {
            // Logout is best-effort because the daemon session may already be gone.
          }
        }
        await daemonClearAuthSession().catch(() => undefined);
        if (config) {
          saveConfig(config);
        } else {
          clearConfig();
        }
        success("Logged out.");
      } catch (err) {
        error(errorMessage(err, "Failed to log out."));
        process.exit(1);
      }
    });
}
