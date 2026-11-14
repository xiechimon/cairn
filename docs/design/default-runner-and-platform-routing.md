# Default Runner and platform routing

Tracking: #4596.

Status: the owner accepted the recommendations below on 2026-11-14 and asked that an offline default Runner notify him with a diagnosis and next steps (see Offline). He approved the page draft the same day. Nothing here is built. Baseline `origin/main` at `29747a329`. Page draft: [default Runner page draft](https://ampcode.com/artifacts/visuals/runner-dce37e81-29f0-4147-98b1-be3e8073c740). Related, not superseded: [daily multi-machine workflow](https://ampcode.com/artifacts/visuals/cairn-85f02a95-ac2b-4aba-bd3d-311b640979b8) (start-location picker, unapproved), [machine capability defaults and folders](machine-capability-defaults-and-folders.md), [durable thread engine dispatch](durable-threads-engine-dispatch.md).

## Request

The owner signs in to one Cairn account from a Linux, a Mac and a Windows computer. He marks Linux as the default Runner. Ordinary and background tasks run there. A task that needs macOS (an iOS app) goes to the Mac; a task that needs Windows (packaging a native Windows app) goes to the Windows computer. This works only for computers signed in to his own account.

## What the baseline does

| Fact | Where |
|---|---|
| A step's machine is the prior session's machine, else the routing rule's machine (`归属机`, shown as `首选机器`), else the only machine. With no target, no daemon claims it. | `routeTargets` and `soleClaimMachineId` in `apps/server/src/services/machine-routing.ts`; `tryClaim` in `machine-claim.ts`; `workerRouting` in `step-queue.ts` |
| With two or more machines and no rule machine, starting a task returns 409 `Name a machine before starting this task`, and the settings page forces a machine on the `session` rule. | `namedMachineForStart` in `apps/server/src/services/build-start.ts`; `mustNameMachine` in `apps/web/src/resources/routing-settings-page.tsx` |
| A waiting step raises a `no_machine` notice after 10 minutes and says it will not move to another machine. | `apps/server/src/services/unplaceable-steps.ts` |
| Hard gates are runtime, model, required capabilities (MCP servers, models, Orb executor), local path, Claude login and quota, and Linux confinement. | `machineEligibility` in `apps/server/src/services/dispatch-eligibility.ts` |
| A task can carry `routeOverride: { machineId, requiredCapabilities }`, stored as JSON on `todo`. Required capabilities merge with the rule's. | `routeOverrideSchema` in `packages/shared/src/records/routing-rule.ts`; `withOverride` in `apps/server/src/services/routing-rules.ts` |
| The daemon reports `osPlatform` as `linux`, `darwin` or `other`. Windows reports `other`. No toolchain (Xcode, Windows SDK) is reported. | `apps/daemon/src/machine-loop.ts`; `machineCapabilitiesSchema` in `packages/shared/src/records/machine-capabilities.ts` |
| The Coordinator creates and starts tasks through `create_todo` with no machine or platform field. | `apps/server/src/services/chief-tools.ts` |
| Every machine row carries a `teamId`, and routing only considers machines of the task's team. | `machine.teamId` in `apps/server/src/db/schema.ts`; `targetUnavailable` in `machine-routing.ts` |

So a default machine exists in substance (the `session` rule's machine), but it lives in routing settings, it is a hard pin, and nothing knows a task's platform.

## Prior art

| Product | Where work runs | Platform need | Needed host offline |
|---|---|---|---|
| Amp runners ([docs](https://ampcode.com/docs/cli/runners)) | The user picks a runner and folder per thread; the runner must be signed in to the same Amp account | No platform matching; the user picks | Mac sleep: the thread waits for that runner |
| GitHub Actions self-hosted ([labels](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/use-in-a-workflow)) | Runner gets default labels `self-hosted`, OS and architecture; a job lists labels in `runs-on` | A runner must have all listed labels | The job stays queued |
| Buildkite agents ([tags](https://buildkite.com/docs/agent/cli/reference/start#agent-targeting)) | Agents carry tags such as `os` and `xcode=…`; steps target them; untagged work goes to the default queue | All named tags must match | The job waits for a matching agent |
| Devin ([macOS support](https://docs.devin.ai/onboard-devin/environment/macos-support)) | Linux by default; an admin sets an organization default platform | Chosen per session (`!mac` in Slack, `platform: "macos"` in the API) | Not documented |
| Codex cloud ([environments](https://learn.chatgpt.com/docs/environments/cloud-environments)) | A default environment, or one picked per task | Not a platform concept | Not applicable |
| T3 Code (`pingdotgg/t3code` at `dea07a1b`, `docs/internals/remote.md`, `packages/client-runtime/src/load-balancing.ts`) | Each machine is its own environment; opt-in load balancing for new drafts only | Candidates must have the project and provider | Work waits; nothing moves a thread |

Every product keeps a default and lets the task name a hard need. None silently runs a platform task on the wrong OS, and none moves running work. Cairn adds one thing they leave to the user: the Coordinator fills in the need.

## Proposal

**Name.** The UI word becomes `Runner` (as `Agent` and `Coordinator` stay English in the Chinese UI). Code, tables and the wire keep `machine`. `电脑` keeps meaning the desktop the agent controls. The rename is a copy-only slice: 72 `t()` strings in 26 web files and the server's user-facing strings, plus the `CONTEXT.md` row.

**Default Runner.** One nullable `team.defaultMachineId`. Cairn is personal, so the team is the owner.
- Set from the Runner page row menu, `设为默认 Runner`. Owner session only, through the existing owner-only `PATCH /api/machines/:id` family or a team setting route.
- The first machine to enroll becomes the default. When a second enrolls, the default stays. Migration seeds it from the `session` rule's machine when set, else from the only machine.
- Routing fallback becomes session machine, then task pick, then rule machine, then default Runner, then the only machine. The 409 at task start goes away once a default exists, and the routing settings page shows `跟随默认 Runner` as the unset option.
- Revoking or deleting the default clears it. Waiting tasks then show `没有默认 Runner` and the Runner page asks for one.

**Platform need.** `requiredCapabilities` gains `os: 'linux' | 'macos' | 'windows'`. It is a hard gate, like a required MCP server. It is stored on the task through `routeOverride.requiredCapabilities`, which already persists.
- The daemon reports `windows` for `win32`. A server or daemon that does not know the value treats the OS as unknown, and unknown never satisfies a need, so mixed versions fail closed.
- The Coordinator's `create_todo` and `update_todo` take an optional `platform`. Its prompt says to set it only when the work must build or run on that OS: an iOS or macOS app, Xcode or Swift UI work, a Windows installer or native Windows build. No keyword matching in code.
- The owner can change it in the task's `…` menu, `运行平台`, before the task starts. After a session exists the choice is locked: `运行中不能改，换平台请新开任务`.

**Routing.** When a task has no need, or the default Runner's OS matches it, the default Runner takes it, as today. When the default does not match, any online Runner with that OS may claim it; with several, the one with the fewest running steps. Session affinity, an explicit task pick and a local-path project stay hard; a need they cannot meet blocks the task with a reason instead of moving it.

**Offline.** A task whose Runner is offline waits; it never moves silently and never runs on another OS. Waiting is not silent either:
- Two minutes after a Runner goes offline with tasks waiting on it, the Coordinator posts one notice in its conversation for that offline period. It lists the waiting tasks, so ten waiting tasks do not mean ten notices. The delay hides daemon restarts, which reconnect within seconds. For this case the notice replaces today's generic 10-minute `no_machine` text in `unplaceable-steps.ts`.
- The notice says what the server knows: when the Runner was last seen (`machine.lastSeenAt`), and that its last reported Cairn version is too old when `latestCliVersion` shows it. It does not guess beyond that.
- It gives the checks in order: the computer is on and not asleep; it can open the Cairn page (network and the route to the server); `cairn status`, then `cairn start` if it is not running; if it still fails, `cairn logs -f`, with the last lines pasted to the Coordinator, which reads them and explains.
- For a task that could run elsewhere (no session yet, not a local-path project, and another online Runner meets its platform), the notice offers `这次改在 mac-mini 上跑`. That is the owner's explicit task pick, written to `routeOverride.machineId`, not an automatic move.
- When the Runner returns, waiting tasks start and the notice updates to `linux-box 已恢复，2 个任务已开工`.

**Toolchains.** Xcode and Windows SDK are out of the first cut. A Mac Runner is assumed to have Xcode; a missing toolchain fails the task with the build's own error. If that happens in practice, the daemon can report toolchain tags the way Buildkite agents do.

## What the owner sees

| Place | Copy (example) |
|---|---|
| Runner page header | `任务默认在 linux-box 上跑。需要 macOS 或 Windows 的任务会自动去对应系统的 Runner。所有 Runner 都要用同一个 Cairn 账号登录。` |
| Runner row | name; `Linux · 在线 · 默认`; menu `设为默认 Runner`. Old daemon: `系统未知 · 更新 Cairn 后才能接有平台要求的任务` |
| Task head status line | `进行中 · mac-mini · 需要 macOS`; waiting in ochre `等 mac-mini 上线 · 需要 macOS`; `还没有 Windows Runner · 需要 Windows` with `添加 Runner`; rust `项目代码只在 linux-box 上 · 需要 macOS` with `打开项目设置` |
| Task `…` menu | `运行平台`: `不限（默认 Runner）`, `macOS`, `Windows`, `Linux` |
| Coordinator notice, Runner offline | `linux-box 离线了，2 个任务在等它。最后在线 23 分钟前。` then the four checks, then `这次改在 mac-mini 上跑` when allowed |

No new page, no dashboard, no new composer control. When the start-location picker from the daily multi-machine design ships, it opens on the routed Runner and an explicit pick there is the task pick above.

## Paths that read or write the new state

| Path | Reads or writes | Behavior on failure | First test |
|---|---|---|---|
| Owner sets default (`PATCH`) | Writes `team.defaultMachineId` | Other-team or unknown machine 404; paired device or agent credential 403, nothing written | agent credential cannot set the default |
| Machine enroll | Writes the default when none exists | Enroll failure leaves the default unchanged | second enroll keeps the first as default |
| Machine revoke or delete | Clears the default if it pointed there | Waiting tasks show `没有默认 Runner`; nothing claims by accident | revoked default stops new claims by that machine |
| Migration | Seeds from the `session` rule or the only machine | Ambiguous (several machines, no rule machine) leaves null | rule machine becomes default; rule unchanged |
| `namedMachineForStart` | Reads default | No default and several machines keeps today's 409 | start succeeds with a default and two machines |
| `routeTargets` in claim, queue projection and `unplaceable-steps` | Reads default, task `os`, machine `osPlatform` | All three call one function, so claim and the shown reason agree | iOS task on Linux default is claimed by the Mac, refused by Linux |
| `missingCapabilityItems` | Reads `os` | Unknown OS is missing | old daemon without `osPlatform` cannot claim a macOS task |
| Daemon presence | Writes `osPlatform` including `windows` | Unparsable value omitted, so the OS becomes unknown | `win32` reports `windows` |
| Coordinator `create_todo` and `update_todo` | Writes task `os` | Invalid value rejected by schema; nothing created | `platform: 'macos'` lands in `routeOverride.requiredCapabilities.os` |
| Task `运行平台` menu | Writes task `os` | 409 once a session exists | change after claim is refused |
| Offline notice sweep | Reads waiting steps, routed Runner, `lastSeenAt`, `latestCliVersion`; writes one notice per Runner offline period | Runner back before two minutes: no notice; a second offline period gets a new notice | ten waiting tasks on one offline Runner raise one notice |
| `这次改在 … 上跑` action | Writes task `routeOverride.machineId` | Refused with 409 once a session exists, for a local-path project, or when the target fails the platform or other hard gates | action on a claimed task is refused and the task stays put |
| Local-path project | Reads `localPath` machine | Need unmet on that machine blocks with a reason | macOS task on a Linux local project blocks, does not move |

`routes-machine.ts` and `services/machine*.ts` are security surfaces: each slice that touches them runs `/security-review` and records the disposition line.

## Slices

1. Daemon reports `windows`; the Runner page shows each Runner's OS. Small, no routing change.
2. Default Runner: column, migration, owner route, Runner page action, routing fallback, 409 removal.
3. Offline notice: one Coordinator notice per offline period with last seen, the checks and the `这次改在 … 上跑` action.
4. Platform need: `os` capability, routing for a non-matching default, queue wording, Coordinator `platform` parameter, task menu.
5. Copy rename `机器` to `Runner`.

Running the daemon on Windows is a prerequisite for the Windows half and is not covered here: no Windows daemon has been verified, the command gate parses POSIX shell, and confinement is Linux-only. Until that work lands, Windows tasks show `还没有 Windows Runner`.

## Decisions (owner, 2026-11-14)

1. `Runner` in the UI, `machine` in code.
2. Tasks wait for an offline Runner, and Cairn notifies the owner with a diagnosis and next steps (Offline above).
3. The Coordinator sets the platform per task, and the task menu can change it. No per-project default for now; add one only if the Coordinator misjudges in practice.
4. "Same account" means every computer is enrolled into the owner's own Cairn server. No third-party sign-in (GitHub, Google, WeChat) is added: a computer joins through the existing browser approval (`cairn start` prints `/app/machines/authorize?enroll=…`, the owner approves within 10 minutes; `apps/daemon/src/machine-enroll.ts`, `/api/machine/enroll/*` in `routes-machine.ts`). Third-party OAuth needs a fixed public callback domain registered with each provider (WeChat requires an approved website app whose redirect domain matches), which a loopback or tailnet self-hosted server does not have. The real prerequisite for a second and third computer is a route to the server, since it listens on loopback only (`docs/getting-started.md`).
