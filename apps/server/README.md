# @xiechimon/cairn

The replica server (03 ROADMAP M2): Hono REST + SSE (all SSE, no WebSocket, 02 §1.2), SQLite (better-sqlite3 + Drizzle, migrations in the repo with CI drift validation, 01 §6), single-user seed with team-shaped fidelity (02 §2). The protocol vocabulary has a single source in `@cairn/shared` (02 §5/§6 canonical; route contract tests = `test/wire.test.ts`).

## Running

```sh
pnpm dev:server          # tsx watch (development)
pnpm --filter @xiechimon/cairn start
PORT=8791 CAIRN_HOME=/tmp/cairn-demo bash apps/server/scripts/demo.sh  # demo surface (start the server in another window)
```

## Data root (single data root, backup = copy the directory, 01 §4.2)

Default `~/.cairn/server/` (`CAIRN_HOME` overrides the home directory; the directory name is the brand slot, the D3 switch has been triggered, #109):

| File | Content |
|---|---|
| `server.db` | SQLite with 24+1 tables (the 01 §6 locked list; WAL) |
| `secretbox.key` | SecretBox keyfile: 32 random bytes (base64), mode 0600, generated on first start (01 §4.2) |

## The three key layers (02 §8)

- **At rest**: provider keys and team Secret values are uniformly encrypted with AES-256-GCM before persisting (envelope = `v1` version header + iv + ciphertext + authTag); the key source is the local keyfile, with no external KMS or passphrase derivation introduced (locked by Q5).
- **Runtime**: model keys are issued per step (`services/credentials.ts` resolution chain; the HTTP endpoint `/api/machine/token/{stepId}` is wired in M3), held in executor memory, and never persistently written to disk; team Secrets are issued per the Agent authorization set (narrowed by step kind: plan/review/chief steps always get empty) — the plaintext appears only in the `token/{stepId}` response and is not pre-placed in the task shell environment: the daemon holds the truth, and the agent takes it explicitly through the per-step retrieval channel.
- **API surface**: key-class fields are **write-only masked** — GET never returns `apiKey` / secret values; apiKeys are stored as a hash (SHA-256), not a reversible value, and the create response carries the plaintext once as `cairn_<48hex>` ("Please copy the key now; it is shown only once."); after that, list rows show the masked `cairn_afe07565…`.

> **Guardrail (02 §8 recovery semantics): losing the keyfile = all existing provider keys and team Secret values are dead and must be re-entered.**
> Encryption is at-rest disk protection, not a recoverable backup — "encrypted ≠ recoverable". Backing up the data root together with
> `secretbox.key` is a complete backup; copying only `server.db` without the keyfile leaves the ciphertext permanently undecryptable.

Threat model: the self-host scenario = at-rest disk protection on the local machine + minimal runtime exposure; it does not promise todos.dev cloud multi-tenant isolation semantics (out of scope, 02 §8).

## Notifications (02 §9.1 / 04 §5 divergence criteria)

The SSE team stream `notification` event has three types: `plan_ready` (enters confirm) / `build_review` (enters review, including scheduled rounds) / `chief_message` (Chief thread message, wired in M4); entering done/fired emits no event. The row id is the composite key `<userId>:<entityId>` (upsert on the same key); unread linkage via `GET /api/teams/{id}/notifications` → `{unreadThreadIds}`. No Web Push/VAPID (an intentional divergence already ruled on; desktop popups = the web page layer calling `new Notification()` when `document.hidden`).
