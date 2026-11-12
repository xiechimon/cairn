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

Not promised:

- That the bound upstream keeps the value to itself (decision 2). An echoed value lands in a tool result and is stored like any other text: transcripts, session files, the host outbox copies and turn snapshots are not redacted against `http` values in this milestone. Server-side redaction would add a reader of the value and is left out on purpose.
- That the agent uses the authorized API well.
- Anything about host steps, remote sandboxes and `plaintext` secrets.

**Trust assumption.** Everything that runs under the daemon's host uid outside a guest is trusted with `http` values: it can read the machine credential, ask for a token with any surface, reach the admin socket and read gateway memory. On an Orb machine that is the daemon itself, Coordinator steps (`runOrbStep` sends `chief` steps to the host runner) and any step a `host` provider runs. The surface rule below therefore protects against an old or misconfigured daemon and against guests, not against code already running as the daemon.

## Why the Orb is the boundary

Source observations on `5bad9a5`:

- A local Orb guest is created with `--network none` (`apps/daemon/src/orb/podman.ts`) or on the proxy-only nspawn zone (`scripts/ops/orb/cairn-orb.nspawn`). Its only way out is the host egress relay (`scripts/ops/orb/egress-relay.mjs`), which runs under its own unit outside the guest, resolves names itself and refuses private and loopback addresses.
- The relay computes a client identity only on its Unix socket listener, from the peer pid and that pid's cgroup (`identityFromCgroup`, which recognizes `libpod-*` scopes only), and uses it for connection limits. That is the podman backend with an egress socket. An nspawn guest, the default backend, reaches the relay over TCP on the zone bridge, and a TCP client has an empty identity. A source address on that bridge is chosen by the guest and is not an identity.
- `runStep`, the secret vault and `get_secret` run inside the guest (`apps/daemon/src/orb/worker.ts`). The guest has no server credential: every machine call, `token` included, goes through `RelayMachineServer` in the host daemon (`apps/daemon/src/orb/relay.ts`, `ORB_STEP_METHODS`).

So two processes already sit outside the guest on every path a secret takes: the host daemon between the server and the guest, and the relay between the guest and the network. The design changes what each lets through. It adds no new isolation mechanism.

**Guest identity is a precondition, and the identity is the listener.** Today's identity (`unixClientIdentity`) reads the peer pid at connect time and `/proc/<pid>/cgroup` later, returns `'unknown'` on any failure, and is shared by every client when the peer-credential addon did not load. That is good enough for connection limits and not for authorization: a reused pid would attribute a connection to another guest. The gateway therefore does not authorize by cgroup lookup. It opens one listener socket per guest, placed in that guest's private runtime bind and nowhere else, and a grant matches only connections accepted on its guest's listener. No `/proc` read, no parser, no race.

- The shared socket listener and the TCP listener stay as they are for ordinary egress and never substitute anything. An identity of `''` or `'unknown'` can neither register nor match a grant.
- podman with an egress socket: the host daemon already binds a socket path into the guest; the gateway PR makes that path the guest's own listener.
- podman with `egress: 'none'`: no path to the gateway exists. It counts as a host step.
- nspawn, the default backend: guests reach the relay over TCP on the zone bridge today. The gateway PR gives each guest a listener in its runtime bind and a loopback forwarder inside the guest that the proxy variables point to. Until the prototype shows that on a real host, the daemon asks for nspawn steps with `host` and their `http` secrets are withheld.
- A remote sandbox (`openRelayStream` providers, whose `kind` is also `'orb'`) does not send its traffic through the host relay. It counts as a host step.

The prototype's identity tests: guest A connecting to guest B's listener path (must not exist in A), a guest connecting over the shared socket and over TCP, and a guest whose listener was removed after revoke.

## Persisted state

`secret` table, new columns:

| Column | Type | Meaning |
|---|---|---|
| `delivery` | `'plaintext' \| 'http'`, not null, default `'plaintext'` | How a step may receive the value |
| `httpOrigin` | text, null unless `http` | `https://host[:port]`, exact, normalized |
| `httpHeader` | text, null unless `http` | The one header that may carry the value |
| `httpTemplate` | text, null unless `http` | Header value with one `{secret}` slot, for example `Bearer {secret}` |
| `policyRevision` | integer, not null, default 1 | Incremented by every write to the four columns above or to the value |

The migration only adds columns; every existing row becomes `plaintext` at revision 1 and no cipher text is touched. A table `CHECK` holds the invariant for every writer: `http` implies the three policy columns are non-null, `plaintext` implies they are null.

Validation, run on every write, a rename included:

- Origin: HTTPS only, no wildcard, IP literal, userinfo or path, and port 443 only in this milestone (the relay allows 80, 443 and 22, and an origin on another port would only fail at run time).
- Header: characters of the HTTP token set only, and not `Host`, `Content-Length`, `Transfer-Encoding`, `Connection`, `Upgrade`, `TE`, `Trailer`, `Expect` or any `Proxy-*` name.
- Template: exactly one `{secret}` slot, no CR, LF, NUL or other control character.
- Value, whenever `delivery` is `http` (on each value write and on the switch from `plaintext`): no CR, LF, NUL or other control character. A PEM key or a value pasted with a trailing newline is refused at write time.
- A name the daemon itself must read (the two web-search provider keys, mail secret names) cannot be `http`, and a secret linked to a mail account (`linkedMailSecretIds`) cannot become `http`; the mail-account link path refuses an `http` secret.

**Who may write the policy.** Whoever can write `httpOrigin` can read the value out by pointing the secret at a host they control, so:

- `delivery`, `httpOrigin`, `httpHeader` and `httpTemplate` are written only by the settings routes (`POST` and `PATCH /api/teams/:id/secrets`). The Coordinator's `set_secret` tool never creates or changes an `http` secret, neither value nor policy, and returns an error that points to settings. A value that passed through `set_secret` has been in a model context and in chat history, so it cannot be an `http` secret in the promised sense. `delete_secrets` may delete one.
- **The value is bound to its target.** A write that changes the origin, header or template of an `http` secret, or sets it back to `plaintext`, must carry a new value in the same request. The stored value is never carried over to a new target. `plaintext` to `http` may keep the value. The settings page asks for the value again on such an edit.
- Project override: `openSecretValues` lets a project-scoped row replace a granted team row of the same name. The policy that applies is the effective row's, and `id` and `revision` in `httpSecrets` are that row's. A project row can be created only through the same settings routes when it is `http`.

## Wire

`MachineTokenResponse` keeps `secrets: Record<string, string>` for `plaintext` secrets only and gains:

```ts
httpSecrets?: Array<{
  id: string; name: string; revision: number;
  origin: string; header: string; template: string; value: string;
}>
```

The token route is a `GET`, so `surface` is a query parameter: `orb` or `host`, where an absent or unknown value is `host`. The host daemon says `orb` only for a local guest that has its own gateway listener. The server fills `httpSecrets` only when all five hold: the machine declared the `secretGateway` capability, the machine's reported `executor` is `orb`, the request says `orb`, the step's status is `claimed` (`ownedStep` checks only the machine today, so a finished step can still ask), and the step is one that gets team secrets today. In every other case an `http` secret is left out of the response entirely and its name is listed in `withheldSecrets: string[]`. It is never moved into `secrets`.

The daemon declares `secretGateway` only while the gateway answers on the admin socket and reports per-guest listeners.

An older daemon sends no surface and declares no capability, so it receives no `http` value; an older server sends no `httpSecrets`, and the new daemon treats that as none. Neither direction can deliver an `http` value as plaintext.

The guest never sees `httpSecrets`. `RelayMachineServer` today applies guest-supplied arguments to the upstream call and forwards the result verbatim, and it also serves remote sandboxes, so the `token` operation changes in three ways:

- It ignores every guest argument after the step id and sets `surface` from host state: `orb` only for a local provider whose guest has a gateway listener, `host` for `openRelayStream` providers, for `egress: 'none'` and for nspawn until proven.
- The guest-facing response is built from an allowlist through a strict schema. A field the relay does not know fails the call, which also covers fields the server adds later. It carries `secretPlaceholders: Record<string, { placeholder: string; origin: string; header: string; template: string }>` in place of `httpSecrets`.
- The host daemon holds a value only until the admin registration returns: not on the relay object, not in the journal or outbox, not in a log line. Relay reply `error` and `body` strings cross into the guest, so admin and gateway errors never contain a value.

A placeholder has the fixed prefix `cairn-placeholder-` followed by random characters, so stored text, the pattern redactor and a reader can tell it from a credential. `get_secret` returns the full header line to send, built from the template and the placeholder.

## Grant lifecycle

A grant is the gateway's permission to substitute one secret for one guest. It lives only in gateway memory.

| State | Entered when | Left when |
|---|---|---|
| none | initial | host daemon registers |
| active | registration accepted; gateway returns a fresh random placeholder | any revoke cause |
| revoked | connection closed, or reconcile found the secret absent or at another revision | never; a later step creates a new grant and a new placeholder |

The host daemon registers over an admin Unix socket. A podman guest runs with `--userns=keep-id`, so its agent user is the daemon's host uid and a peer-uid check does not tell them apart; what keeps a guest out is the mount namespace. The socket's directory is added to `isForbiddenMountSource` with a test, and as a second check the gateway refuses an admin peer on a guest listener's cgroup. The admin protocol is write-only: no operation returns a value or lists grants. One connection per step; **a grant never outlives that connection.** Registration is keyed by `(guest listener, step id, secret id)`.

**Reconcile on every token response.** The only second `token` call in a step is the App-credential refresh, which exists only for App credentials and reads only `.git`; the vault is built once. So the relay reconciles each token response against the step's grants: the same secret at the same revision keeps its grant and placeholder; a secret that is absent or whose revision changed has its grant revoked at once and gets no new placeholder in that step, and `get_secret` then explains that the secret changed during the step.

**Bound.** A step that never refreshes keeps its grant until it ends. An owner's delete or edit therefore takes effect at step end at the latest, and stopping the step is the immediate path. A server-to-daemon revoke signal would remove the bound and is a wire change this milestone does not make.

Other revoke causes, all of which reduce to closing the connection: step done or failed, stop, watchdog trip, worker disconnect, heartbeat timeout, daemon exit, gateway exit. On revoke the gateway also closes the guest's open connections to that origin.

## Gateway behavior

For a connection accepted on a guest's own listener:

- `CONNECT` to an authority that matches an active grant of that guest: terminate TLS with a leaf certificate for that host name, read HTTP/1.1 (HTTP/2 is not offered), apply the request rules below, build the one header from the template, and forward over a new TLS connection verified against the same host name.
- Any other destination: exactly today's behavior, an opaque tunnel with the existing address checks. No interception, so nothing changes for guests or steps without `http` secrets.

Request rules, which are the test list for the gateway PR:

- The placeholder is substituted only when it is the complete slot content of the bound header. A known placeholder in the request target or in another header is a refused request. Bodies are not inspected: a placeholder is inert, so nothing is claimed about them.
- `TRACE`, `CONNECT` and `Upgrade` on an intercepted connection are refused. Only origin-form request targets are accepted. Authority, SNI and `Host` must agree. A duplicate or caller-supplied second instance of the bound header is refused.
- Two grants of one guest that bind the same header on the same origin are refused at registration.
- Upstream leg: the default trust store only, `servername` set to the bound host, verification never disabled, and the interception CA is not in that store. The relay dials a checked IP through the local proxy, so the certificate check is what binds the credential to the host.
- Redirects are returned to the client as they are; a request to another origin has no grant there.

Key custody: the interception CA key is generated in memory when the gateway starts and is never written to disk. The gateway units set `LimitCORE=0` and run without an inspector; neither `egress-relay.service` nor `cairn-orb-egress.service` sets that today.

Trust in the guest: the gateway CA certificate is written to the guest's runtime bind together with a bundle file holding the system roots plus that certificate. The step environment sets `NODE_EXTRA_CA_CERTS` to the certificate, and `SSL_CERT_FILE`, `CURL_CA_BUNDLE`, `REQUESTS_CA_BUNDLE` and `GIT_SSL_CAINFO` to the bundle, because those four replace the system bundle. This is a new mechanism on the Orb step path.

Audit: the guest-side audit line is written by the guest and can be forged. The gateway writes its own record for every registration, substitution and refusal (step, secret id, origin, header name, decision, reason; never a value or header content) to its unit journal, and sends refusals over the admin connection to the host daemon, which adds a system row to the step's transcript from outside the guest.

## Every path that reads or writes a secret value or its policy

One test per row.

| # | Path | Today | With this design |
|---|---|---|---|
| 1 | `createSecret` through `POST /api/teams/:id/secrets`, settings page | seals the value | also validates and stores the policy |
| 1a | `updateSecret` through `PATCH /api/teams/:id/secrets/:sid` | renames, reseals | validates on every write, rename included; a target change or a switch to `plaintext` without a new value is refused; any policy or value write bumps `policyRevision` |
| 1b | `DELETE /api/teams/:id/secrets/:sid` | deletes | unchanged; running steps are covered by reconcile and the bound |
| 1c | Coordinator `set_secret` (`services/chief-tools.ts`) | creates or updates by name, value from the model | refuses when the existing row is `http`; can only create `plaintext`; never writes policy columns |
| 1d | Coordinator `delete_secrets` | deletes by name or id | unchanged |
| 1e | Project override in `openSecretValues` | project row replaces the team row of the same name | the effective row's delivery, policy, id and revision apply |
| 1f | Mail-account link (`linkedMailSecretIds`) | links a secret to an account | refuses an `http` secret |
| 2 | `openSecretValues` via `resolveStepCredentials` (`services/credentials.ts`) | name to value map | returns `plaintext` values and `http` entries separately |
| 3 | `stepToken`, worker branch (`services/machine-step-token.ts`) | puts the map on the wire for a step in any status | applies the capability, executor, surface and `claimed` rule; fills `httpSecrets` or `withheldSecrets` |
| 4 | `stepToken`, Coordinator branch | empty map | unchanged; a test pins that it never carries `httpSecrets` |
| 5 | Host step: `MachineClient.token` then `pushCredential` | vault of values | asks with `host`; vault holds `plaintext` only; `get_secret` on a withheld name explains that the secret needs an isolated step |
| 6 | Local guest with a gateway listener: `RelayMachineServer` `token` | applies guest arguments, forwards the response verbatim | sets `orb` itself; registers and reconciles each `httpSecrets` entry; writes an allowlisted response with placeholders; registration failure fails the token call. The test asserts on the bytes written to the guest socket |
| 6a | Remote sandbox: same class over `openRelayStream` | same | sets `host`; the guest socket bytes carry neither `httpSecrets` nor a placeholder |
| 6b | podman with `egress: 'none'`, and nspawn until proven | same | sets `host`; same assertion |
| 7 | Guest `pushCredential` and `buildSecretTool` (`credentials.ts`, `secret-channel.ts`) | returns the value | for a placeholder entry returns the placeholder with its origin and header; audit line records `delivery=http` |
| 8 | Runner token refresh (App credentials only; reads only `.git`, the vault is built once) | second `token` call | the relay reconciles: unchanged secrets keep their placeholder, changed or deleted ones are revoked |
| 9 | `prepareWebTools` provider keys (`backend/web-search.ts`) | takes two named keys from the vault | unchanged; those two names are refused as `http` on write, because the daemon itself must read them |
| 10 | Mail secrets (`isMailSecretName`) | separate channel | unchanged; refused as `http` on write for the same reason |
| 11 | `clearCredentials`, step end, stop, timeout, disconnect | empties the vault | also closes the admin connection (revoke) |
| 12 | Session continue or fallback to a new session | same vault | same grant while the step lives; a later step gets a new placeholder, and a placeholder left in an old transcript is inert |
| 13 | Transcript and log redaction (`guardCredentialOutputs`, `credentialRedactor`) | redacts the subscription token and Git passwords only; a `plaintext` team secret taken with `get_secret` reaches the transcript, journal and logs unredacted | unchanged; there is no `http` value in the guest to redact, and stored content holds placeholders only, except an upstream echo |
| 14 | Agent secret assignment (`routing-rules.ts`, agent `secrets` list) | list of secret ids | unchanged; delivery is a property of the secret, not of the assignment |

## Failure behavior

| Failure | Behavior |
|---|---|
| Machine lacks the capability or is not an `orb` executor, or the step runs on the host | value withheld, name in `withheldSecrets`, tool explains; the step still runs |
| Gateway unreachable or registration refused when the Orb step asks for its token | the token call fails and the step fails with a named error; no fallback to plaintext |
| Gateway exits during a step | grant gone; the placeholder reaches the upstream unsubstituted or the connection is refused; the daemon writes one system row to the transcript; no re-registration in that step |
| Host daemon exits during a step | admin connection closes, grant revoked, guest connections to that origin closed |
| Policy edited, secret re-bound or deleted during a step | at the next token response the relay revokes the grant and issues no new placeholder; a step that never refreshes keeps its grant until it ends; stopping the step revokes at once |
| A token request for a step that is not `claimed` | `withheldSecrets` only |
| The gateway has no per-guest listener support, or the daemon cannot reach the admin socket at start | the daemon does not declare `secretGateway`; every `http` secret is withheld |
| nspawn guest, podman with `egress: 'none'`, remote sandbox | the relay asks with `host`; withheld |
| Guest client does not trust the step certificate, or pins its own | TLS fails in the client; no direct route exists to fall back to |
| Authority, SNI and Host disagree; duplicate or caller-supplied bound header; `TRACE`, `CONNECT` or `Upgrade`; a placeholder in the request target or another header | request refused; one gateway audit record with the reason and no value |
| Redirect to another origin | returned to the client; the next request has no grant at that origin and nothing is substituted |
| Another guest presents a valid placeholder | no grant for that guest identity; treated as an unknown string |
| A guest connects over the TCP listener or the shared socket | not a guest listener, so no grant can match; opaque tunnel, nothing substituted |

## Prototype (decision 4)

Before the gateway PR, on a real Orb host, two throwaway data planes behind the same admin contract: Envoy with a header-mutation filter, and the existing relay extended with `node:tls` termination, `node:http` parsing and a maintained X.509 library for leaf certificates (no hand-written TLS, HTTP or ASN.1). Each runs the brief's failure inventory rows for direct disclosure, wrong location, SNI and Host mismatch, redirect, cross-step access, revoke on disconnect and certificate failure, with real headers captured at a controlled upstream. The same run carries the identity tests from the precondition above for both data planes, and a client matrix inside the guest: curl, git, Node fetch, Python requests and the `claude` CLI must each trust the step certificate through the variables above. The result table and the choice are added to this document. Criteria, in order: inventory rows passed, privileged surface added to the host, install and upgrade footprint in `scripts/ops/orb`, added latency.

## Change sequence

Each is one PR from `origin/main`, written test-first from the tables above. PRs 1, 2 and 5 touch security surfaces: each runs `/security-review`, carries the head-bound `Security review (<head>): fixed` or `recorded` line in Risk, and then enters the merge queue like any other green PR. PR 4 (the gateway process, the CA key and the admin socket) and the `apps/daemon/src/orb/relay.ts` change in PR 5 hold plaintext values without being on the canonical list; they run `/security-review` as well.

1. Schema columns, policy validation and the API, with every secret still `plaintext`. No behavior change.
2. Wire fields, the `secretGateway` capability and the server's surface rule. No daemon declares the capability yet, so an `http` secret is withheld everywhere.
3. Prototype scripts and the result table (no product code).
4. The chosen gateway, per-guest listeners, the admin socket, the host install units and, if the prototype proved it, the nspawn listener and forwarder.
5. Host daemon registration and revoke; guest placeholders and the tool text; the daemon declares the capability when the gateway answers and asks with `orb` only for a local guest with its own gateway listener.
6. Settings page: delivery choice, origin and header fields, the legacy label and the echo limitation. Feature-map row and design brief first.
7. Acceptance run on a real Orb host for every inventory row in scope, with captured upstream headers and model-facing artifacts.
