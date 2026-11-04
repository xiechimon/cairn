# Container Orb acceptance evidence

D69 PR 6 ports the secret-isolation canary and host prerequisites to rootless Podman. It leaves nspawn as the default until the control-plane cutover and reviewed runtime rollout.

Failure controls were written and observed failing before the fixes: missing probe output, an incomplete egress refusal inventory, HTTP default ports becoming port zero, and a socket-file bind hiding a replacement relay socket. Every expected attacker row must exist exactly once and be blocked; working container sudo and a leaking host negative control are required.

## Measured on Linux, 2026-11-04

- `host-check.json`: rootless Podman 6.1.4, delegated CPU/memory/PID controls, pinned image, private relay socket, uid 1000, empty effective/ambient capabilities, only loopback, working sudo, hidden host home, allowed public tunnel and refused private/metadata/CGNAT/loopback/disallowed-port targets. Probe removal succeeded.
- `relay-restart.json`: the same running container reaches the recreated relay socket after restart; container sudo cannot unlink it through the read-only directory bind.
- Targeted script tests: 219 passed. Runtime/probe tests: 121 passed.

The relay restart probe is reproducible from `apps/daemon` with `XDG_RUNTIME_DIR=/run/user/$(id -u) node --import tsx ../../docs/verify/d69-orb-containers/relay-restart.mjs`. It allocates its own relay directory and container and removes both. The image must already exist.

Not verified yet: the full scratch Thread canary, production rollout, phone access and push delivery. Production daemons have not been restarted. Current-head Codex SECURITY review is pending under the updated D80 rule; code review alone does not satisfy it.
