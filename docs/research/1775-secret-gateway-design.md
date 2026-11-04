# Team secret gateway: research and decision brief

Date: 2026-10-27. Issue: #1775. Status: awaiting Ian's design decision; no product implementation is authorized by this note.

## Problem and concrete trace

Measured from checkout `5adc14e419cef531c41759039ffb287d2bb6447b`: team-secret reads return plaintext. A malicious instruction can request `get_secret`, then send its result through a shell command. The audit records the read, not the subsequent destination. Changing the return value alone would break consumers without providing an HTTP delivery path.

Source observations below mean code inspected in this checkout. Runtime observations are explicitly marked. Proposed policies are recommendations, not implemented guarantees. External source findings and reuse comparisons are in [the prior-art note](1775-gateway-prior-art.md).

1. [Server storage](../../apps/server/src/services/secrets.ts): `createSecret` seals the value; `openSecretValues` decrypts selected team-scoped IDs into a name/value record.
2. [Step authorization](../../apps/server/src/services/credentials.ts): `resolveStepCredentials` selects the assigned agent's secrets for eligible step kinds. Chief credential bundles contain no team secrets.
3. [Token delivery](../../apps/server/src/services/machine-step-token.ts): `stepToken` checks machine ownership and puts `bundle.secrets` in the response. [The wire schema](../../packages/shared/src/protocol/machine-wire.ts) represents secrets as strings without delivery policy.
4. [Daemon vault](../../apps/daemon/src/credentials.ts): `pushCredential` copies those strings into a map; `take` returns a string. `clearCredentials` replaces the vault on the credential object. It does not promise secure memory erasure or revoke previously copied strings or retained vault references.
5. [Tool construction](../../apps/daemon/src/secret-channel.ts): `buildSecretTool` audits a successful read and returns the value unchanged. [Runner](../../apps/daemon/src/runner.ts) registers it on eligible steps and passes it through session options.
6. [Pi](../../apps/daemon/src/backend/pi.ts) wraps local-tool returns as text content. [Claude Code](../../apps/daemon/src/backend/claude-code.ts) wraps them as MCP text results. Runner stores tool events and non-assistant messages in the transcript and relays tool calls to the server. These are source observations, not a full transcript-capture runtime test.

Runtime observation: before writing this design, a Node assertion called the real `buildSecretTool` with a synthetic vault. Expecting `cairn-secret:HTTP_TOKEN` failed because it returned `sentinel-1775-not-a-real-secret`. See [the captured assertion and command](../verify/1775/research-checks.md). This proves the current tool return behavior only; it does not test an HTTP-only flag, which does not exist yet.

## Execution surfaces and trust boundary

Source observation: Pi has built-in `bash`, `read`, `edit`, and `write` tools and runs its session through the SDK in the daemon process. Its bash customization merges `opts.env` into the spawned environment. Claude Code builds SDK options with process environment plus session overrides, and translates managed MCP endpoints, including their environment. Runner resolves MCP endpoints and remote tool relays separately from local tools. Both create and continue paths receive session options; runner can fall back from a non-resumable session to a new session.

Source observation: [setupProxy](../../apps/daemon/src/proxy.ts) configures the daemon's Undici global dispatcher from proxy environment variables and preserves loopback access for the server. It does not install OS packet rules, isolate agent processes, or intercept every backend's sockets.

Inference: environment variables route cooperative clients; they cannot force hostile shell programs, direct sockets, alternate DNS, or independently running MCP services through a gateway. A TLS-intercepting proxy without an execution boundary is still bypassable. Secret confidentiality and default-deny egress are separate acceptance claims.

Inference: a gateway retaining credentials under the same OS identity as an unrestricted agent is not a defensible credential boundary. The threat model must cover local files, process inspection, inherited handles, loopback services, SDK extensions, and child processes, not just network traffic. Pi's in-process runtime especially prevents treating the entire daemon as outside the untrusted execution domain without restructuring or restricting supported execution.

Recommendation: keep unrestricted local execution explicitly outside the hardened guarantee. Do not enable HTTP-only secrets for a backend until its gateway, daemon memory, gateway configuration, private CA material, and capability distribution are inaccessible to that execution domain. Full microVM isolation remains out of scope. No Mac or Linux enforcement mechanism was installed or runtime-validated in this research.

## Proposed delivery contract, conditional on approval

Use separate `http-placeholder` and `plaintext` delivery policies. HTTP policy includes a stable secret ID, exact destination origin, allowed header name, approved template, policy revision, and step authorization. Metadata visible to the agent contains no value. `get_secret` returns a step-scoped opaque placeholder for HTTP mode; the issue's name-based spelling is an illustration, not authorization. The gateway independently checks the server-issued grant on every request.

Permit plaintext only through explicit per-secret authorization. Do not silently convert existing secrets, infer destinations from names, or fall back to plaintext after a gateway or version error. Until migration is approved, preserve existing behavior and present its exposure as legacy behavior. For HTTP-only policy, refuse dispatch to older daemons before sending values; an optional unknown field on the current string map is insufficient. Advertise a versioned capability and validate it server-side.

Recommended request rules:

- Accept HTTPS origins with exact normalized DNS names and explicit ports. Reject wildcards, suffix matching, IP literals, userinfo, ambiguous authority syntax, and unapproved ports. Bind header names and templates per secret; reject CR/LF in values and templates.
- Terminate client TLS in the gateway. Match CONNECT authority, TLS SNI, and HTTP Host or HTTP/2 `:authority` to the authorized origin. Reject missing or disagreeing authority, duplicate Host headers, and malformed requests. Validate the upstream certificate against the same hostname, with upstream SNI set to that hostname. Never authorize by resolved IP, which can represent multiple CDN tenants.
- Resolve upstream DNS inside the trusted gateway. Validate all selected addresses at connection time, including IPv4-mapped IPv6, and prohibit loopback, private, link-local and metadata destinations unless a separate explicit internal-service policy is approved. Prevent DNS rebinding between validation and connection. OS egress enforcement must also cover IPv6, UDP/QUIC, alternate DNS, and local relays.
- Substitute only a complete authorized token in its configured header template, after destination checks. Never substitute in URLs, query strings, bodies, unrelated headers, CONNECT text, or logs. Reject recognized tokens in forbidden locations; streaming bodies require a defined bounded inspection policy before claiming rejection coverage. Forwarding an unrecognized opaque token conveys no secret and must never trigger lookup by name alone.
- Strip caller-controlled duplicates of the injection header before constructing exactly one authorized header. Reject incompatible combinations of multiple grants. Disable redirects in gateway-managed clients; each new request must be authorized independently. Never forward injected authentication across origins.
- Deny generic CONNECT tunneling, WebSocket upgrades, HTTP/3 and unsupported protocols on credential-bearing routes until independently tested. Certificate-pinned clients that cannot trust the step CA fail closed; never disable upstream TLS verification to accommodate them.
- Scope client CA trust to the isolated step, not the machine trust store. Keep signing keys and gateway administration outside the agent boundary. Grant gateway access through an authenticated per-step channel, not merely a loopback port or caller-supplied step ID. Reject other steps, users and expired policy revisions.
- On cancellation, completion, timeout, daemon disconnect, or gateway failure, revoke the grant and close active credential-bearing connections and streams. A resumed session obtains a new grant; old placeholders do not regain authority. Do not rely only on replacing `creds.secrets`.
- Audit authorization outcome, secret ID, policy revision, step, agent, normalized origin, header name, timestamp and denial reason. Do not record values, raw requests, authentication headers, tokens, response bodies or secret-bearing parser errors. Apply this rule to gateway diagnostics and crash captures too.

These rules are necessary to substantiate credential authorization. They do not prevent an agent from misusing an authorized API. A host-wide binding can authorize destructive endpoints; path, method, account, and operation scopes may also be needed. Prefer narrowly scoped provider credentials and explicit operation adapters where practical.

## Response disclosure prevents an unconditional promise

A permitted upstream can reflect an authorization header into its response, redirect, error, compressed content, or an encoding of the value. It can also issue another usable credential. Exact-string redaction cannot establish that arbitrary responses contain no secrets. Shell output and transcript filters run too late once a model-facing tool has already received the response.

Recommendation: promise that Cairn does not directly return HTTP secret values, rather than that arbitrary authorized services can never disclose them. For a stronger guarantee, use reviewed service-specific adapters with bounded response schemas and reject opaque or unreviewed responses. Ian must choose whether trusted upstream behavior is an explicit assumption or whether HTTP-only mode initially supports only such adapters. No generic response redaction design is accepted here.

## Deployment choices

Linux: investigate a separate identity for the gateway and a restricted agent process tree with an administrator-owned network namespace/firewall boundary, filesystem/process restrictions and no privilege to join another namespace or change routing. Namespace availability, rootless deployment and packaging remain unmeasured. Running Pi in the credential-holding process would need a different execution boundary.

macOS: do not infer per-step isolation from proxy variables or a shared-user firewall. A separately administered execution identity and supported network enforcement would need a deployment prototype, permission analysis and actual bypass tests. Do not ship a Linux result as Mac acceptance. The existing self-hosted experience may remain unsupported for hardened secrets until an enforceable mechanism is demonstrated.

The prior-art comparison evaluates Envoy as a potential production data plane and mitmproxy as an interception research harness. Neither selection establishes process isolation or authorization by itself. Do not add a new dependency or implement a custom TLS stack before the decision and prototype results.

## Failure inventory and required real artifacts

Before any product implementation, write the affected regression first. The current synthetic assertion is a research baseline, not a substitute for the future integration tests.

| Failure | Required acceptance artifact |
|---|---|
| HTTP-only tool read exposes plaintext | Tool result, logs, streamed messages, SDK session files, transcript rows and uploads contain no sentinel; explicit plaintext mode still works |
| Direct socket, `curl --noproxy`, ignored environment | Real child processes attempt IPv4 and IPv6 direct connections; isolated network capture proves denial and upstream receives no credential |
| Alternate resolver, DNS spoofing or rebinding | Controlled DNS and packet capture demonstrate gateway-owned resolution and address validation |
| Shared CDN IP, SNI/Host mismatch | Two TLS tenants on one address; only matching authorized authority receives injected header |
| Placeholder in path, query, body or wrong header | Controlled upstream capture proves no substitution and defined forbidden-location rejection |
| Redirect or duplicate authentication header | Same-origin and cross-origin fixtures prove independent authorization and single header construction |
| Compressed, streaming or encoded reflection | Response fixtures exercise the chosen response contract; unsupported responses fail before model delivery |
| Cross-step access, stale grant, concurrent steps | Separate process clients prove grants cannot cross steps or be reused after expiry |
| Cancellation, crash, restart, resumed SDK session | In-flight upstream streams close; old capabilities fail; historical session contamination is handled explicitly |
| Certificate pinning, absent CA, TLS validation failure | Failing clients never silently switch to direct or plaintext execution |
| Old server or daemon strips policy | Compatibility matrix proves HTTP-only values never reach a legacy plaintext recipient |
| Local inspection or process escape | Agent cannot inspect gateway memory/files, CA keys, admin sockets or daemon credentials; test each supported OS separately |
| Authorized API abused without exposing its key | Service scopes or adapters demonstrate allowed operations and rejected destructive operations |

Do not use synthetic unit mocks as acceptance of packet enforcement. Tests must capture real headers at controlled upstreams and actual model-facing artifacts on each supported OS/backend. Re-run `/code-review` and `/security-review` for the later implementation, plus the repository gates. No protected product file is changed in this research-only work.

## Questions for Ian before implementation

1. Approve a narrower first milestone that prevents direct tool disclosure only for supported isolated execution backends, while unrestricted local Mac/Linux execution remains legacy plaintext or refuses HTTP-only secrets? Alternatively require enforced egress on both platforms before release?
2. Allow arbitrary responses from explicitly trusted upstreams with a documented reflection limitation, or restrict the first release to service-specific response adapters?
3. Preserve existing secrets as visibly legacy plaintext until an owner explicitly migrates each one, or require explicit reauthorization before their next use? Either changes usability and needs a product decision.
4. Approve a deployment prototype comparing Envoy integration against the harness before selecting a production gateway, including the execution boundary needed for Pi?

These are release and trust-boundary choices, not implementation details. Stop before product edits until Ian decides. This research does not remediate existing plaintext exposure.

## Concurrent work

The requested open and last-30-merged PR inventories were fetched before editing. This change adds new research/evidence files only, so it shares no changed paths with those PRs. A later implementation would overlap open #1993 and #1928 on `apps/daemon/src/runner.ts`; #1867 on that file and `apps/server/src/db/schema.ts`; and #1727 and #1654 on the schema. Recently merged #2016, #1988, #1924 and #1878 also touched those proposed surfaces. Preserve their lines. No existing product or recently merged lines are removed here. The pre-existing `pnpm-lock.yaml` change is outside this task and is preserved.
