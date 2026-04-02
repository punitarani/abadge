# Capability Matrix

## Principal Types

| Kind | Locality | Auth Method | Can Decrypt ZK | Description |
|------|----------|-------------|----------------|-------------|
| `device` | local | Session token | Yes (via daemon) | User's registered device |
| `local_cli` | local | Session token | Yes (via daemon) | CLI installation |
| `local_mcp` | local | Session token | Yes (via daemon) | Local MCP server |
| `remote_agent` | remote | API key | No | Hosted agent, cloud worker, webhook |

## Capabilities

| Capability | Description | ZK Items | Server-Managed Items |
|------------|-------------|----------|---------------------|
| `read_ciphertext` | Receive encrypted item data | Local only | Local only |
| `reveal_plaintext` | Receive decrypted plaintext | Not allowed | Remote + Local |
| `mount_env` | Inject as env var in subprocess | Local only (daemon) | Local only (daemon) |
| `mount_file` | Write to temp file | Local only (daemon) | Local only (daemon) |
| `use_without_reveal` | Use without seeing value (future: sign, mint) | Future | Future |

## Grant Validation Rules

When creating a grant, the server enforces:

1. **Remote + ZK + reveal**: Denied. Remote principals cannot reveal ZK items.
2. **Remote + ZK + any**: Denied. Remote principals cannot access ZK items at all.
3. **Remote + managed + reveal**: Allowed. This is the primary remote use case.
4. **Remote + managed + mount**: Denied. Remote principals can't mount locally.
5. **Local + ZK + any non-future capability**: Allowed. Daemon handles decryption.
6. **Local + managed + any non-future capability**: Allowed.

```mermaid
flowchart TD
  START["Grant request:<br/>principal + item + capability"] --> LOC{"Principal<br/>locality?"}

  LOC -->|local| SM1{"Item storage<br/>mode?"}
  LOC -->|remote| SM2{"Item storage<br/>mode?"}

  SM1 -->|zero_knowledge| CAP1{"Capability?"}
  SM1 -->|server_managed| CAP2{"Capability?"}
  SM2 -->|zero_knowledge| DENY1["DENIED<br/>Remote cannot access ZK"]
  SM2 -->|server_managed| CAP3{"Capability?"}

  CAP1 -->|read_ciphertext| OK1["ALLOWED"]
  CAP1 -->|reveal_plaintext| DENY2["DENIED<br/>Cannot reveal ZK"]
  CAP1 -->|mount_env / mount_file| OK2["ALLOWED"]
  CAP1 -->|use_without_reveal| DENY3["DENIED<br/>Future capability"]

  CAP2 -->|any non-future| OK3["ALLOWED"]
  CAP2 -->|use_without_reveal| DENY4["DENIED<br/>Future capability"]

  CAP3 -->|reveal_plaintext| OK4["ALLOWED"]
  CAP3 -->|any other| DENY5["DENIED<br/>Remote: reveal only"]

  style OK1 fill:#dfd,stroke:#3c3
  style OK2 fill:#dfd,stroke:#3c3
  style OK3 fill:#dfd,stroke:#3c3
  style OK4 fill:#dfd,stroke:#3c3
  style DENY1 fill:#fdd,stroke:#c33
  style DENY2 fill:#fdd,stroke:#c33
  style DENY3 fill:#fdd,stroke:#c33
  style DENY4 fill:#fdd,stroke:#c33
  style DENY5 fill:#fdd,stroke:#c33
```

## Access Route Mapping

| Route | Required Capability | Item Mode | Principal Locality |
|-------|--------------------|-----------|--------------------|
| `POST /v1/access/ciphertext` | `read_ciphertext` | `zero_knowledge` | local |
| `POST /v1/access/reveal` | `reveal_plaintext` | `server_managed` | any |
| `POST /v1/access/mount` | `mount_env` or `mount_file` | any | local |

## Delivery Flow by Scenario

| Scenario | Flow |
|----------|------|
| User views ZK item in browser | Browser decrypts locally using root key in memory |
| CLI runs command with ZK secret | CLI → daemon (IPC) → daemon decrypts → daemon spawns subprocess with env var |
| Local MCP uses ZK secret | MCP → daemon (IPC) → daemon decrypts → daemon injects |
| Remote agent reveals managed secret | Agent → API (HTTPS) → server decrypts → returns plaintext |
| Remote agent tries to access ZK item | Denied at grant validation or access route |

```mermaid
flowchart LR
  subgraph Scenario1["Local + ZK: mount_env"]
    direction LR
    CLI1[CLI] -->|IPC| D1[Daemon]
    D1 -->|unwrap DEK<br/>decrypt payload| D1
    D1 -->|inject env var| SUB1[Subprocess]
  end

  subgraph Scenario2["Local + SM: mount_file"]
    direction LR
    CLI2[CLI] -->|HTTPS| API2[API]
    API2 -->|decrypt with<br/>ENCRYPTION_KEY| API2
    API2 -->|payload| CLI2
    CLI2 -->|write 0600| FILE2[Temp File]
  end

  subgraph Scenario3["Remote + SM: reveal"]
    direction LR
    AGENT3[Remote Agent] -->|HTTPS| API3[API]
    API3 -->|decrypt with<br/>ENCRYPTION_KEY| API3
    API3 -->|JSON payload| AGENT3
  end

  subgraph Scenario4["Remote + ZK: any"]
    direction LR
    AGENT4[Remote Agent] -->|HTTPS| API4[API]
    API4 -->|BLOCKED| AGENT4
  end

  style Scenario4 fill:#fdd,stroke:#c33
```
