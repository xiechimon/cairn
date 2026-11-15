# Two-runner execution baseline

This slice locks down the existing native control plane before its Cloudflare port. It is not a cloud entrypoint or a replacement scheduler. The owner selected local-only, Tailscale, and a user-owned Worker/SQLite DO with computer runners; the architecture and offline storage experiment are in [PR #4903](https://github.com/xiechimon/cairn/pull/4903). Existing execution-plane research is [machine-execution-plane.md](../research/machine-execution-plane.md); its dated API descriptions are not the current protocol contract.

## The baseline uses production paths

`integration/test/two-runner-task-loop.test.ts` starts the real Hono application and SQLite schema with two real `runMachine` loops, Pi backends, separate private homes, machine credentials, session directories and workspaces. Registration, explicit runner selection, build creation, claim, tool execution, transcript upload and finish go through HTTP. A deterministic loopback model provider asks Pi to execute a harmless shell write and return a task-specific answer. The server's database and conversation API must agree with the files on the selected runner.

| Path | Current owner | Required observation |
| --- | --- | --- |
| Register / restart | `enrollMachine`, daemon `machine.json` | Distinct machines have distinct identities and tokens. Restart reuses the saved machine identity. |
| Select / enqueue | Build endpoint's `routeOverride`, `startBuilds` | A task names its runner when starting the first build; the task/build/step records remain authoritative. |
| Claim / execute | `claimStep`, daemon machine loop and Pi backend | Alpha and beta write different task markers only in their own task workspaces. |
| Transcript / finish | Daemon upload/done, `finishStep` | Exactly one completed step per build belongs to the selected runner; the append-only output has exactly one line, the original conversation contains its answer and the task reaches review. |
| Finish replay / fencing | Machine done endpoint, `finishStep` | A successful replay is accepted without changing the step; stale generations return 409 and another runner returns 404, leaving every stored step field unchanged. |
| All runners offline | Build and conversation endpoints | Named work can still be queued and earlier conversation results remain readable. |
| Named runner offline | Existing routing and wake/claim loops | The other online runner completes multiple real claim polls without taking the queued task or starting its model request. |
| Named runner returns | Saved machine credential, recovery and claim loops | The same machine runs its waiting task and preserves its previous workspace. |

An API registration key currently identifies a machine for re-enrollment: reusing one key rotates that machine's token rather than creating a second runner. The test must issue independent registration keys, not change this intentional product rule. This does not establish the future cloud pairing protocol.

## Acceptance limits

The native control plane is deliberately unchanged. The runners are independent daemon loops in one process, not two computers or daemon subprocesses. This baseline does not prove a DO can run the production claim/finish services, hibernation, uncertain in-flight recovery, cross-device shell confinement, local-only provider credential handling, browser bootstrap, revocation, or unaided installation. The model service is a stateful offline stub, not a real provider or subscription. The test confinement launcher starts only disposable fixture work; it does not certify the host's sandbox installation.

The cloud port must preserve this baseline while replacing native-only database/bootstrap, filesystem and credential dependencies at their existing ownership boundaries. A second cloud-only task queue or an HTTP bridge back to a privileged home server would not satisfy the selected architecture. No cloud resource or live service is needed or changed by this slice.
