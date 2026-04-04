import { ArrowUpRight, CheckCircle2 } from "lucide-react";
import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, IBM_Plex_Sans_Condensed } from "next/font/google";
import Image from "next/image";
import Link from "next/link";

const landingSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-landing-sans",
});

const landingMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-landing-mono",
});

const landingCondensed = IBM_Plex_Sans_Condensed({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-landing-condensed",
});

const encryptionModes = [
  {
    label: "Zero-knowledge",
    algorithm: "XChaCha20-Poly1305",
    kdf: "Argon2id · 64 MiB · 3 iterations",
    keySize: "256-bit",
    nonce: "192-bit random per operation",
    description:
      "Client-side encryption where the server never sees plaintext. Your master password derives a key encryption key via Argon2id, which wraps a root key, which wraps per-item data encryption keys. Three layers of indirection mean password changes re-wrap one key, not every credential.",
    properties: [
      "Server cannot decrypt even with full database access",
      "Per-item data encryption keys isolate blast radius",
      "Password change re-wraps root key only",
      "Recovery key wraps root key independently of password",
    ],
  },
  {
    label: "Server-managed",
    algorithm: "AES-256-GCM",
    kdf: "Worker secret · WebCrypto",
    keySize: "256-bit",
    nonce: "96-bit random IV per operation",
    description:
      "Server-side encryption for credentials that remote agents need to access. Decryption happens only after authentication, permission verification, policy evaluation, and audit logging. Designed for automation workflows where the user may be offline.",
    properties: [
      "Decryption gated behind full authorization chain",
      "Every decrypt is audit-logged before returning",
      "Remote agents can only access this mode",
      "Supports external connector fetch instead of decrypt",
    ],
  },
];

type CellStatus = "allowed" | "no-zk-reveal" | "remote-no-zk" | "remote-reveal-only";

const statusLabels: Record<CellStatus, string> = {
  allowed: "Allowed",
  "no-zk-reveal": "Cannot reveal ZK",
  "remote-no-zk": "Remote cannot access ZK",
  "remote-reveal-only": "Remote: reveal only",
};

const capabilityMatrix: {
  capability: string;
  description: string;
  localZK: CellStatus;
  localServer: CellStatus;
  remoteZK: CellStatus;
  remoteServer: CellStatus;
}[] = [
  {
    capability: "read_ciphertext",
    description: "Encrypted blob for local daemon decryption",
    localZK: "allowed",
    localServer: "allowed",
    remoteZK: "remote-no-zk",
    remoteServer: "remote-reveal-only",
  },
  {
    capability: "reveal_plaintext",
    description: "Server decrypts and returns value",
    localZK: "no-zk-reveal",
    localServer: "allowed",
    remoteZK: "remote-no-zk",
    remoteServer: "allowed",
  },
  {
    capability: "mount_env",
    description: "Inject into subprocess environment variable",
    localZK: "allowed",
    localServer: "allowed",
    remoteZK: "remote-no-zk",
    remoteServer: "remote-reveal-only",
  },
  {
    capability: "mount_file",
    description: "Write to temp file with 0600 permissions",
    localZK: "allowed",
    localServer: "allowed",
    remoteZK: "remote-no-zk",
    remoteServer: "remote-reveal-only",
  },
];

const trustTiers = [
  {
    tier: "01",
    name: "Local daemon",
    trust: "Strongest",
    description:
      "Root key held in process memory only. Unix socket with 0600 permissions. Protects against network attackers and server compromise. Sodium memzero on lock.",
    boundary: "Process memory boundary",
  },
  {
    tier: "02",
    name: "Browser",
    trust: "Convenient",
    description:
      "Root key in JS memory for session duration. Lost on tab close, no persistence. Suitable for credential management, not high-security operations.",
    boundary: "Browser tab boundary",
  },
  {
    tier: "03",
    name: "Server",
    trust: "Zero-knowledge for ZK items",
    description:
      "Stores ciphertext only for zero-knowledge items. Cannot decrypt them or derive user root keys. Can decrypt server-managed items by design for authorized agent access.",
    boundary: "TLS + authorization boundary",
  },
  {
    tier: "04",
    name: "Remote agents",
    trust: "Restricted",
    description:
      "Short-lived session tokens. Can only access server-managed items via reveal_plaintext. Scoped permissions with optional expiry. Compromised agent exposes only its permitted items.",
    boundary: "Per-agent permission boundary",
  },
];

const authMechanisms = [
  {
    label: "Human operators",
    method: "Better Auth sessions",
    flow: "Email/password or social OAuth via dashboard. Device authorization flow for CLI: request code, approve in browser, receive bearer token stored in daemon memory only.",
  },
  {
    label: "Local agents",
    method: "Ed25519 keypair sessions",
    flow: "Private key stored locally (0600 permissions). Agent signs short-lived challenge. Server issues abs_ session token (15-minute TTL), hashed at rest.",
  },
  {
    label: "Remote agents",
    method: "Bootstrap enrollment + sessions",
    flow: "One-time abe_ bootstrap token (10-minute TTL) for enrollment. After enrollment, same Ed25519 challenge-response flow. Legacy abl_/abg_ API keys supported for migration.",
  },
];

const auditEvents = [
  {
    category: "Auth lifecycle",
    events: "login, logout, bootstrap_issue, enroll, session_issue, session_reject, session_revoke",
  },
  {
    category: "Access attempts",
    events: "ciphertext read, plaintext reveal, env mount, file mount — both allowed and denied",
  },
  { category: "Vault lifecycle", events: "bootstrap, unlock, password_change, key_rotate" },
];

const threatMitigations = [
  {
    threat: "Server breach",
    mitigation:
      "ZK items remain encrypted. Server-managed items protected by ENCRYPTION_KEY isolation.",
  },
  {
    threat: "Weak master password",
    mitigation: "Argon2id with 64 MiB memory and 3 iterations makes brute-force expensive.",
  },
  {
    threat: "Lost master password",
    mitigation: "Recovery key (256-bit, shown once) wraps root key independently of password.",
  },
  {
    threat: "Compromised remote agent",
    mitigation: "Scoped permissions with expiry. Cannot access ZK items. Full audit trail.",
  },
  {
    threat: "Nonce reuse",
    mitigation:
      "XChaCha20-Poly1305 uses 192-bit random nonces. Collision probability is negligible.",
  },
  {
    threat: "Replay attacks",
    mitigation: "15-minute session tokens. Challenge-response for keypair authentication.",
  },
  {
    threat: "Cross-user access",
    mitigation: "Strict user ownership validation. No wildcard permissions.",
  },
  {
    threat: "Metadata leakage",
    mitigation:
      "ZK item metadata encrypted inside ciphertext. Server sees only IDs and timestamps.",
  },
];

const invariants = [
  "No plaintext credential storage",
  "No plaintext API key storage",
  "No plaintext session token storage on disk",
  "No decrypt-before-auth pattern",
  "No cross-user credential access",
  "Every access attempt audited — allowed and denied",
  "Remote agents cannot read ciphertext or use mount delivery",
  "Zero-knowledge plaintext never leaves local device",
];

const honestLimitations = [
  {
    question: "Is abadge fully end-to-end zero-knowledge?",
    answer:
      "No. Zero-knowledge mode is available for local workflows where your device performs decryption. For remote agents that need credentials while you are offline, server-managed encryption bridges that gap. The two modes serve different trust requirements.",
  },
  {
    question: "Can remote agents access zero-knowledge credentials?",
    answer:
      "No. By architectural design, zero-knowledge items require your master password for key derivation. That only happens on your device. The server cannot decrypt them, so remote agents cannot access them.",
  },
  {
    question: "Can credentials be used without exposing them to the model?",
    answer:
      "Yes. The broker injects credentials via environment variables or temporary files. The agent process uses them as background resources. The credential never enters the model context window, preventing leaks into logs or future prompts.",
  },
  {
    question: "What does this not protect against?",
    answer:
      "A local attacker with root or sudo access. A compromised build or deploy pipeline serving malicious code. We do not currently integrate with hardware security modules. Memory zeroing in JavaScript runtimes is best-effort, not guaranteed.",
  },
];

export const metadata: Metadata = {
  title: "Security Architecture | abadge",
  description:
    "How abadge encrypts credentials, authenticates agents, enforces capabilities, and audits every access attempt. Zero-knowledge and server-managed encryption, four trust tiers, append-only audit.",
};

export default function SecurityPage() {
  return (
    <div
      className={`${landingSans.variable} ${landingMono.variable} min-h-screen bg-white text-black selection:bg-[#0047FF] selection:text-white [font-family:var(--font-landing-sans)]`}
    >
      {/* ── Header ── */}
      <header className="sticky top-0 z-30 flex w-full items-center justify-between border-b border-black bg-white px-4 py-2">
        <Link href="/" className="inline-flex items-center gap-2">
          <Image src="/abadge-logo-black.svg" alt="abadge logo" width={24} height={24} />
          <span className="text-xl font-bold tracking-[-0.04em]">abadge</span>
        </Link>

        <div className="flex items-center gap-3">
          <Link
            href="/security"
            className="text-[11px] font-bold uppercase tracking-widest text-[#0047FF]"
          >
            Security
          </Link>
          <a
            href="https://docs.abadge.io"
            className="border border-black bg-white px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.05em] text-black transition-colors hover:border-[#0047FF] hover:bg-zinc-100"
          >
            Docs
          </a>
          <Link
            href="/login"
            className="border border-black bg-black px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.05em] text-white transition-colors hover:border-[#0047FF] hover:bg-[#0047FF]"
          >
            Sign in
          </Link>
        </div>
      </header>

      <main>
        {/* ── Hero ── */}
        <section className="border-b border-black bg-white p-6 md:p-12 lg:p-20">
          <div className="mb-4 text-[10px] font-bold uppercase tracking-[0.28em] text-[#0047FF]">
            Security architecture
          </div>
          <h1
            className={`${landingCondensed.variable} max-w-5xl text-[2.8rem] leading-[0.9] font-bold uppercase tracking-[-0.05em] [font-family:var(--font-landing-condensed)] md:text-[5rem] lg:text-[6.5rem]`}
          >
            Every credential encrypted.
            <br />
            Every access audited.
          </h1>
          <p className="mt-6 max-w-2xl text-sm leading-[1.7] font-medium text-zinc-600 md:text-base">
            Two encryption modes, four trust tiers, a strict capability matrix, and an append-only
            audit log. No aspirational roadmap — this is the architecture running today.
          </p>
          <div className="mt-8 flex flex-wrap gap-2">
            {["XChaCha20-Poly1305", "AES-256-GCM", "Argon2id", "Ed25519", "Append-only audit"].map(
              (tag) => (
                <span
                  key={tag}
                  className="border border-black bg-zinc-50 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.12em] text-zinc-500 [font-family:var(--font-landing-mono)]"
                >
                  {tag}
                </span>
              ),
            )}
          </div>
        </section>

        {/* ── Dual encryption modes ── */}
        <section className="border-b border-black bg-zinc-50 p-6 md:p-12">
          <div className="mb-10 md:mb-14">
            <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.28em] text-[#0047FF]">
              Encryption
            </div>
            <h2
              className={`${landingCondensed.variable} max-w-5xl text-[2rem] leading-[0.92] font-bold uppercase tracking-[-0.04em] [font-family:var(--font-landing-condensed)] md:text-[3rem] lg:text-[3.75rem]`}
            >
              Two modes.
              <br />
              Different trust assumptions.
            </h2>
          </div>

          <div className="grid gap-px border border-black bg-black lg:grid-cols-2">
            {encryptionModes.map((mode) => (
              <div key={mode.label} className="flex flex-col bg-white p-8 md:p-10">
                <div className="mb-6 flex flex-wrap items-baseline gap-3">
                  <span
                    className={`${landingCondensed.variable} text-[1.6rem] leading-none font-bold text-[#0047FF] [font-family:var(--font-landing-condensed)] md:text-[2rem]`}
                  >
                    {mode.label}
                  </span>
                </div>

                <div className="mb-6 grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-[9px] font-bold uppercase tracking-[0.3em] text-zinc-400">
                      Algorithm
                    </div>
                    <div className="mt-1 text-sm font-bold [font-family:var(--font-landing-mono)]">
                      {mode.algorithm}
                    </div>
                  </div>
                  <div>
                    <div className="text-[9px] font-bold uppercase tracking-[0.3em] text-zinc-400">
                      Key derivation
                    </div>
                    <div className="mt-1 text-sm font-bold [font-family:var(--font-landing-mono)]">
                      {mode.kdf}
                    </div>
                  </div>
                  <div>
                    <div className="text-[9px] font-bold uppercase tracking-[0.3em] text-zinc-400">
                      Key size
                    </div>
                    <div className="mt-1 text-sm font-bold [font-family:var(--font-landing-mono)]">
                      {mode.keySize}
                    </div>
                  </div>
                  <div>
                    <div className="text-[9px] font-bold uppercase tracking-[0.3em] text-zinc-400">
                      Nonce
                    </div>
                    <div className="mt-1 text-sm font-bold [font-family:var(--font-landing-mono)]">
                      {mode.nonce}
                    </div>
                  </div>
                </div>

                <p className="mb-6 text-sm leading-[1.7] text-zinc-600">{mode.description}</p>

                <div className="mt-auto space-y-2.5 border-t border-zinc-100 pt-6">
                  {mode.properties.map((prop) => (
                    <div key={prop} className="flex items-start gap-3">
                      <CheckCircle2
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#0047FF]"
                        strokeWidth={1.8}
                      />
                      <span className="text-[11px] font-bold uppercase tracking-widest">
                        {prop}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Capability matrix ── */}
        <section className="border-b border-black bg-white p-6 md:p-12">
          <div className="mb-10 md:mb-14">
            <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.28em] text-[#0047FF]">
              Authorization
            </div>
            <h2
              className={`${landingCondensed.variable} max-w-5xl text-[2rem] leading-[0.92] font-bold uppercase tracking-[-0.04em] [font-family:var(--font-landing-condensed)] md:text-[3rem] lg:text-[3.75rem]`}
            >
              What each agent can do
              <br />
              is defined by a capability matrix.
            </h2>
            <p className="mt-4 max-w-2xl text-sm leading-[1.65] text-zinc-600">
              Every access request is evaluated against the agent&apos;s runtime type, the
              credential&apos;s storage mode, and the requested capability. This matrix is enforced
              before any decryption happens.
            </p>
          </div>

          <div className="overflow-x-auto border border-black">
            <table className="w-full min-w-[40rem]">
              <thead>
                <tr className="border-b border-black bg-zinc-50">
                  <th className="p-4 text-left text-[10px] font-bold uppercase tracking-[0.2em]">
                    Capability
                  </th>
                  <th className="border-l border-black p-4 text-center text-[10px] font-bold uppercase tracking-[0.2em]">
                    Local + ZK
                  </th>
                  <th className="border-l border-black p-4 text-center text-[10px] font-bold uppercase tracking-[0.2em]">
                    Local + Server
                  </th>
                  <th className="border-l border-black p-4 text-center text-[10px] font-bold uppercase tracking-[0.2em]">
                    Remote + ZK
                  </th>
                  <th className="border-l border-black p-4 text-center text-[10px] font-bold uppercase tracking-[0.2em]">
                    Remote + Server
                  </th>
                </tr>
              </thead>
              <tbody>
                {capabilityMatrix.map((row, i) => (
                  <tr
                    key={row.capability}
                    className={i < capabilityMatrix.length - 1 ? "border-b border-zinc-200" : ""}
                  >
                    <td className="p-4">
                      <div className="text-sm font-bold [font-family:var(--font-landing-mono)]">
                        {row.capability}
                      </div>
                      <div className="mt-1 text-[11px] text-zinc-500">{row.description}</div>
                    </td>
                    {(
                      [
                        ["localZK", row.localZK],
                        ["localServer", row.localServer],
                        ["remoteZK", row.remoteZK],
                        ["remoteServer", row.remoteServer],
                      ] as const
                    ).map(([col, status]) => (
                      <td
                        key={`${row.capability}-${col}`}
                        className={`border-l border-black p-4 text-center ${status !== "allowed" ? "bg-zinc-50" : ""}`}
                      >
                        <span
                          className={`text-[11px] font-bold uppercase tracking-widest ${status === "allowed" ? "text-[#0047FF]" : "text-zinc-400"}`}
                        >
                          {statusLabels[status]}
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-4 text-[10px] font-medium text-zinc-400 [font-family:var(--font-landing-mono)]">
            Remote agents cannot access zero-knowledge items by architectural design. The server
            cannot decrypt them.
          </p>
        </section>

        {/* ── Trust boundaries ── */}
        <section className="border-b border-black bg-zinc-50 p-6 md:p-12">
          <div className="mb-10 md:mb-14">
            <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.28em] text-[#0047FF]">
              Trust model
            </div>
            <h2
              className={`${landingCondensed.variable} max-w-5xl text-[2rem] leading-[0.92] font-bold uppercase tracking-[-0.04em] [font-family:var(--font-landing-condensed)] md:text-[3rem] lg:text-[3.75rem]`}
            >
              Four tiers of trust.
              <br />
              Explicit trade-offs at each.
            </h2>
          </div>

          <div className="grid gap-px border border-black bg-black md:grid-cols-2 xl:grid-cols-4">
            {trustTiers.map((tier) => (
              <div key={tier.tier} className="flex flex-col bg-white p-6 md:p-8">
                <div
                  className={`${landingCondensed.variable} text-[2rem] leading-none font-bold text-[#0047FF] [font-family:var(--font-landing-condensed)]`}
                >
                  {tier.tier}
                </div>
                <h3 className="mt-4 text-sm font-bold uppercase tracking-[0.14em]">{tier.name}</h3>
                <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">
                  {tier.trust}
                </div>
                <p className="mt-4 flex-1 text-sm leading-[1.65] text-zinc-600">
                  {tier.description}
                </p>
                <div className="mt-5 border-t border-zinc-100 pt-4 text-[10px] font-bold uppercase tracking-[0.16em] text-zinc-400 [font-family:var(--font-landing-mono)]">
                  {tier.boundary}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Authentication ── */}
        <section className="border-b border-black bg-white p-6 md:p-12">
          <div className="mb-10 md:mb-14">
            <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.28em] text-[#0047FF]">
              Authentication
            </div>
            <h2
              className={`${landingCondensed.variable} max-w-5xl text-[2rem] leading-[0.92] font-bold uppercase tracking-[-0.04em] [font-family:var(--font-landing-condensed)] md:text-[3rem] lg:text-[3.75rem]`}
            >
              Three principals.
              <br />
              Three auth flows.
            </h2>
          </div>

          <div className="grid gap-px border border-black bg-black lg:grid-cols-3">
            {authMechanisms.map((auth) => (
              <div key={auth.label} className="flex flex-col bg-white p-8 md:p-10">
                <div
                  className={`${landingCondensed.variable} text-[1.4rem] leading-none font-bold text-[#0047FF] [font-family:var(--font-landing-condensed)] md:text-[1.8rem]`}
                >
                  {auth.label}
                </div>
                <div className="mt-3 text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400 [font-family:var(--font-landing-mono)]">
                  {auth.method}
                </div>
                <p className="mt-5 text-sm leading-[1.7] text-zinc-600">{auth.flow}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Access flow ── */}
        <section className="grid border-b border-black lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <div className="border-black bg-white p-6 lg:border-r lg:p-12">
            <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.28em] text-[#0047FF]">
              Access flow
            </div>
            <h2 className="max-w-lg text-[2.2rem] leading-[0.96] font-bold tracking-[-0.05em] md:text-[3.5rem]">
              Seven checks before any credential is delivered
            </h2>
            <p className="mt-6 max-w-xl text-sm leading-[1.65] font-medium text-zinc-600">
              Every agent credential request passes through the same authorization pipeline. No
              shortcuts, no bypass. The sequence is fixed.
            </p>
          </div>

          <div className="flex items-center justify-center bg-zinc-50 p-6 lg:p-12">
            <div className="w-full max-w-[34rem] border border-black bg-white">
              <div className="border-b border-zinc-100 p-6 text-center text-[9px] font-bold uppercase tracking-[0.4em] text-zinc-400">
                Authorization pipeline
              </div>
              <div className="divide-y divide-zinc-100">
                {[
                  "Authenticate the agent",
                  "Load the target item for the agent owner",
                  "Verify explicit permission for the exact capability",
                  "Reject expired permissions",
                  "Enforce locality and storage-mode constraints",
                  "Audit the attempt",
                  "Decrypt only if capability and storage mode permit",
                ].map((step, i) => (
                  <div key={step} className="flex items-center gap-4 px-6 py-4">
                    <span className="text-[1.1rem] font-bold text-[#0047FF] [font-family:var(--font-landing-mono)]">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="text-[11px] font-bold uppercase tracking-[0.08em]">
                      {step}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── Audit ── */}
        <section className="border-b border-black bg-zinc-50 p-6 md:p-12">
          <div className="mb-10 md:mb-14">
            <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.28em] text-[#0047FF]">
              Audit
            </div>
            <h2
              className={`${landingCondensed.variable} max-w-5xl text-[2rem] leading-[0.92] font-bold uppercase tracking-[-0.04em] [font-family:var(--font-landing-condensed)] md:text-[3rem] lg:text-[3.75rem]`}
            >
              Append-only.
              <br />
              Metadata only. No secret values.
            </h2>
            <p className="mt-4 max-w-2xl text-sm leading-[1.65] text-zinc-600">
              Every access attempt — allowed and denied — is logged with agent identity, capability
              requested, outcome, timestamp, and IP address. The audit log has no foreign key
              constraints and no update or delete operations.
            </p>
          </div>

          <div className="grid gap-px border border-black bg-black lg:grid-cols-3">
            {auditEvents.map((event) => (
              <div key={event.category} className="bg-white p-8">
                <h3 className="mb-3 text-sm font-bold uppercase tracking-[0.14em]">
                  {event.category}
                </h3>
                <p className="text-sm leading-[1.7] text-zinc-500 [font-family:var(--font-landing-mono)]">
                  {event.events}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Threat mitigations ── */}
        <section className="border-b border-black bg-white p-6 md:p-12">
          <div className="mb-10 md:mb-14">
            <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.28em] text-[#0047FF]">
              Threat model
            </div>
            <h2
              className={`${landingCondensed.variable} max-w-5xl text-[2rem] leading-[0.92] font-bold uppercase tracking-[-0.04em] [font-family:var(--font-landing-condensed)] md:text-[3rem] lg:text-[3.75rem]`}
            >
              What we mitigate.
              <br />
              How we mitigate it.
            </h2>
          </div>

          <div className="grid gap-px border border-black bg-black md:grid-cols-2">
            {threatMitigations.map((item) => (
              <div key={item.threat} className="bg-white p-6 md:p-8">
                <h3 className="mb-2 text-sm font-bold uppercase tracking-[0.14em]">
                  {item.threat}
                </h3>
                <p className="text-sm leading-[1.65] text-zinc-600">{item.mitigation}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Invariants ── */}
        <section className="grid border-b border-black lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <div className="border-black bg-white p-6 lg:border-r lg:p-12">
            <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.28em] text-[#0047FF]">
              Invariants
            </div>
            <h2 className="max-w-lg text-[2.2rem] leading-[0.96] font-bold tracking-[-0.05em] md:text-[3.5rem]">
              Rules that never bend
            </h2>
            <p className="mt-6 max-w-xl text-sm leading-[1.65] font-medium text-zinc-600">
              These properties are enforced in code and verified in review. They are not guidelines
              — they are invariants. Violating any of them is a security regression.
            </p>
          </div>

          <div className="flex items-center justify-center bg-zinc-100 p-6 lg:p-12">
            <div className="w-full max-w-[34rem] border border-black bg-white p-8">
              <div className="mb-6 text-center text-[9px] font-bold uppercase tracking-[0.4em] text-zinc-400">
                Enforced invariants
              </div>
              <div className="space-y-4 border-t border-zinc-100 pt-6">
                {invariants.map((item) => (
                  <div key={item} className="flex items-center justify-between gap-4">
                    <span className="text-[10px] font-bold uppercase tracking-[0.12em]">
                      {item}
                    </span>
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-[#0047FF]" strokeWidth={1.8} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── Honest limitations ── */}
        <section className="border-b border-black bg-zinc-50 p-6 md:p-12">
          <div className="mb-10 md:mb-14">
            <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.28em] text-[#0047FF]">
              Transparency
            </div>
            <h2
              className={`${landingCondensed.variable} max-w-5xl text-[2rem] leading-[0.92] font-bold uppercase tracking-[-0.04em] [font-family:var(--font-landing-condensed)] md:text-[3rem] lg:text-[3.75rem]`}
            >
              What you should know
              <br />
              before trusting us.
            </h2>
          </div>

          <div className="grid gap-px border border-black bg-black md:grid-cols-2">
            {honestLimitations.map((item) => (
              <div key={item.question} className="bg-white p-8 md:p-10">
                <h3 className="mb-4 text-sm font-bold uppercase tracking-[0.1em]">
                  {item.question}
                </h3>
                <p className="text-sm leading-[1.7] text-zinc-600">{item.answer}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── CTA ── */}
        <section className="border-b border-black bg-[#1148F5] px-6 py-20 text-center text-white md:px-12 md:py-28">
          <h2
            className={`${landingCondensed.variable} mx-auto max-w-5xl text-[3.4rem] leading-[0.9] font-bold tracking-[-0.05em] [font-family:var(--font-landing-condensed)] md:text-[6.6rem]`}
          >
            Read the code.
            <br />
            <span>Verify the claims.</span>
          </h2>

          <div className="mt-12 flex flex-wrap justify-center gap-4 md:mt-14">
            <Link
              href="/register"
              className={`${landingCondensed.variable} min-w-[15rem] border border-white bg-white px-10 py-4 text-center text-[1rem] font-bold uppercase tracking-[0.01em] text-[#1148F5] transition-colors hover:bg-[#EAF0FF] [font-family:var(--font-landing-condensed)]`}
            >
              Get started
            </Link>
            <a
              href="https://docs.abadge.io"
              className={`${landingCondensed.variable} min-w-[15rem] border border-white bg-transparent px-10 py-4 text-center text-[1rem] font-bold uppercase tracking-[0.01em] text-white transition-colors hover:bg-[#2B5BFF] [font-family:var(--font-landing-condensed)]`}
            >
              Read the Docs
            </a>
            <a
              href="https://github.com/punitarani/abadge"
              target="_blank"
              rel="noopener noreferrer"
              className={`${landingCondensed.variable} inline-flex min-w-[15rem] items-center justify-center gap-2 border border-white bg-transparent px-10 py-4 text-center text-[1rem] font-bold uppercase tracking-[0.01em] text-white transition-colors hover:bg-[#2B5BFF] [font-family:var(--font-landing-condensed)]`}
            >
              View source
              <ArrowUpRight className="h-4 w-4" strokeWidth={2} />
            </a>
          </div>
        </section>
      </main>

      {/* ── Footer ── */}
      <footer className="bg-white p-8">
        <div className="mx-auto flex max-w-[96rem] flex-col gap-8 md:flex-row md:items-start md:justify-between">
          <div className="order-2 max-w-xs md:order-1">
            <div className="mb-1 inline-flex items-center gap-2">
              <Image src="/abadge-logo-black.svg" alt="abadge logo" width={24} height={24} />
              <span className="text-xl font-bold tracking-[-0.04em]">abadge</span>
            </div>
            <span className="mb-4 block whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.3em] text-zinc-400">
              Credential control plane for AI agents
            </span>
          </div>

          <div className="order-1 flex items-center gap-6 text-[10px] font-bold uppercase tracking-widest whitespace-nowrap md:order-2">
            <a
              href="https://github.com/punitarani/abadge"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-[#0047FF]"
            >
              GitHub
            </a>
            <a
              href="https://docs.abadge.io"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-[#0047FF]"
            >
              Docs
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
