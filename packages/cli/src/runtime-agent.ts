import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, join } from "node:path";
import { generateEd25519KeyPair, signEd25519 } from "@abadge/crypto/shared";
import { AbadgeApiError } from "@abadge/sdk";
import { ApiClient, createAnonymousClient, createOperatorClient } from "./client";
import {
  type CliLocalAgentReference,
  type CliProfileConfig,
  getLocalAgentReference,
  type LocalAgentSlot,
  saveLocalAgentReference,
} from "./config";
import { daemonOperatorToken, readOperatorSession } from "./daemon";

export type LocalRuntimeKind = "local_cli" | "local_mcp";

const AGENT_DIR = join(homedir(), ".abadge", "agents");
const SLOT_BY_KIND: Record<LocalRuntimeKind, LocalAgentSlot> = {
  local_cli: "cli",
  local_mcp: "mcp",
};
const LABEL_BY_KIND: Record<LocalRuntimeKind, string> = {
  local_cli: "Local CLI",
  local_mcp: "Local MCP",
};

function privateKeyPathFor(slot: LocalAgentSlot): string {
  return join(AGENT_DIR, `${slot}.ed25519.jwk`);
}

function savePrivateKey(privateKeyPath: string, privateKey: string): void {
  mkdirSync(dirname(privateKeyPath), { recursive: true, mode: 0o700 });
  writeFileSync(privateKeyPath, privateKey, { mode: 0o600 });
  chmodSync(privateKeyPath, 0o600);
}

function readPrivateKey(privateKeyPath: string): string {
  return readFileSync(privateKeyPath, "utf-8");
}

async function hasOperatorSession(): Promise<boolean> {
  const response = await daemonOperatorToken();
  if (!response.ok) {
    return false;
  }

  const session = readOperatorSession(response);
  return Boolean(session?.authenticated && session.token);
}

async function provisionLocalRuntimeAgent(
  kind: LocalRuntimeKind,
  config: CliProfileConfig,
): Promise<CliLocalAgentReference> {
  const slot = SLOT_BY_KIND[kind];
  const privateKeyPath = privateKeyPathFor(slot);
  const { publicKey, privateKey } = await generateEd25519KeyPair();
  savePrivateKey(privateKeyPath, privateKey);

  let result: Awaited<ReturnType<ApiClient["createAgent"]>>;
  try {
    const operatorClient = await createOperatorClient(config);
    result = await operatorClient.createAgent({
      kind,
      name: `${LABEL_BY_KIND[kind]} (${hostname()})`,
      authMethod: "public_key_session",
      publicKey,
      issueBootstrapToken: false,
      metadata: {
        managedBy: "abadge-cli",
        host: hostname(),
      },
    });
  } catch (error) {
    try {
      rmSync(privateKeyPath);
    } catch {
      // Best effort cleanup.
    }
    throw error;
  }

  return saveLocalAgentReference(
    slot,
    {
      agentId: result.agent.id,
      privateKeyPath,
    },
    config,
  ).localAgents?.[slot] as CliLocalAgentReference;
}

async function mintAgentSession(
  apiUrl: string,
  reference: CliLocalAgentReference,
): Promise<ApiClient> {
  const privateKey = readPrivateKey(reference.privateKeyPath);
  const anonymousClient = createAnonymousClient(apiUrl);
  const challenge = await anonymousClient.createAgentChallenge({ agentId: reference.agentId });
  const signature = await signEd25519(privateKey, challenge.challenge);
  const session = await anonymousClient.exchangeAgentSession({
    agentId: reference.agentId,
    challengeId: challenge.challengeId,
    challenge: challenge.challenge,
    signature,
  });

  return new ApiClient({
    apiUrl,
    token: session.session.token,
  });
}

async function loadOrProvisionReference(
  kind: LocalRuntimeKind,
  config: CliProfileConfig,
): Promise<CliLocalAgentReference> {
  const slot = SLOT_BY_KIND[kind];
  const existing = getLocalAgentReference(config, slot);
  if (existing) {
    if (existsSync(existing.privateKeyPath)) {
      return existing;
    }

    if (!(await hasOperatorSession())) {
      throw new Error(
        `${LABEL_BY_KIND[kind]} private key is missing. Run \`abadge login\` again to reprovision it.`,
      );
    }

    return provisionLocalRuntimeAgent(kind, config);
  }

  if (!(await hasOperatorSession())) {
    throw new Error(
      `${LABEL_BY_KIND[kind]} identity is not provisioned. Run \`abadge login\` first.`,
    );
  }

  return provisionLocalRuntimeAgent(kind, config);
}

function shouldReprovision(error: unknown): boolean {
  return (
    error instanceof AbadgeApiError &&
    (error.code === "AGENT_NOT_FOUND" || error.code === "AGENT_NOT_ENROLLED")
  );
}

export async function ensureLocalRuntimeAgent(
  kind: LocalRuntimeKind,
  config: CliProfileConfig,
): Promise<CliLocalAgentReference> {
  return loadOrProvisionReference(kind, config);
}

export async function createRuntimeClient(
  kind: LocalRuntimeKind,
  config: CliProfileConfig,
): Promise<ApiClient> {
  let reference = await loadOrProvisionReference(kind, config);

  try {
    return await mintAgentSession(config.apiUrl, reference);
  } catch (error) {
    if (!shouldReprovision(error) || !(await hasOperatorSession())) {
      if (error instanceof Error && error.message.includes("ENOENT")) {
        throw new Error(
          `${LABEL_BY_KIND[kind]} private key is missing. Run \`abadge login\` again to reprovision it.`,
        );
      }
      throw error;
    }

    reference = await provisionLocalRuntimeAgent(kind, config);
    return mintAgentSession(config.apiUrl, reference);
  }
}
