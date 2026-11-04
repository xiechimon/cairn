# Container Orb acceptance evidence

D69 PR 6 ports the secret-isolation canary and host prerequisites to rootless Podman. It leaves nspawn as the default until the control-plane cutover and reviewed runtime rollout.

Failure controls were written and observed failing before the fixes: missing probe output, an incomplete egress refusal inventory, HTTP default ports becoming port zero, a socket-file bind hiding a replacement relay socket, host-runtime-path ambiguity, and scratch cleanup accepting foreign owners or mutable names. Every expected attacker row must exist exactly once and be blocked; working container sudo and a leaking host negative control are required.

## Measured on Linux, 2026-11-04

- `host-check.json`: rootless Podman 6.1.4, delegated CPU/memory/PID controls, pinned image, private relay socket, uid 1000, empty effective/ambient capabilities, only loopback, working sudo, hidden host home, allowed public tunnel and refused private/metadata/CGNAT/loopback/disallowed-port targets. Probe removal succeeded.
- `relay-restart.json`: the same running container reaches the recreated relay socket after restart; container sudo cannot unlink it through the read-only directory bind.
- `owner-host-check.json` and `owner-relay-restart.json`: fresh repeats after integrating #2761 immutable container IDs and enrolled daemon ownership; both pass. The relay ran as an isolated manual process; the deployment unit was not started.
- `container-canary.json`: the full scratch server, enrolled daemon, actual Orb worker and runner delivered the attacker result and normal Git bundle in 25.956 seconds. Every required Orb route was blocked, container sudo worked, public GitHub was reachable, and all delivered Orb objects were free of sentinel markers. The host negative control read all five synthetic sentinels, its delivered objects contained their markers, and both host listeners were reachable. No sentinels remained after cleanup.
- `cleanup-identity.json`: real Podman name replacement between inspect and removal deletes only the inspected original ID. The foreign replacement survives and is rejected on a subsequent cleanup attempt.
- Exact changed Orb CI command: 558 tests passed, including `trial-evidence-check.test.mjs`. Targeted runtime/provider/probe tests: 195 passed. Canary cleanup tests were red before ownership/ID validation; all 104 canary script tests pass.

The fresh source commit is `57afe4047`; subsequent evidence-only commits do not change the executed implementation. The image is `cairn-orb-base:eb01c9191591ca17`.

The container canary requires `XDG_RUNTIME_DIR`, a pinned `CAIRN_ORB_IMAGE`, and `CAIRN_ORB_EGRESS_SOCKET` pointing to a live private relay. Run `CAIRN_ORB_RUNTIME=podman node scripts/ops/orb/canary.mjs --json --out /tmp/new-container-canary.json`. It uses the actual host relay socket as a host-runtime-path isolation target. A generic guest `/run/user/1000` directory is expected and does not identify a mounted host runtime directory.

The relay restart probe is reproducible from `apps/daemon` with `XDG_RUNTIME_DIR=/run/user/$(id -u) node --import tsx ../../docs/verify/d69-orb-containers/relay-restart.mjs`. It allocates its own relay directory and container and removes both. The image must already exist.

Not verified: production rollout, phone access and push delivery. Production daemons have not been restarted. Current-head Codex SECURITY review is pending under the updated D80 rule; code review alone does not satisfy it.
