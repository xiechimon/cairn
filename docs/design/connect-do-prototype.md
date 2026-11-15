# Personal DO relay: transport experiment

Status: proposed local-only experiment. [Primary research](../research/connect-do-prototype-2026-11-15.md). This does not enable the existing Tunnel design or expose the private Cairn HTTP service.

## Architecture and first trial

One independently deployable package under `scripts/ops/connect-do-prototype` contains a Worker, a SQLite-backed Durable Object, serial runtime tests and a local smoke harness. Both a host and its clients initiate WebSocket connections to the Worker; the Worker authenticates the role before dispatching to one personal-instance DO. One host receives client envelopes stamped with a relay-assigned connection ID; host replies address exactly that connection. Clients cannot impersonate the host or send directly to another client. No message payload is persisted or logged.

The first trial runs entirely on loopback in Miniflare/workerd, using generated test-only credentials and synthetic messages. It proves the transport, not a model response. It does not connect to port 8787, execute commands, forward HTTP, import model credentials, add an app UI or provision resources. The host is a simulated application endpoint, explicitly not a substitute for a real Cairn acceptance run.

## Admission and security boundary

The experimental transport uses distinct high-entropy host/client bearer capabilities, supplied through request headers, never URL parameters, cookies or WebSocket subprotocols. Missing/invalid/equal credentials fail closed before upgrade. Only two exact GET upgrade routes exist: `/connect/host` and `/connect/client`; reject query strings and browser Origin headers. Browser pairing is intentionally unavailable in this first slice. Public health returns only protocol/version, not device or configuration details. A deploy without configured capabilities accepts no sockets.

The host capability does not grant owner status in Cairn, and the client capability does not grant a machine identity. A future adapter must retain existing device/machine auth and authorization, avoid loopback owner bootstrap, and reuse an explicitly reviewed application route surface. Never point a generic relay at the private listener. Executing machines already receive task-scoped credentials through Cairn's existing machinery; this relay is not a new model gateway.

Cloudflare terminates TLS. A compromised relay sees the presented host/client capabilities, can impersonate either transport role, and can read, modify, inject, drop or replay traffic. This is not end-to-end encryption. Use fresh experiment-only capabilities, never Cairn owner, device, machine or model credentials. Shared role capabilities do not provide individual client revocation. Production onboarding, revocation and rotation remain deferred.

## Exact version-one wire contract

All application envelopes are complete JSON text messages. Accept exactly the keys below, with no additional fields. `v` is the number `1`; `payload` is an opaque string of at most 60KiB UTF-8; `clientId` is a relay-generated UUID string. Opaque strings are never parsed as instructions. Binary messages, unknown versions/types/keys, invalid UUIDs and invalid JSON close the sender with 1008. An inbound complete message over 65,536 UTF-8 bytes closes with 1009 before parsing; this includes JSON syntax, whitespace and envelope fields, not individual WebSocket fragments or JavaScript code units.

| Direction | Exact envelope | Identity and failure rule |
| --- | --- | --- |
| Relay to new endpoint | `{"v":1,"type":"welcome","role":"client","id":"<uuid>"}` (or `role: "host"`) | Assign ID at authenticated upgrade, serialize ID and role in attachment. Welcome is the endpoint's only ID-discovery mechanism. |
| Client to relay | `{"v":1,"type":"send","payload":"opaque"}` | Client cannot supply sender, recipient, role, control or ID fields. |
| Relay to host | `{"v":1,"type":"message","clientId":"<uuid>","payload":"opaque"}` | Sender ID comes exclusively from the authenticated client attachment. Host learns IDs from these messages. |
| Host to relay | `{"v":1,"type":"reply","clientId":"<uuid>","payload":"opaque"}` | Resolve exact currently live client in this host epoch. Missing/stale destination closes host with 1008, never retargets or broadcasts. |
| Relay to client | `{"v":1,"type":"reply","payload":"opaque"}` | Deliver only to the named client attached to this exact host epoch. |

Role comes only from authenticated upgrade and serialized socket attachment, never a claimed role in JSON. Application-level `ping`, `pong`, control envelopes and cookie/subprotocol auth are unsupported and rejected. WebSocket protocol ping/pong handling belongs to the runtime, does not dispatch application messages and does not refresh expiry. There is no replay buffer, persistence of payloads, automatic retry, acknowledgment or exactly-once claim. Sender-order is preserved on one live connection only, not across clients, reconnects or runtime loss. Disconnect/reset can lose in-flight data or leave its outcome unknown; no task retry policy belongs here.

## Lifetimes, flow bounds and local reset

At authenticated upgrade, fix `expiresAt = now + 1 hour` and a new random host epoch ID. A client attachment captures the currently live host ID. Before every delivery, validate BOTH sender and recipient expiry, ready state, role and host epoch. Expiry closes the socket with 1008; reconnect requires a fresh authenticated upgrade, not a message-based reauth exchange. Admission excludes expired/closing endpoints from authorization but counts all not-yet-closed sockets against the 17-socket resource cap. A half-open old host can block replacement until its closure or fixed expiry; immediate reconnect availability is not promised.

Retire an expired/closing host logically before accepting a replacement: mark its attachment retired, close its captured client epoch, then create a new epoch. Old-host close/error only retires clients whose attachment still names that old host ID. Old client IDs are never reused. A session in closing/retired state cannot forward, receive or be revived by a late callback. Rate windows are fixed 60-second windows, maximum 120 inbound application messages per socket, including invalid messages. Serialize every counter/window mutation before processing. The host's shared limit intentionally bottlenecks all clients in this synthetic experiment.

Bound outbound application data independently of ingress: maximum 1MiB cumulative UTF-8 output per socket, including welcome/envelopes, tracked in its serialized attachment; additionally cap cumulative output for the entire experimental DO at 8MiB using one SQLite integer row. Reserve both budgets synchronously before `send`; budgets never refund on close, errors or reconnect. Thus even a non-reading or dishonest peer cannot cause unbounded application output through repeated reconnects. Exceeding either budget closes the sending endpoint and its destination with 1013; an exhausted DO rejects further upgrades with 503 until a full local reset. A thrown `send` closes both endpoints with 1011; no retry, reassignment or success acknowledgment. Runtime-owned protocol frames and socket implementation overhead are not an application-memory guarantee. No application auto-response bypasses these budgets.

Capabilities are generated as independent random 32-byte values in the harness process memory, passed directly as Miniflare in-memory bindings and HTTP Authorization headers. The Worker receives them through its environment only; do not put them in argv, files, URL/subprotocol, connection attachments, SQL or logs. Diagnostics record statuses/counts only, never header values or payloads. There is no `.dev.vars` secret file or active cloud deployment in this experiment. Reset/revocation means close all harness sockets, dispose workerd/Miniflare, discard both capability values and in-memory SQL state, then generate new values for a new run. No hot rotation or independent client revocation is claimed.

Tests may use an isolated test-only clock wrapper in the local runtime to advance time, never a production route or configurable public clock. Hibernation tests must call installed Miniflare's `unsafeEvictDurableObject` with `webSockets: "hibernate"`, retain existing connections and assert unchanged IDs, expiry and rate counts after reinitialization. A reconnect test alone is not hibernation evidence.

## State paths and failure contract

| Path | State/transition | Observable acceptance |
| --- | --- | --- |
| Upgrade | Authenticate before creating a role socket; serialize random ID, role, epoch, expiry, rate window and output bytes in its attachment | Missing/wrong/cross-role credentials, Origin, query or non-upgrade request create no usable connection. |
| Host connect | No host to one live host; no duplicate takeover | A second host gets conflict; an offline client gets unavailable. |
| Client connect | Join only while host is live; at most 16 clients | Each client gets a different ID; excess admission is rejected. |
| Client message | Stamp actual sender ID; forward bounded string payload to host | Two distinguishable clients, forged sender/recipient/control fields and cross-role attempts cannot impersonate or cross-deliver. Ordered bursts preserve per-sender order. |
| Host reply | Resolve exact live client connection by relay-issued ID | Replies go only to that client; stale IDs are rejected, not rebound after reconnect. |
| Message validation | Exact grammar; 64KiB complete-message cap, 60KiB payload cap and 120 messages/minute per socket | Malformed, multibyte/exact-limit/over-limit, binary, expired or flooding sockets close without dispatch. Expired silent recipients cannot receive. |
| Client close/error | Remove one client connection | Other clients keep working; reconnect obtains a new ID. |
| Host close/error | Retire its epoch and close only its own clients | Late old-close/new-host races cannot close a replacement epoch. Traffic in flight has unknown outcome, no replay. |
| Output/overload | Reserve attachment and SQLite budgets before send; no refunds | A stalled reader, thrown send and reconnect churn cannot bypass the finite output budget; observe 1013/1011, never false delivery success. |
| Hibernation | Recover identity, epoch, expiry, counters and output budgets from attachments/SQL | Force actual handler eviction with sockets retained; continue routing with the same IDs, expired-recipient denial and retained rate/output counts. |

## Pairing and rollout

There is no public claim-first ownership endpoint. Local smoke generates separate ephemeral capabilities and gives them only to its own test clients. A later cloud trial needs explicit approval for deployment/resource creation/secret setup, then deployment-owner-bound setup and single-use device pairing. New users must not copy model keys into the Worker. A deploy button alone is not permission to activate the service, nor proof that first-owner security is solved.

Free-account feasibility depends on requests and active duration, not just machine count. Hibernating idle sockets avoid active-duration use; app traffic, failed handshakes and reconnects still consume quotas. Worker and DO request allowances are separate; 17 sockets at 120 messages/minute can already exceed the DO daily free allowance. The local output budget is a safety cap, not a cloud billing guarantee. Account-wide workload/byte admission and usage measurements are required before any cloud trial. No tunnel allocations, D1 database, domain or paid subscription are necessary for this experiment. Real network reliability, free-quota behavior, phone pairing, Cairn task execution and an unaided fresh-account install remain unverified until those paths are implemented and explicitly exercised.
