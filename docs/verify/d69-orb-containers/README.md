# Container Orb acceptance evidence

D69 PR 6 ports the secret-isolation canary and host prerequisites to rootless Podman. It leaves nspawn as the default until the control-plane cutover and reviewed runtime rollout.

Failure controls were written and observed failing before the fixes: missing probe output, an incomplete egress refusal inventory, HTTP default ports becoming port zero, a socket-file bind hiding a replacement relay socket, host-runtime-path ambiguity, and scratch cleanup accepting foreign owners or mutable names. Every expected attacker row must exist exactly once and be blocked; working container sudo and a leaking host negative control are required.

## Measured on Linux, 2026-11-04

- `host-check.json`: rootless Podman 6.1.4, delegated CPU/memory/PID controls, pinned image, private relay socket, uid 1000, empty effective/ambient capabilities, only loopback, working sudo, hidden host home, allowed public tunnel and refused private/metadata/CGNAT/loopback/disallowed-port targets. Probe removal succeeded.
- `relay-restart.json`: the same running container reaches the recreated relay socket after restart; container sudo cannot unlink it through the read-only directory bind.
- `owner-host-check.json` and `owner-relay-restart.json`: fresh repeats after integrating #2761 immutable container IDs and enrolled daemon ownership; both pass. The relay ran as an isolated manual process; the deployment unit was not started.
- `container-canary.json`: the full scratch server, enrolled daemon, actual Orb worker and runner delivered the attacker result and normal Git bundle in 25.956 seconds. Every required Orb route was blocked, container sudo worked, public GitHub was reachable, and all delivered Orb objects were free of sentinel markers. The host negative control read all five synthetic sentinels, its delivered objects contained their markers, and both host listeners were reachable. No sentinels remained after cleanup.
- `cleanup-identity.json`: real Podman name replacement between inspect and removal deletes only the inspected original ID. The foreign replacement survives and is rejected on a subsequent cleanup attempt.
- Exact changed Orb CI command: 561 tests passed, including `trial-evidence-check.test.mjs`. Targeted runtime/provider/probe tests: 202 passed. Canary cleanup tests were red before ownership/ID validation; all 104 canary script tests pass.

The original fresh source commit is `57afe4047`; subsequent evidence-only commits do not change the executed implementation. The image is `cairn-orb-base:eb01c9191591ca17`.

The relay export must be a canonical, nonsymlink directory named `cairn-orb-egress` or `cairn-orb-egress-<lowercase suffix>`, owned by the daemon user with mode 0700. It must contain exactly the configured socket, owned by that user with mode 0600. Sibling files, general home directories, symbolic aliases and unsafe ownership or modes fail before any container action. The runtime and host collector share this validation. The container bind is the socket file only, read-only, so a later sibling in that directory cannot appear inside an already-running Orb. The socket unit owns the listener inode: a service or crash restart keeps it, and replacing the socket unit changes it, so retained Orbs do not follow that replacement. The installed relay unit uses the dedicated deployment checkout and pinned fnm Node 24.

The container canary requires `XDG_RUNTIME_DIR`, a pinned `CAIRN_ORB_IMAGE`, and `CAIRN_ORB_EGRESS_SOCKET` pointing to a live private relay. Run `CAIRN_ORB_RUNTIME=podman node scripts/ops/orb/canary.mjs --json --out /tmp/new-container-canary.json`. It uses the actual host relay socket as a host-runtime-path isolation target. A generic guest `/run/user/1000` directory is expected and does not identify a mounted host runtime directory.

The relay restart probe is reproducible from `apps/daemon` with `XDG_RUNTIME_DIR=/run/user/$(id -u) node --import tsx ../../docs/verify/d69-orb-containers/relay-restart.mjs`. It allocates its own relay directory and container and removes both. The image must already exist.

Not verified: production rollout, phone access and push delivery. Production daemons have not been restarted. Current-head Codex SECURITY review is pending under the updated D80 rule; code review alone does not satisfy it.

## Egress policy repair

A retained owned container is recreated when its inspected egress mount or environment does not match the requested spec, including enabled to none, a different socket path, a partial or writable pair, and an inspect record that omits mounts or env. Removal uses the ownership-checked container id and does not pass `--volumes`. If that spawn fails while the same container is still running, the Orb is left running. The shared relay socket keeps the global connection cap and also caps each container identity at 32 connections. The identity comes from the cgroup of the process reported by the accepted socket's peer credentials, and a `libpod-` id names the Orb. Peers with no container id share one unknown bucket. `policy-repair-container-canary.json` is the fresh scratch canary for this repair: ok, Podman, working sudo, 12 sudoRead rows blocked, guest-home enumeration without a sentinel, 67727 ms, and no sentinels remaining. Production services were not restarted.

## Dedicated export review fix

Source `f11b1c75862479da928edf7d4216d1aaeff7d282` fixes both P1 review classes. Twelve negative controls were red first across sibling-file disclosure, arbitrary export directories, symbolic aliases, permissions, missing boundary metadata and startup without the lane checkout. The exact Orb CI command passes 561 tests; 202 runtime/provider/probe tests and package types pass.

`dedicated-relay-restart.json` proves an adjacent synthetic private file prevents container creation, then a socket-only export works. The same container sees a recreated relay socket and container sudo cannot unlink it. `dedicated-host-check.json` passes the real host prerequisites. `dedicated-container-canary.json` passes the full real scratch Thread in 20.812 seconds with all Orb routes blocked, clean delivered objects, the leaking host negative control, live listeners, public GitHub access and no leftover sentinels. Production was unchanged.

## Current-main replacement candidate

The one-commit replacement starts from main `3e1bde9971ce50552be344dd49396e82dbbd0a6c` and preserves all unrelated main changes. The executed pre-evidence source commit is `056efcc27f385766594da5790123f04588d6859e`; the final unpublished amendment only adds this evidence. `current-main-host-check.json` and `current-main-relay-restart.json` pass. `current-main-container-canary.json` passes the full real scratch Thread in 21.408 seconds with clean Orb objects, the leaking host negative control and no sentinel residue. Current-main verification passes 202 runtime/provider/probe tests, 562 tests in the exact Orb CI command, package types, commit hooks and spec parsing. The relay server uses an isolated manual socket; no production services changed.

## Portability replacement on current main

The final replacement starts at main `7db30e1474852b43282682a40b4f2778c5d08d5d`, preserving the published #2890 history. Its only additional PR6 behavior change is test portability: the real rootless filesystem collector case is skipped under UID 0 because the collector deliberately refuses root. The bounded no-network Podman regression failed first at UID 0; after the fix all 66 cases complete with 65 passing and one skipped. The normal-user run passes all 66 cases. The exact changed Orb CI command passes 572 tests, including the newly merged build/session selector controls. The optional test-temp supervisor keeps the existing unsupervised helper contract. Earlier runtime evidence above retains its original source identity; fresh compiled acceptance and paired source/API screenshots are linked from the replacement PR. Production services remain unchanged.
