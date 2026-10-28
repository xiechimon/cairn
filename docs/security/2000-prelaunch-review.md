# Pre-launch security review

Reviewed 2026-10-27 for [#2000](https://github.com/xiechimon/cairn/issues/2000), against checkout `717010c2c9681bc147f5ebec412026c2cc9af39c` on `lane/2000`.

## Result

The reviewed checkout has unresolved authentication, credential, and upload findings. This review does not establish readiness for untrusted installations. Five new issues track remediation or decisions. The existing #1775 tracks team-secret disclosure. No product behavior changes in this delivery.

"Source observation" means code read in this checkout. "Runtime observation" means a probe executed during this review. "Inference" identifies consequences that the probes do not demonstrate directly. Severity is a triage judgment, not a CVSS score.

## Scope and failure inventory

The review follows these trust transitions:

- Secret storage and delivery: `lib/secret-box.ts`, `lib/keys.ts`, `lib/hash.ts`, `services/secrets.ts`, `services/credentials.ts`, `services/api-keys.ts`, and `services/oauth.ts` in `apps/server/src`; `credentials.ts`, `secret-channel.ts`, and `state.ts` in `apps/daemon/src`.
- Registration and step authority: server `lib/token-auth.ts`, `routes-machine.ts`, `services/machines.ts`, `services/machine-deps.ts`, `services/machine-step-token.ts`, and `services/machine-relay.ts`. Dispatch eligibility and runner credential wiring were inspected at their call sites.
- MCP access: server `services/mcp-face.ts` and `services/mcp-servers.ts`; daemon `backend/mcp-config.ts`, Pi tool registration, and Claude Code SDK options.
- Adjacent credential use: server attachment grants and upload consumption, server configuration and startup, daemon configuration, and `Dockerfile`.

Before writing the probes, the failure inventory covered anonymous registration approval, restricted-key escalation, hostname impersonation, machine-token theft, cross-machine step access, plaintext model disclosure, forged or replayed grants, path escape, missing upload rows, MCP authentication and grant bypass, malicious MCP configuration, inherited host authority, and absent network enforcement.

The review is a source audit with focused runtime probes. It does not cover every dependency, all backend implementations, live OAuth providers, browser XSS, OS escapes, production TLS, a real remote attack, or a full network penetration test. The isolation guide makes no claim that those boundaries were tested.

## Findings

### F1: Anonymous machine enrollment approval

High. [#2053](https://github.com/xiechimon/cairn/issues/2053).

Source observation: `registerTokenAuth` exempts machine routes. The machine middleware exempts the enrollment prefix, including confirmation. The confirm handler does not require the owner credential.

Runtime observation: with server authentication enabled, `/api/projects` returns 401, but anonymous start and confirm requests return 200. The resulting machine token authorizes `/api/machine/me`.

Inference: a reachable attacker can add an unauthorized executor. Receiving work or secrets still depends on assignment and dispatch eligibility. The probe does not demonstrate arbitrary step theft. Owner-authenticated confirmation is required before considering remote registration safe.

### F2: Restricted API keys gain machine authority and local identity

High. [#2054](https://github.com/xiechimon/cairn/issues/2054).

Source observation: enrollment checks key existence and team equality, without requiring a distinct enrollment grant. `enrollMachine` can replace an existing local machine token when the supplied name equals the server hostname.

Runtime observation: a key with only the `Todos` read grant, no write grants, and no Git access enrolls successfully. Using the server hostname returns a token for a machine with `kind=local`, after seeding the local machine.

Inference: a compromised read-only MCP key can acquire executor authority and impersonate a local machine. The enrollment authorization model requires an owner decision. Bootstrap keys with empty tool grants currently have intentional uses, so silently removing all such access is not an approved fix.

### F3: Public attachment signing key and upload path escape

High for a caller authorized to reach upload consumption. [#2055](https://github.com/xiechimon/cairn/issues/2055).

Source observation: `hmacKey` encrypts and decrypts a fixed string, then hashes that plaintext. Every installation therefore derives the same public signing key. `uploadFile` joins the signed key to `attachmentsDir` without containment validation and writes before requiring a matching pending row.

Runtime observation: a grant signed from the public constant, using a fresh unrelated SecretBox, writes `../sentinel.txt` outside a disposable attachment directory. Its attachment ID has no DB row. The probe writes only inside its own temporary root and removes it.

Inference: this enables attacker-chosen writes within the server OS user's permissions. The HTTP route still requires the server bearer token when configured. Anonymous HTTP exploitation and code execution were not demonstrated. Fix secret-dependent signing, path containment, symlink handling, and DB authorization together; key rotation alone leaves missing defense in depth.

### F4: Machine bearer token file permissions depend on umask

Medium, conditional on local directory traversal. [#2056](https://github.com/xiechimon/cairn/issues/2056).

Source observation: state directory creation and `saveMachineJson` omit private modes.

Runtime observation: with umask 022, a new state directory is 0755 and `machine.json` is 0644. The probe uses a synthetic token and restores umask.

Inference: other OS users can steal the token when parent directories permit traversal. A private home may prevent that access. Private modes do not protect credentials from an unrestricted agent running under the same OS identity.

### F5: Bare-server defaults allow unauthenticated non-loopback access

High if the bare server is reachable on an untrusted network. [#2057](https://github.com/xiechimon/cairn/issues/2057).

Source observation: `loadConfig` permits null authentication and host. Startup omits `hostname` in that case; README explicitly describes the unset host as all interfaces. `registerTokenAuth` returns immediately for a null token. The insecure-bind warning also misses a null host.

Inference: a fresh bare-server deployment can expose the control API when no launch wrapper or firewall limits access. No real listening socket was opened for this review. Docker independently requires a token and must retain that protection. Changing documented bare-server defaults needs an owner decision.

### F6: Team secrets reach the model as plaintext

High for an agent granted a valuable secret. Existing [#1775](https://github.com/xiechimon/cairn/issues/1775), research PR [#2029](https://github.com/xiechimon/cairn/pull/2029).

Source observation: server credential resolution decrypts selected team secrets, and step-token delivery sends them to the daemon. `buildSecretTool` returns the selected value unchanged. Pi and Claude Code expose local-tool returns as text results.

Runtime observation: the real secret tool returns a synthetic secret verbatim while its audit line omits the value. This probe establishes tool disclosure, not every transcript persistence path.

Inference: prompt injection can induce disclosure through model output or shell network access. Audit records the read, not the destination. A worktree, proxy environment variables, and credential-object cleanup do not establish secrecy or forced egress.

## Controls observed

Source observation: AES-256-GCM uses fresh 12-byte IVs and authentication tags. Machine tokens use 32 random bytes; API keys use 24 random bytes. Their DB records store hashes. Newly created SecretBox keyfiles request mode 0600. Existing-file permissions, symlink races, memory erasure, and key rotation are not certified by those observations.

Source observation: secret metadata responses omit values, and decryption filters by team and selected IDs. `ownedStep` checks the assigned machine before step credential delivery. It does not itself require an active step status; completed-step credential lifetime deserves a dedicated follow-up review rather than an unverified exploit claim here.

Source observation: OAuth state has a 30-minute TTL and is consumed before token exchange. MCP requests require an API key with `mcpAccess`, register only granted tools, and use team checks for referenced objects. `merge_builds` is refused even for a granted key. These are distinct from enrollment's broader API-key authority.

Runtime observation: missing MCP authentication returns 401, and calling an ungranted tool with a read-only key is refused. Existing suites exercise cross-team MCP requests, invalid tokens, secret-box tampering, enrollment, OAuth state, and the command gate; their run results are in the verification record.

Source observation: MCP configuration can select local commands, arguments, environment values, remote URLs, and headers. Configuration metadata omits credential maps but includes the URL or command, so do not place secrets in URLs. Endpoint configuration and returned tool content are trusted capabilities and untrusted instructions respectively. The command gate is pattern matching, and Claude Code runs with `bypassPermissions`. Neither is an OS sandbox.

## Explicit schedule for #1775

The #2000 follow-up schedule is recorded in [the #1775 schedule comment](https://github.com/xiechimon/cairn/issues/1775#issuecomment-6457906755):

1. By 2026-11-03, review the research in #2029 and obtain Ian's decisions on execution isolation, upstream response reflection, and legacy-secret migration. The research PR is open as observed on 2026-10-27; it is not an implemented gateway.
2. By the 2026-11-10 launch checkpoint, record an approved implementation scope and verification matrix, or an explicit decision to defer secret-bearing stranger deployments. This date schedules the decision checkpoint, not a promise of an unapproved implementation.
3. After design approval, implement #1775 in a separate protected-code change. Start with a failing plaintext-disclosure regression and capture real upstream headers, model-facing results, and bypass attempts on each supported OS and backend.

The research PR contains four unresolved owner questions. #2000 does not answer them by assumption. The launch owner must decide whether unresolved high findings block launch or require a narrower launch scope. This report recommends blocking secret-bearing untrusted deployments until the findings are resolved or the owner explicitly accepts a constrained scope.

## Concurrent changes

The requested open-PR and last-30-merged inventories were fetched before editing. This delivery adds new paths only; no open PR shares a changed path. #2029 overlaps the topic, and this report links its research without modifying it. Product fixes would overlap #1867 and #1727 on machine routes, #1940 on machine identity and claim logic, and #2050 on claim and completion logic. Those changes require reconciliation in their own repair branches.

No existing lines, including lines from recently merged PRs, are removed. The pre-existing `pnpm-lock.yaml` change is outside this task and remains untouched. Verification artifacts and limitations are in [the verification record](../verify/2000/README.md). Operators can use [the isolation guide](agent-isolation.md).
