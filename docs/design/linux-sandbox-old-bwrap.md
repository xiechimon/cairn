# Linux task sandbox on older distributions

Date: 2026-11-16
Status: accepted after four rounds of independent review; refs #3787, extends the Segment 3 availability contract in [linux-harness-confinement.md](linux-harness-confinement.md)

## Problem

A newcomer's Runner on Ubuntu 24.04 LTS stays "Task sandbox not ready" for good, and the Runner page sends them down the wrong path. Observed in a fresh Ubuntu 24.04.5 VM with the CLI packed from `main`:

| Step | What happened | Runner page said |
| --- | --- | --- |
| No `bwrap` installed | `Failed to find executable bwrap` | `bwrap-missing`: install bubblewrap. Correct. |
| `sudo apt install bubblewrap` (0.9.0) | `bwrap: Unknown option --overlay-src` | Generic: update the CLI, then `cairn restart`. Wrong; restarting cannot help. |
| Same, run by hand outside Cairn | `bwrap: setting up uid map: Permission denied`; dmesg shows `apparmor="DENIED" operation="capable" profile="unprivileged_userns" capname="sys_admin"` | (would also be generic) |
| bubblewrap 0.11.1 built into `/usr/local`, plus an AppArmor profile granting it `userns` | Probe still fails: `bwrap: No permissions to create a new namespace` | (generic) |

The last row also happens on Ubuntu 26.04 with its own bubblewrap 0.11.1 and Ubuntu's `bwrap-userns-restrict` profile, and the cause is not bwrap. With the restriction on, the same bwrap argv exits 0 from a login shell and under a bare `systemd-run --user --pipe --wait`. Adding `--property=ProtectControlGroups=yes` alone makes it fail, on systemd 255 (24.04) and 259 (26.04). In a user manager that property makes systemd create a user namespace in the pre-exec process (audit: `operation="userns_create" profile="unconfined" comm="(bwrap)" ... target="unprivileged_userns"`). AppArmor then confines that process, and the bwrap it executes, under `unprivileged_userns`, so bwrap's own `unshare` gets EPERM and no profile attached to the `bwrap` path can apply. `confine.ts` sets that property on every task unit, so on Ubuntu 24.04 and 26.04 with default settings the Runner never becomes ready (observed); 23.10, 24.10 and 25.04 have the same restriction and are expected to behave the same (not tested). Getting started currently says the opposite for 25.04 and later; that claim came from a run by hand, not under Cairn's unit.

`--overlay-src` and `--tmp-overlay` arrived in bubblewrap 0.11.0: `bubblewrap.c` at `v0.9.0` and `v0.10.0` has no `--overlay-src`, `v0.11.0` has it. Packaged versions, read with `apt-cache policy` (backports enabled): Ubuntu 24.04 0.9.0, Debian 12 0.8.0 (no newer backport in either), Ubuntu 25.04 0.11.0, Ubuntu 26.04 0.11.1, Debian 13 0.12.0. So Ubuntu 24.10 and any 0.10 build are affected too. Ubuntu 23.10 and later restrict unprivileged user namespaces through AppArmor (`kernel.apparmor_restrict_unprivileged_userns=1`); Ubuntu 25.04 and later ship the `bwrap-userns-restrict` profile for `/usr/bin/bwrap`, so `apt install bubblewrap` is enough there once the unit property above is gone.

## Decision

Remove one systemd property that blocks Ubuntu without adding protection, name the two new failures precisely, and give the fix that works.

0. Drop `--property=ProtectControlGroups=yes` from the task unit in `confine.ts`. The approved design requires that no writable cgroup controls reach the child and that bwrap remains the single sandbox; bwrap already meets the first. Inside bwrap's recursive `--ro-bind / /` the cgroup tree is mounted `ro`: in the Ubuntu 26.04 VM, a task unit without the property printed `/sys/fs/cgroup ro,nosuid,nodev,noexec,relatime`, and both `echo $$ > <parent>/cgroup.procs` and `mkdir <parent>/x` failed with `Read-only file system`. The later binds (`--dev-bind /dev`, workspace, caches, state, Git directories) are user directories and `/dev`; an unprivileged user cannot mount a cgroupfs into them, and the probe below checks the final mount table rather than trusting that. Without bwrap, the same `mkdir` in a plain user unit succeeds, so the probe's checks fail if the read-only mount is lost. `Delegate=no`, `Slice=app.slice`, `KillMode=control-group`, `BindsTo=` and the cleanup checks stay as they are. The one thing the property covered that bwrap does not is the instant between the unit's start and bwrap's mounts, when only the trusted `bwrap` binary runs. A live probe in `confine-ownership.test.ts` (gated like the existing ones on `CAIRN_CONFINE_SYSTEMD_PROBES=1`) runs a confined command that first confirms its own cgroup is visible, then asserts that `mkdir` in it and a write to its `cgroup.subtree_control` both fail with exactly `Read-only file system`, and that every `cgroup` or `cgroup2` entry in its final `/proc/self/mountinfo` carries `ro`. The unit metadata check asserts `ProtectControlGroups=no`, so re-adding the property, which breaks Ubuntu, fails a test.
1. Two new `confinementCause` kinds, classified from bwrap's stderr in `confinementCauseOf` (the only place causes are made):
   - `bwrap-too-old`: a line starting `bwrap: Unknown option --overlay-src` or `bwrap: Unknown option --tmp-overlay`.
   - `userns-denied`: a line starting `bwrap: setting up uid map: Permission denied` (Ubuntu's AppArmor restriction: the namespace is created, then `CAP_SYS_ADMIN` inside it is denied, as observed) or `bwrap: No permissions to creating new namespace` (`v0.8.0` through `v0.11.0`) or `bwrap: No permissions to create a new namespace` (`v0.11.1`), both EPERM from `unshare`. That second wording is what a 0.11.1 build under a Cairn systemd unit printed on Ubuntu 24.04 with AppArmor's restriction, where the same argv from a login shell printed the uid map error instead. The kernel-unsupported (EINVAL) and namespace-limit (ENOSPC) messages stay unclassified and keep the generic notice; this design does not claim to cover them.
   Both are `startup-failed` reports, so the existing recheck every minute picks up the repair without a restart.
2. The Runner page names each fix. `bwrap-too-old`: this machine's bubblewrap lacks the overlay options, which need 0.11 or newer (Ubuntu 24.04 and Debian 12 ship older); install 0.11 or newer from source into `/usr/local`, commands in getting started. `userns-denied`: the system blocks user namespaces for `bwrap`; on Ubuntu with a `bwrap` built into `/usr/local`, add an AppArmor profile for it (the packaged `/usr/bin/bwrap` on Ubuntu 25.04 and later already has one), elsewhere allow unprivileged user namespaces (`kernel.unprivileged_userns_clone=1` on Debian kernels), commands in getting started.
   Which `bwrap` runs: `confine.ts` spawns `systemd-run ... bwrap`, and `systemd-run` resolves a relative command through the caller's `$PATH` before handing an absolute path to the manager. The caller is the daemon, and `cairn start` copies the starting shell's environment into the daemon's unit (`supervisor.ts`, `--setenv` for every inherited variable). So the daemon uses the `bwrap` that `command -v bwrap` finds in the shell that ran `cairn start` or `cairn restart`. The docs tell the user to check that it prints `/usr/local/bin/bwrap`, and to run `cairn restart` from such a shell if the Runner was started with a `$PATH` that does not select `/usr/local/bin/bwrap`, whether `/usr/local/bin` is missing or comes after `/usr/bin`. Only in that case is a restart needed; otherwise the next recheck picks the new `bwrap` up.
3. Getting started carries the exact commands for both, verified in the Ubuntu 24.04 VM until the Runner reports ready.

## Rejected

| Option | Why not |
| --- | --- |
| Fall back to a read-only home without `--tmp-overlay` when bwrap is old | `confine.ts` mounts the writable overlay first, then creates masks for credential paths, including ones that do not exist yet (#3789, "mask credentials that appear after sandbox startup", covered in `apps/daemon/test/confine.test.ts`), then remounts read-only. Without the overlay bwrap cannot create mount points for absent paths, so the launch fails closed; making it start would mean skipping the absent masks, and a credential written after start would then be readable. That weakens an approved boundary and needs its own owner decision. |
| Run unconfined on old distributions | The approved design forbids any unconfined fallback. |
| Tell Ubuntu users to set `kernel.apparmor_restrict_unprivileged_userns=0` | Works (the Ubuntu 24.04 VM went ready at the next recheck), but it lifts the restriction for every program on the machine to work around one unit property that adds nothing over bwrap. |
| Ship a prebuilt bwrap with the CLI | A native binary per architecture in an npm package, plus an AppArmor profile it cannot install itself; more supply chain for two distributions with a documented fix. |
| `CAIRN_BWRAP` path override | Not needed: the `$PATH` the daemon inherits already selects the `bwrap`, and nothing guarantees `/usr/local/bin` is on it or ahead of `/usr/bin`. Getting started has the user check `command -v bwrap` and run `cairn restart` from a shell where it prints `/usr/local/bin/bwrap`, as in Decision 2. |

## Wire compatibility

`confinementCause.kind` is a closed enum parsed with `safeParse` and the whole cause is dropped when it does not parse (`parseReportedCapabilities`, tested by the older-schema case in `packages/shared/test/machine-capabilities.test.ts`).

| Daemon | Server and web | Result |
| --- | --- | --- |
| New | New | New kind stored and shown with its fix |
| New | Old | Cause dropped on ingest, generic notice: today's behavior, no error |
| Old | New | Old daemons never send the new kinds; unchanged |

Downgrade across this change is the one rough edge, and it does not heal on its own. `machineRecordSchema` embeds the strict `machineCapabilitiesSchema`, and both `toMachineRecord` (server) and `MachineClient.me()` (daemon) parse with it. Once a new daemon has stored `bwrap-too-old` or `userns-denied`:

- Server rolled back, daemon still new: the old server fails to serialize that machine until a later presence report replaces the stored capabilities. Ingest goes through `mergeReportedCapabilities`, which merges and can reject a report as stale, and the old server's `parseReportedCapabilities` drops the unknown cause; a report it accepts clears the cause, but this design does not promise when that happens.
- Daemon rolled back, server new or old: the old daemon's first step at startup is `me()` (`ConfinementAvailability.check`), which fails to parse and is retried as an unreachable server, so the daemon never sends presence and never comes online. Nothing in the old daemon can clear the stored cause.

Recovery in both cases is to move forward again: run a server and a CLI at or after this change. This PR (a) makes the capabilities reader drop an unknown cause instead of failing (`confinementCause` parsed with a catch to undefined), so the next new kind cannot repeat this, and (b) adds tests that a record carrying a cause kind the reader does not know parses with the cause dropped and `confinement` kept, and that the daemon's real `MachineClient.me()`, given such a record by its fetch, resolves with `confinement` kept instead of throwing, which is the call that keeps an old daemon offline. The window for builds already deployed is recorded as a known limitation; the npm packages are unreleased, so it reaches only builds run from `main`.

No migration, no new field, no change to `confinementReport`, readiness, dispatch or claims. The only sandbox change is decision 0.

## Every reader and writer of the cause

| Path | Change and test |
| --- | --- |
| `confinementCauseOf` (daemon) | Classify the two stderr shapes; the old uid-map negative example becomes a positive one. Unit test per shape, plus an unrelated stderr staying `undefined`. |
| `ConfinementAvailability.check` / `machine-loop` report and recheck | Unchanged code. `recoverable` special-cases only `not-own-unit`, so both new kinds are rechecked every minute; the existing automatic-recovery test is parameterized over both. Recovery happens at the next recheck whose probe passes, not at a fixed minute. |
| `confinementCauseSchema` (shared) | Two enum values; parser test accepts them, older schema still drops them. |
| `sandboxNotice` (web) and `en.ts` | One message per kind; the cause-to-fix test gets two rows. |
| `machineRecordSchema` readers: `toMachineRecord` (server) and `MachineClient.me()` (daemon) | Tolerant cause parsing as above; test that a record with an unknown cause kind parses with the cause dropped and `confinement` kept, and a `MachineClient.me()` test through `fetchImpl` (the `machine-loop` harness's fake API skips this parse). |
| Presence ingest (`routes-machine.ts`, `markPresence`, `mergeReportedCapabilities`, `parseReportedCapabilities`) | Unchanged. Drops a cause it cannot parse and merges the rest with the stale-report check; not relied on to heal a downgrade. |
| Machine notification on outage | Reads the report, not the cause; unchanged. |

## Acceptance

Red first on `main`: both stderr shapes classify as `undefined`, and a record with an unknown cause kind fails to parse. Live, with `kernel.apparmor_restrict_unprivileged_userns=1`: in the Ubuntu 24.04 VM, a Runner from this branch shows `bwrap-too-old` with apt's 0.9.0; after the documented source build it shows `userns-denied`; after the documented AppArmor profile it reports ready at the next recheck, without `cairn restart`. In the Ubuntu 26.04 VM, a Runner from this branch reports ready after only `sudo apt install bubblewrap`. The live cgroup probe passes on omarchy (Arch).
