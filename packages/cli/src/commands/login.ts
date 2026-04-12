import { Command } from "commander";
import {
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
import { prompt } from "../prompt";
import { ensureDaemonStarted } from "./daemon";

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

async function completeDeviceLogin(
  apiUrl: string,
  accessToken: string,
  expiresAt: string,
  printToken: boolean,
): Promise<{ userId: string }> {
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

  if (!printToken) {
    await ensureDaemonStarted();
    await daemonSetAuthSession({
      type: "better_auth_session",
      token: accessToken,
      expiresAt,
    });
  }

  saveConfig({ apiUrl });
  return { userId };
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

  console.log("Your authorization code:");
  console.log(`  ${device.userCode}`);
  console.log("");
  console.log("Open this URL and enter the code above:");
  console.log(`  ${device.verificationUri}`);
  console.log("");

  if (!opts.noOpenBrowser) {
    await prompt("Press Enter to open a browser...");
    const opened = await openBrowser(device.verificationUri);
    if (!opened) {
      warn("Could not open a browser. Navigate to the URL above.");
    }
  }

  console.log("Waiting for you to approve in the browser...");
  const result = await pollUntilApproved(
    apiUrl,
    device.deviceCode,
    device.intervalSeconds,
    device.expiresAt,
  );
  await completeDeviceLogin(apiUrl, result.accessToken, result.expiresAt, false);

  success("Logged in.");
  success("Run `abadge agent register --kind local_cli` to register a local agent.");
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
    });
    return;
  }

  success("Logged in.");
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
