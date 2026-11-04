# Parent-owned model channel

The task container reaches one pinned Anthropic Messages model through a Unix
socket. Its loopback bridge forwards only `/v1/messages` (including the native
SDK's `beta=true` route suffix). The task receives a placeholder credential. The
host transport supplies the real key, fixes the upstream origin, refuses redirects,
and never forwards task-supplied authentication.

The parent validates the model, output ceiling and custom-tool-only request before
sending it. Token-count preflight bounds input to 100,000 tokens, preserving the
verified pricing tier. A pessimistic reservation covers input at the highest cache
write price plus the requested maximum output. The existing shared monthly ledger
refuses a paid request that would pass its cap. A file lock shared by the logical run prevents concurrent sessions from
overcommitting its run cap. Before each request, the parent restores settled
costs and outstanding reservations from the shared monthly ledger, including
requests made before a process restart or report-path change. Missing or interrupted usage
consumes the reservation rather than becoming free.

Cost records are parent-written JSONL, with model, token usage, reservation,
actual cost when known, conservative charge and pricing source. `providerMode`
distinguishes a real transport, a fake and unverified imported transports. Cache
creation at both TTLs and cache reads are priced separately. Verified prices are
from [Anthropic's pricing documentation](https://platform.claude.com/docs/en/about-claude/pricing),
checked November 4, 2026. Only approved current Sonnet, Haiku and Opus 5.5 IDs are
accepted; there is no fallback to older models.

## Offline verification

```sh
PYTHONPATH=integration/eval/harbor/public python -m pytest integration/eval/harbor/public/tests/test_model_relay.py integration/eval/harbor/public/tests/test_relay_server.py -q
PYTHONPATH=integration/eval/harbor/public python -m cairn_harbor.relay_probe --output /tmp/cairn-relay-proof
```

The probe uses a fake upstream and a digest-pinned Node 24.14 container. It checks
that the task can edit its workspace, cannot see the host ruler, cost file, parent
credential or Docker socket, and cannot reach an external address. Messages still
complete through the mounted socket; another route fails. It records synthetic
cost separately and explicitly reports `realProvider: false`. Source digests pin
what was exercised. A trusted operator may supply a Docker command prefix through
`--docker-prefix-json`; the probe refuses an existing output directory.

Mount only the socket file into a task, never its parent directory. Keep the
runtime read-only and expose only the task workspace as writable. The relay binds
no host TCP port. Host worker count and request body size are bounded.

## Integration status

The paired eval workflow remains infrastructure-only. This channel alone does
not replace its candidate-host Python execution or prove parent-owned grading.
Production activation needs the trusted orchestrator, compiled in-container daemon
and final runtime-present cheat controls. No real Messages call or metered baseline
was run for this change.

Run identity, model, cap and shared ledger destination are trusted controller
inputs. Resuming a run must preserve its run identity and budget policy. Both
settled spend and interrupted reservations count toward its cap across sessions.
Per-request relay settlement must not be combined with a second
`run_baseline` arm reservation/settlement: the trusted controller must choose one
billing owner and bind its evidence before integration. No workflow invokes the
real transport automatically.
