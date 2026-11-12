# Team secret gateway: implementation design

Status: proposed, 2026-11-12. Issue: #1775. Needs coordinator review before any product code (persisted state, wire protocol and a security surface all change). Research and the request rules this design relies on: [the decision brief](../research/1775-secret-gateway-design.md) and [the prior-art note](../research/1775-gateway-prior-art.md).

## Decisions this design rests on

Ian answered the brief's four questions on 2026-11-12:

1. **Scope.** The first milestone covers isolated execution only: a step that runs in a local Orb guest. A step on the host has no boundary the gateway could rely on, so it keeps plaintext delivery and the product shows that delivery as legacy.
2. **Responses.** An upstream the owner explicitly binds to a secret may return anything. An upstream that echoes the credential cannot be stopped; the product says so next to the setting. No per-service response adapters in this milestone.
3. **Existing secrets.** They stay as they are, shown as legacy plaintext, and the owner migrates each one. Nothing is converted or reauthorized automatically.
4. **Gateway choice.** A prototype on a real Orb host compares Envoy with an extension of the existing egress relay before the production data plane is chosen.

## What is promised

For a secret whose delivery is `http`, on a step that runs in a local Orb guest, the value never enters the guest: not the token response, the vault, a tool result, the environment, the transcript or a file. The guest holds an opaque placeholder; the gateway outside the guest replaces it in one header of a request to one origin.

Not promised: that the bound upstream keeps the value to itself (decision 2), that the agent uses the authorized API well, or anything about host steps, remote sandboxes and `plaintext` secrets.

## Why the Orb is the boundary

Source observations on `78ff80e`:

- A local Orb guest is created with `--network none` (`apps/daemon/src/orb/podman.ts`) or on the proxy-only nspawn zone. Its only way out is the host egress relay (`scripts/ops/orb/egress-relay.mjs`), which runs under its own unit outside the guest, resolves names itself, refuses private and loopback addresses and identifies each client guest from the peer credential of its connection.
- `runStep`, the secret vault and `get_secret` run inside the guest (`apps/daemon/src/orb/worker.ts`). The guest has no server credential: every machine call, `token` included, goes through `RelayMachineServer` in the host daemon (`apps/daemon/src/orb/relay.ts`, `ORB_STEP_METHODS`).

So two processes already sit outside the guest on every path a secret takes: the host daemon between the server and the guest, and the relay between the guest and the network. The design changes what each lets through. It adds no new isolation mechanism.

A remote sandbox (`openRelayStream` providers) does not send its traffic through the host relay. It counts as a host step here.

## Persisted state

`secret` table, new columns:

| Column | Type | Meaning |
|---|---|---|
| `delivery` | `'plaintext' \| 'http'`, not null, default `'plaintext'` | How a step may receive the value |
| `httpOrigin` | text, null unless `http` | `https://host[:port]`, exact, normalized |
| `httpHeader` | text, null unless `http` | The one header that may carry the value |
| `httpTemplate` | text, null unless `http` | Header value with one `{secret}` slot, for example `Bearer {secret}` |
| `policyRevision` | integer, not null, default 1 | Incremented by every write to the four columns above or to the value |

The migration only adds columns; every existing row becomes `plaintext` at revision 1 and no cipher text is touched. A strict schema validates `http` rows on write with the brief's rules: HTTPS only, no wildcard, IP literal, userinfo or path, no CR or LF in header or template, exactly one slot. Changing `delivery` from `http` to `plaintext` is an owner action in the settings page like any other edit; nothing does it implicitly.

## Wire

`MachineTokenResponse` keeps `secrets: Record<string, string>` for `plaintext` secrets only and gains:

```ts
httpSecrets?: Array<{
  id: string; name: string; revision: number;
  origin: string; header: string; template: string; value: string;
}>
```

The token request gains `surface: 'orb' | 'host'` (absent means `host`). The server fills `httpSecrets` only when all three hold: the machine declared the `secretGateway` capability, the request says `orb`, and the step is one that gets team secrets today. In every other case an `http` secret is left out of the response entirely and its name is listed in `withheldSecrets: string[]`. It is never moved into `secrets`.

An older daemon sends no surface and declares no capability, so it receives no `http` value; an older server sends no `httpSecrets`, and the new daemon treats that as none. Neither direction can deliver an `http` value as plaintext.

The guest never sees `httpSecrets`. The host relay replaces it with `secretPlaceholders: Record<string, { placeholder: string; origin: string; header: string }>` before the response crosses into the guest.

## Grant lifecycle

A grant is the gateway's permission to substitute one secret for one guest. It lives only in gateway memory.

| State | Entered when | Left when |
|---|---|---|
| none | initial | host daemon registers |
| active | registration accepted; gateway returns a fresh random placeholder | any revoke cause |
| revoked | final for that placeholder | never; a later registration creates a new grant and a new placeholder |

The host daemon registers over an admin Unix socket that is outside every guest bind mount and accepts only the daemon's uid by peer credential. One connection per step; **the grant lives exactly as long as that connection.** Registration is keyed by `(guest identity, step id, secret id, revision)` and is idempotent on an open connection, so the token refresh the runner does for Git credentials gets the same placeholder back.

Revoke causes, all of which reduce to closing the connection: step done or failed, stop, watchdog trip, worker disconnect, heartbeat timeout, daemon exit, gateway exit. On revoke the gateway also closes the guest's open connections to that origin.

## Gateway behavior

For a guest connection the relay already identifies:

- `CONNECT` to an authority that matches an active grant of that guest: terminate TLS with a leaf certificate for that host name, read HTTP/1.1 (HTTP/2 is not offered), apply the brief's request rules, build the one header from the template, and forward over a new TLS connection verified against the same host name.
- Any other destination: exactly today's behavior, an opaque tunnel with the existing address checks. No interception, so nothing changes for guests or steps without `http` secrets.

The placeholder is substituted only when it is the complete slot content of the bound header. A known placeholder in a URL, query, body or another header is a refused request. The signing key for leaf certificates belongs to the gateway and is not readable from any guest; guests receive the public certificate through the per-guest trust variables only.

## Every path that reads or writes a secret value or its policy

One test per row.

| # | Path | Today | With this design |
|---|---|---|---|
| 1 | `createSecret` and its update (`services/secrets.ts`), settings page | seals the value | also validates and stores the policy; any policy or value write bumps `policyRevision` |
| 2 | `openSecretValues` via `resolveStepCredentials` (`services/credentials.ts`) | name to value map | returns `plaintext` values and `http` entries separately |
| 3 | `stepToken`, worker branch (`services/machine-step-token.ts`) | puts the map on the wire | applies the capability and surface rule; fills `httpSecrets` or `withheldSecrets` |
| 4 | `stepToken`, Coordinator branch | empty map | unchanged; a test pins that it never carries `httpSecrets` |
| 5 | Host step: `MachineClient.token` then `pushCredential` | vault of values | asks with `host`; vault holds `plaintext` only; `get_secret` on a withheld name explains that the secret needs an isolated step |
| 6 | Orb step: `RelayMachineServer` `token` operation | forwards the response | asks with `orb`; registers each `httpSecrets` entry; forwards placeholders, never values; registration failure fails the token call |
| 7 | Guest `pushCredential` and `buildSecretTool` (`credentials.ts`, `secret-channel.ts`) | returns the value | for a placeholder entry returns the placeholder with its origin and header; audit line records `delivery=http` |
| 8 | Runner token refresh for Git | second `token` call | same grant, same placeholder (row 6 idempotence) |
| 9 | `prepareWebTools` provider keys (`backend/web-search.ts`) | takes two named keys from the vault | unchanged; those two names are refused as `http` on write, because the daemon itself must read them |
| 10 | Mail secrets (`isMailSecretName`) | separate channel | unchanged; refused as `http` on write for the same reason |
| 11 | `clearCredentials`, step end, stop, timeout, disconnect | empties the vault | also closes the admin connection (revoke) |
| 12 | Session continue or fallback to a new session | same vault | same grant while the step lives; a later step gets a new placeholder, and a placeholder left in an old transcript is inert |
| 13 | Transcript and log redaction (`guardCredentialOutputs`) | redacts known values | unchanged for `plaintext`; there is no `http` value in the guest to redact |
| 14 | Agent secret assignment (`routing-rules.ts`, agent `secrets` list) | list of secret ids | unchanged; delivery is a property of the secret, not of the assignment |

## Failure behavior

| Failure | Behavior |
|---|---|
| Machine lacks the capability, or the step runs on the host or in a remote sandbox | value withheld, name in `withheldSecrets`, tool explains; the step still runs |
| Gateway unreachable or registration refused when the Orb step asks for its token | the token call fails and the step fails with a named error; no fallback to plaintext |
| Gateway exits during a step | grant gone; the placeholder reaches the upstream unsubstituted or the connection is refused; the daemon writes one system row to the transcript; no re-registration in that step |
| Host daemon exits during a step | admin connection closes, grant revoked, guest connections to that origin closed |
| Policy edited or secret deleted during a step | the running step keeps the revision it was granted; the next token call sees the new revision or no secret |
| Guest client does not trust the step certificate, or pins its own | TLS fails in the client; no direct route exists to fall back to |
| Authority, SNI and Host disagree; duplicate or caller-supplied bound header; redirect to another origin | request refused, or forwarded without substitution where the brief says so; one audit line with the reason and no value |
| Another guest presents a valid placeholder | no grant for that guest identity; treated as an unknown string |

## Prototype (decision 4)

Before the gateway PR, on a real Orb host, two throwaway data planes behind the same admin contract: Envoy with a header-mutation filter, and the existing relay extended with `node:tls` termination, `node:http` parsing and a maintained X.509 library for leaf certificates (no hand-written TLS, HTTP or ASN.1). Each runs the brief's failure inventory rows for direct disclosure, wrong location, SNI and Host mismatch, redirect, cross-step access, revoke on disconnect and certificate failure, with real headers captured at a controlled upstream. The result table and the choice are added to this document. Criteria, in order: inventory rows passed, privileged surface added to the host, install and upgrade footprint in `scripts/ops/orb`, added latency.

## Change sequence

Each is one PR from `origin/main`, written test-first from the tables above. PRs 1, 2 and 5 touch security surfaces and merge on Ian's route with `/security-review`.

1. Schema columns, policy validation and the API, with every secret still `plaintext`. No behavior change.
2. Wire fields, the `secretGateway` capability and the server's surface rule. No daemon declares the capability yet, so an `http` secret is withheld everywhere.
3. Prototype scripts and the result table (no product code).
4. The chosen gateway, the admin socket and the host install units.
5. Host daemon registration and revoke; guest placeholders and the tool text; the daemon declares the capability when the gateway answers.
6. Settings page: delivery choice, origin and header fields, the legacy label and the echo limitation. Feature-map row and design brief first.
7. Acceptance run on a real Orb host for every inventory row in scope, with captured upstream headers and model-facing artifacts.
