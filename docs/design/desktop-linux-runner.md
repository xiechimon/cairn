# Linux desktop Runner lifecycle

The Linux archive reuses the desktop shell and its bundled server and Runner. It does not change the sandbox policy or introduce a new backend. The existing stack decision is documented in `../research/desktop-app-stack-2026-11-08.md`.

## Ownership

The desktop main process owns one transient systemd user service per Runner launch. A direct foreground child inherits the desktop's service or scope and fails the daemon's invocation identity check. Linux launches the same foreground command through `systemd-run --user --pipe --wait --collect`, with a unique service name. macOS keeps the direct child path.

The service inherits the Runner environment by variable name (`--setenv=NAME`), not by values in command arguments. It must not inherit systemd invocation identity from the desktop. The service manager supplies its own invocation identity. The child stays attached through `systemd-run`; output and restart budgeting remain owned by the desktop.

The sandbox clears its environment before starting the readiness gate. When the daemon runs on Electron, both that gate and its child command must retain `ELECTRON_RUN_AS_NODE=1`; otherwise the same executable attempts to open Chromium inside the task sandbox. Native Node keeps its existing clean environment. No model credentials are added to the gate environment or command arguments.

The app must be extracted outside `/tmp`: the task sandbox deliberately masks `/tmp`, which would hide Electron itself. This is an installation requirement, not a reason to expose the host temporary directory.

## Transitions and failures

- Start: enroll with the local server, write private machine state, launch a fresh service, and report the daemon's existing readiness checks.
- Crash: the attached command exits; the existing restart budget schedules another launch with a new service name. Missing systemd or a rejected service start fails visibly rather than bypassing confinement.
- Stop or quit: cancel scheduled restarts and explicitly stop the owned service, including its cgroup. Wait for the attached command to exit before stopping the server. Never target services by a process-name pattern.
- Reconnect: use the existing restart entry point; do not launch a second child while one is active.

## Validation

Launch the extracted archive with independent HOME and XDG directories. Before the fix, the real machine API reports `confinementCause.kind=not-own-unit`. After the fix it must report `capabilities.confinement.state=ready`. Confirm the daemon belongs to its own service and that quitting removes that service, its processes and the server listener. Repeat launch from clean data. A real model task remains a separate acceptance check and requires the owner's login.
