# Capabilities

abadge has two canonical capabilities and two grant targets.

## The two capabilities

| Capability | What the agent can do | What the agent sees |
|------------|----------------------|---------------------|
| `read` | Read a credential's plaintext via `POST /v1/access/{itemId}/read`. | The decrypted payload (server-managed) or the ZK envelope it must decrypt locally. |
| `use` | Reserve a mount handle via `POST /v1/access/{itemId}/use` and redeem it through the local daemon. The daemon injects the secret into a subprocess via env var or `0600` temp file. | An opaque `mountId` and an `expiresAt`. Never the plaintext. |

`read` is the higher-privilege capability. Grant `use` whenever the agent
only needs to invoke a process with a secret — never to read it.

Legacy names continue to work as aliases:

| Legacy | Canonical |
|--------|-----------|
| `read_ciphertext` | `read` |
| `reveal_plaintext` | `read` |
| `mount_env` | `use` |
| `mount_file` | `use` |

The server stores grants with the canonical names; legacy names are
normalized at the API boundary.

## The two grant targets

A grant targets either a single item or an entire profile.

| Target | Body shape | Scope |
|--------|-----------|-------|
| Item | `{ agentId, itemId, capabilities }` | The named item only. |
| Profile | `{ agentId, profileId, capabilities }` | Every item currently in the profile **and every item added to it in the future**. |

Profile-target grants are atomic: when a new item is created in a granted
profile, the same agent has the same capabilities on the new item with no
extra grant call.

## Runtime constraints

Some (agent locality, storage mode, capability) tuples are unreachable at
runtime and will be rejected when you create the grant. The server checks
two axes:

* **Locality**: remote agents have no daemon, so `use` is rejected for
  remote agents.
* **Storage mode** (for item grants only): a `zero_knowledge` item cannot
  be decrypted server-side, so `read` is rejected when granted to a remote
  agent on a ZK item. Local agents always work — the daemon decrypts.

| Agent locality | Item storage | `read` | `use` |
|----------------|--------------|--------|-------|
| `local` | `server_managed` | allowed | allowed |
| `local` | `zero_knowledge` | allowed | allowed |
| `remote` | `server_managed` | allowed | denied (no local daemon) |
| `remote` | `zero_knowledge` | denied (server can't decrypt) | denied |

Profile-target grants pre-check the constraint against every storage mode
present in the profile; if any item in the profile would violate the
matrix, the grant is rejected with `meta.invalidCapabilities` listing
which capability failed.

## Blast-radius caution

A profile-target `read` grant is the most permissive shape in abadge. It
gives the agent the plaintext of every credential currently stored in the
profile **and every credential added later**. Before granting:

* Consider `use` instead. The agent invokes processes with the secret but
  never sees it.
* Consider an item-target grant. The agent can only read the specific
  credential it needs.
* If you must use profile + `read`, scope the profile narrowly. Profiles
  are the smallest unit of blast radius in abadge.

The dashboard surfaces a confirmation dialog before any profile + `read`
grant is created.

## Audit

Every access attempt — allowed, denied, expired, or revoked — writes a row
to `audit_logs`. Profile-target grants log under both the agent and the
profile so audit queries by either dimension surface them.
