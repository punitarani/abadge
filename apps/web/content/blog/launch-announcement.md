---
title: "abadge: a credential control plane for AI agents"
summary: "Why I built a vault that hands secrets to agents without the value ever entering the model's context — and an honest accounting of what's shipped and what isn't."
seoDescription: "abadge is a credential control plane for AI agents: store secrets zero-knowledge, grant scoped per-secret access, and deliver them to a command or MCP tool without the value ever entering the model's context. An honest beta launch."
date: "2026-06-01"
author: "Punit Arani"
category: "Launch Announcement"
published: true
---

Every MCP tool I wired up wanted the same thing: paste your API key into the `env` block of an `mcp.json`, restart the client, done. A live, long-lived secret, sitting in plaintext in a config file, handed to a process that pipes tool output back into a language model. I did it. You've probably done it. It works, and it feels wrong, and there was no obvious better path that didn't involve standing up a whole secrets-management stack I didn't want to operate.

I'm not the only one who hit this, and I'm not the only one who tried to fix it by hand. Go looking and you'll find a small wave of developers building their own credential brokers for coding agents, several of them literally wrapping [Filippo Valsorda's `age`](https://github.com/FiloSottile/age) to keep keys encrypted at rest and lease them to an agent on demand. [`agent-secrets`](https://github.com/joelhooks/agent-secrets) does exactly this: age-encrypted vault, session leases, a killswitch. [Others](https://github.com/devonartis/agentwrit) hand out short-lived task-scoped tokens instead. The convergence is the tell. Independent people arriving at the same shape ("the agent shouldn't be the thing holding the credential," as [Infisical put it](https://infisical.com/blog/credential-brokering-for-ai-agents)) means it's a real, unmet need, not a niche itch.

The shape of the problem is also now well-measured. A scan of roughly 5,200 open-source MCP servers found about [79% store credentials in plaintext environment variables, and only ~8.5% use OAuth](https://astrix.security/learn/blog/state-of-mcp-server-security-2025/). On the leakage side, [24,008 unique secrets turned up in MCP-related config files on public GitHub in 2025](https://www.gitguardian.com/state-of-secrets-sprawl-report-2026), and [2,117 of them were verified still valid](https://thehackernews.com/2026/03/) (GitGuardian's State of Secrets Sprawl, reported by The Hacker News). This isn't a discipline problem you can scold away — it's the default the ecosystem ships.

And the protocol doesn't save you. The MCP spec's OAuth 2.1 work is real, but it [covers client-to-server transport authentication only; stdio servers are explicitly told to read credentials from environment variables](https://modelcontextprotocol.io/specification). It says nothing about the downstream secret your server actually holds: the Stripe key, the database URL, the GitHub token the tool needs to do its job. That secret is the 79% problem, and the spec leaves it to you.

So I built the thing I wanted. It's called **abadge**, and it's a credential control plane for AI agents.

## What it actually does

The model is four verbs: **Store → Permission → Deliver → Audit.**

- **Store** a secret in a profile, in one of two modes.
- **Permission** a specific agent to use a specific item with a specific capability. No wildcards.
- **Deliver** the secret at runtime, into a subprocess or to an MCP tool, without the value entering the model's context.
- **Audit** every access attempt, allowed or denied, in an append-only log.

abadge holds the secret and hands it over, scoped and audited. To be clear about the boundaries: **it does not run your agents, execute your tools, or mint your OAuth tokens.** It is the custody-and-delivery layer, not the runtime.

### The part I care about most: the secret never enters the model's context

This is the structural property, not a setting you toggle.

When an agent uses the MCP `run_with_secret` tool, abadge spawns the subprocess with the secret injected as an environment variable, lets the command run, and returns to the model only an exit code, a duration, and an output-line count. The output text and the secret value never go back to the model. `mount_secret` returns an opaque mount id, never the file path. The captured output is bounded and dropped. The model gets metadata, not material.

That's the cleanest answer I know to the obvious objection: *an LLM with your API key in its context will, eventually, print it into a log, a transcript, or a tool call you didn't expect.* The way you prevent that is to never put the value there in the first place.

The same property holds at the CLI:

```bash
# store a secret (the --value flag is rejected on a TTY; you'll be
# prompted for the value, so it never lands in your shell history)
abadge item add --label STRIPE_KEY

# grant one agent one capability on one item, by id
abadge permission create \
  --agent-id <agent-id> \
  --item-id <item-id> \
  --capability use

# inject it into any subprocess — the command sees it, you don't
abadge run --item <item-id> -- ./deploy.sh
```

> Note on commands: `item add` and `agent add` are the current verbs (`item create` / `agent register` still work as deprecated aliases). Capabilities collapsed to a canonical `read` / `use` pair (the legacy `read_ciphertext` / `reveal_plaintext` / `mount_env` / `mount_file` names are still accepted on the wire). `permission create` takes `--agent-id` / `--item-id`.

### Two storage modes, and an honest framing of the trade

**Zero-knowledge** items are encrypted client-side with XChaCha20-Poly1305; the key is derived from your password with Argon2id, in your browser or CLI or local daemon, never on the server. The server only ever stores ciphertext it cannot decrypt. We do not see your secret, *not even to deliver it.*

Zero-knowledge isn't free, and I won't pretend otherwise. It's slower than caching a key in RAM, and it can't protect a secret your own machine is actively misusing while it's unlocked. What it buys you is a proof property: a server breach exposes ciphertext, not credentials. That's a real, narrow guarantee — so I'm stating it narrowly.

**Server-managed** items use AES-256-GCM with a server-held key. It's the convenient mode; abadge can decrypt these to deliver them, and the trade is the inverse of zero-knowledge. Both modes exist because the right choice depends on your threat model, and you should get to pick.

### Scoped grants and an audit trail

Every grant is a `(agent, item, capability)` tuple. Capabilities are specific: the canonical pair is `read` (return the secret) and `use` (deliver it into a subprocess via env or file mount), and the access boundary enforces locality and storage-mode constraints on top. Batches are atomic: submit several capabilities in one call and you get all of them or none, never a half-applied partial grant. There are no wildcards in v1.

Agents authenticate with an Ed25519 keypair and exchange it for a short-lived (15-minute) session token that auto-refreshes; there's no long-lived agent secret sitting on disk. And every access attempt (allowed, denied, expired, revoked) lands in an append-only audit log with the agent, item, capability, and delivery mode.

I'll concede the obvious: per-agent permissions and audit logs are becoming table stakes, and several competitors advertise them. What I think is actually differentiated is the *granularity of the grant model* (per-`(agent, item, capability)`, no wildcards, atomic batches) and the fact that it composes with the zero-knowledge and no-context-leak properties. Holding all three at once is what's hard to find elsewhere. As best I can tell from surveying the field, no competitor offers client-side zero-knowledge custody for agent credentials: the proxy, gateway, and incumbent products (Infisical Agent Vault, 1Password, Composio, Okta/Auth0, Keycard, Runlayer) all hold plaintext or root keys server-side at some point. That's my read of the landscape, not a lab-tested claim, and I'd happily be corrected.

## What is *not* done yet

I'd rather you hear this from me than find it.

- **Sign-in is OAuth-only right now** (Google or GitHub). Email/password signup isn't ready — the mailer for verification isn't wired up, and I'd rather ship the path that works than a half-baked one. So: sign in with GitHub or Google for now.
- **No SOC2, no ISO, no compliance attestation.** I'm not going to call this "enterprise-grade" because that would be a lie. What I can offer instead is an auditable client and a [published security model](https://docs.abadge.io/security) that spells out the trust boundaries (including the breach-impact table below).
- **It's a beta, and the hosted service is free during the beta.** No tiers, no card, no pricing page yet, because there's no billing yet. When that changes I'll say so plainly.
- **Hosted today; self-host is on the roadmap, not shipped.** There's no operator deployment guide I'd stand behind, so I'm not going to promise you can run it yourself yet.

None of these are load-bearing for the core claims. The encryption, the scoped delivery, the no-context-leak property, and the audit log all work today. The unfinished parts are the launch surface, and I'd rather launch honest than launch padded.

## Come poke holes in it

For a *credential* product, "trust us" is the wrong posture. The right one is "verify us." So:

- The **client-side crypto, CLI, and MCP server are open source** ([MIT](https://github.com/punitarani/abadge/blob/main/LICENSE)). The code that does the zero-knowledge encryption and key-wrapping is the proof of the central claim, so read it rather than take my word for it: [github.com/punitarani/abadge](https://github.com/punitarani/abadge).
- Releases ship **cosign keyless signatures and CycloneDX SBOMs**, and the `install.sh` SHA-256-verifies what it downloads.
- abadge implements the **auth.md anonymous agent-registration flow** (the WorkOS open agent-registration protocol), so an agent can self-register a personal account a human later claims.

Where I most want scrutiny: the [threat model](https://docs.abadge.io/security). Zero-knowledge mode protects you against a server breach and against abadge-the-operator; it does not protect a secret while your own unlocked machine is misusing it, and the no-context-leak property is about the *value*, not about whatever an agent chooses to do with the *result* of using it. If you think the trust model breaks somewhere I haven't named, that's exactly the conversation I want.

## Try it

If you build MCP servers or run coding agents and you've ever pasted a live key into an `env` block and felt the small wince — that's the wince this is for.

It's free during the beta, no card. Sign in with GitHub or Google, run the 60-second quickstart, read the encryption code, and tell me where it falls down: **[github.com/punitarani/abadge](https://github.com/punitarani/abadge)** · hosted at [abadge.io](https://abadge.io). I read every issue.

— Punit
