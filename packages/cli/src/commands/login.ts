import { hostname } from "node:os";
import { AbadgeApiError } from "@abadge/sdk";
import { Command } from "commander";
import { ApiClient, SessionApiClient, signInWithEmail } from "../client";
import { loadConfig, saveConfig } from "../config";
import { error, errorMessage, success } from "../output";
import { prompt } from "../prompt";

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
  const reusedAgent = await reuseExistingAgentKey(apiUrl, sessionUserId, existingAgentKey);
  if (reusedAgent) {
    return reusedAgent;
  }

  if (!existingAgent) {
    return createLocalCliAgent(client);
  }

  const rotatedAgent = await rotateExistingAgent(client, existingAgent.id);
  if (rotatedAgent) {
    return rotatedAgent;
  }

  return createLocalCliAgent(client);
}

export function createLoginCommand(): Command {
  return new Command("login")
    .description("Authenticate with abadge")
    .option("--api-url <url>", "API base URL")
    .option("--email <email>", "Email address")
    .option("--password <password>", "Password")
    .action(async (opts: { apiUrl?: string; email?: string; password?: string }) => {
      const existing = loadConfig();
      const apiUrl =
        opts.apiUrl ?? existing?.apiUrl ?? process.env.ABADGE_API_URL ?? "https://api.abadge.io";
      const email = opts.email ?? (await prompt("Email: "));
      const password = opts.password ?? (await prompt("Password: ", true));

      if (!email || !password) {
        error("Email and password are required.");
        process.exit(1);
      }

      try {
        const { sessionCookie, session } = await signInWithEmail(apiUrl, email, password);
        const sessionUserId = session.user?.id;
        if (!sessionUserId) {
          throw new Error("Authenticated successfully but could not determine the session user.");
        }

        const sessionClient = new SessionApiClient({ apiUrl, sessionCookie });
        const agent = await ensureLocalCliAgent(
          apiUrl,
          sessionUserId,
          sessionClient,
          existing?.principalId,
          existing?.principalSecret,
        );

        saveConfig({
          apiUrl,
          sessionCookie,
          principalId: agent.agentId,
          principalSecret: agent.apiKey,
        });

        success("Logged in successfully.");
        if (agent.action === "created") {
          success(`Registered local CLI agent ${agent.agentId}.`);
        } else if (agent.action === "rotated") {
          success(`Refreshed local CLI agent ${agent.agentId}.`);
        }
      } catch (err) {
        error(errorMessage(err, "Failed to log in."));
        process.exit(1);
      }
    });
}
