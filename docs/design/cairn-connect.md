# Cairn Connect

Add opt-in public HTTPS through Cloudflare Tunnel; use Worker + D1 for allocation, never application-session proxying. Execution, provider credentials and device authorization stay on the user's host. Preserve [Tailscale Serve](../deploy/tailscale-mobile.md) as the private alternative.

Status: proposal, not implemented. [Research](../research/cairn-connect-2026-11-14.md) records evidence and current-code differences. Coordinator protocol review precedes code; cloud resources, accounts, credential setup and deployment need mon X's approval.

## Architecture and authority

- **Host:** existing Cairn and local agent/provider configuration, plus supervised, version/checksum-pinned `cloudflared`. No remote execution machine or model route is created.
- **Public entry:** dedicated loopback listener for the existing SPA/API. Disable both local-owner and Cloudflare Access bootstrap there; require the allocated Host and existing token/session auth. Locally managed ingress fixes this listener as its only upstream, with a 404 catch-all. Never accept a broker-supplied local service URL/configuration.
- **Cloud:** Worker + D1, official Cloudflare SDK, least-privilege Tunnel/DNS credentials. Allocate a random single-label hostname under an approved dedicated zone with wildcard TLS coverage. REST/SSE/WebSocket traffic goes through the tunnel, not the Worker. No chat storage or webhook gateway.
- **Pilot recommendation:** expiring invitation per host, cap 100, no new identity-provider account. This is resource admission, not browser login. Open signup and cloud-account discovery are deferred and need a product decision.
- **D1:** invitation hashes/expiry, environment ID, management-capability hash, resource IDs, desired state, generation and operation lease. No app credentials/content. Persist a random management capability locally before redemption; bind its hash to the invitation reservation and require possession on subsequent calls. Never fetch caller-supplied URLs.
- **Local state:** intent, resource IDs, management capability and tunnel credentials in an owner-only `CAIRN_HOME` directory, files 0600. Generate/persist the tunnel secret before allocation; only its creation call goes through the broker to Cloudflare. It grants no Cairn login authority.

## A new user pairs without network setup

1. Install/start Cairn and complete local provider/login setup as owner. Linux can reuse same-uid browser bootstrap; other supported platforms need a tested local-owner handoff, not an assumption that this Linux-only convenience works everywhere. Never copy an owner token to a phone.
2. Remote access offers **Connect without VPN**, explains Cloudflare's trust boundary, accepts the invitation and asks to enable exposure. Automatically install/verify the pinned connector; leave explicit custom binaries user-managed. Unsupported platforms stop before provisioning.
3. Reserve admission, allocate tunnel/DNS, persist credentials and start the listener/connector. Probe the exact public HTTPS descriptor without redirects. Show **Ready** only on matching identity; DNS/network failures show the failing step and idempotent Retry, not an unusable QR.
4. **Pair new device** creates the existing five-minute, one-use `/app#pair=…&env=…` QR/link. The phone or another computer removes the fragment, checks identity, and exchanges the code directly with the host for an HttpOnly device session. The Worker never receives it.
5. Submit a prompt from the paired device and obtain a result using the host's configured model. Paired devices cannot manage provider secrets; missing provider setup sends the owner back to local setup. Revoke devices individually without deleting work or private routes.

The web client is the host-served SPA, not a cross-origin dashboard. Unpaired visitors see the existing pairing gate. The host must remain awake; no cloud fallback runs its agents. Unreachable-origin errors need locally available recovery guidance; a stopped host cannot serve its own offline page.

## State ownership, transitions and failure contract

| Read/write path | State and transition | Failure behavior and required acceptance |
| --- | --- | --- |
| Local enable | `off` to `allocating`; persist intent/secrets first | Owner + CSRF checks; auth-off/unsupported platforms create nothing; duplicate clicks share an operation. |
| Worker invitation redemption | Atomic reservation bound to environment + management hash, with expiring lease | One winner under concurrency; identical authenticated retry resumes; invalid/expired grant or global cap fails before cloud writes. |
| Worker allocation/reconcile | `reserved` to `provisioning` to `allocated`; checkpoint resource IDs with generation fences | Discover deterministic provider resource names after ambiguous timeouts before retrying creation. Stale operations cannot publish/delete newer resources. No D1 transaction spans provider calls. |
| Connector start/reconnect | `starting` to `ready` after public probe; network/crash/sleep to `reconnecting` | Bounded backoff reuses allocation. Parent exit stops child/listener. Child environment contains no model/owner/cloud-API credentials. |
| Route list / QR | Public route only while `ready` | Private routes remain independent. Wrong identity, downgrade or redirect receives no code/session. |
| Local pair redemption | Existing transaction: consume grant, create device/session | Reject replay/expiry/revocation; insertion failure preserves grant; paired device cannot mint grants or approve enrollment. |
| Device requests / streams | Existing auth, CSRF, revocation and one-use tickets | Forged proxy identity/bootstrap fails. Revoke rejects new requests and closes streams. Test SSE reconnect and WebSocket upgrade independently. |
| Local disable | Persist `off`, stop listener/connector immediately | Offline/cloud failure cannot delay closure; restart stays off; clear QR readiness, preserve devices/private routes. |
| Remove address / re-enroll | Generation-bound deletion of owned IDs; retain cleanup tombstone until success | Retry partial cleanup. Never reassign old hostnames to another host; a new hostname requires fresh pairing. |
| Startup | Read intent before spawn; resume provisioning/cleanup | Invalid state/permissions fail closed. Missing/revoked allocation requires re-enrollment, not anonymous recreation. |

Disable retains the stable address; **Remove public address** deletes it. Sweep expired unused reservations, but count inactive allocations against the cap. Never silently reassign hostnames and their browser-origin state.

## Security boundary

Public entry rejects owner bootstrap even with loopback peers, forged Host/identity headers or encoded paths. Reject ambiguous paths before filtering; retain exact-host checks through upgrades and existing owner-only restrictions after pairing. Require host-only Secure cookies, same-origin writes and pairing/enrollment rate limits.

Cloudflare terminates TLS and can inspect traffic. Compromised broker DNS/tunnel authority could serve malicious JavaScript at the trusted origin. Local sessions do not eliminate that risk; this is not end-to-end encryption against the operator. Scope credentials to a dedicated zone/account and bound resource/CPU usage.

No long-lived secrets in argv, URLs, browser storage, diagnostics or telemetry. Only a one-use grant appears in a QR fragment. Descriptor matching detects misrouting, not compromised DNS/TLS infrastructure.

## Cost and rollout

100 hosts use 100 of 1,000 included tunnels. Workers Paid starts at $5/month with D1 allowances. One control-plane check every 15 minutes gives 100 × 30 × 24 × 4 = 288,000 requests/month versus 10 million included. App traffic adds no Worker session-proxy requests. CPU/rows/abuse remain to measure; domains, models, hardware, other account usage and operations are excluded. $5 is a target, not a spending ceiling.

PRs from main: design; local public entry/connector; Worker/D1 allocation; onboarding/pinned installation; approved staging acceptance. Dependent PRs wait for their base to merge. Never manually deploy/restart the self-deployed 8787 service.

Acceptance: a second person's clean install through pairing to a local-model result, phone VPN off, separate network. Test every lifecycle row, provisioning failures, sleep/restart, forged headers/paths, CSRF, secret-free logs and stream closure. Use one test worker/shared admission. Distinguish emulator, real-tunnel and real-provider evidence.

**Approval before live work:** invitation-only pilot, Cloudflare account/hostname zone, resource provisioning and least-privilege credential setup. Never paste secrets into a thread. Offline work can proceed after coordinator design review; live reachability/first result remain unverified until approved acceptance.
