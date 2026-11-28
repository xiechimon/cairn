# Cross-OS Runner and Desktop Tests on Mac mini

Run Cairn's Linux and Windows `@xiechimon/cairn-cli` (Runner) and `@cairn/desktop` test suites against any Git SHA on a Mac mini host that has OrbStack and VMware Fusion installed.

## Prerequisites on the Mac mini host

1. **Repo checkout** at `$CROSS_OS_REPO_DIR` (default `~/Code/cairn`).
2. **Linux target (`--target linux`)**:
   - OrbStack installed at `/Applications/OrbStack.app/Contents/MacOS/bin/orb` (override with `--orb-bin` or `CROSS_OS_ORB_BIN`).
   - Running Ubuntu ARM64 machine named `dev` (override with `--orb-machine` or `CROSS_OS_ORB_MACHINE`).
   - Passwordless `sudo` inside the OrbStack machine so the bootstrap step can prepare `/mtwork` and install `git`, `curl`, `fish`, `zsh`, `bubblewrap`, `zip`, `unzip`, `sqlite3`, and `gh` if missing, plus Node `v24.14.0` and `pnpm@12.5.1` under `~/mt`.
3. **Windows target (`--target windows`)**:
   - VMware Fusion installed at `/Applications/VMware Fusion.app/Contents/Library/vmrun` (override with `--vmrun-bin` or `CROSS_OS_VMRUN_BIN`).
   - A running Windows 11 ARM64 VM (auto-detected via `vmrun list`, or specified with `--vmx` / `CROSS_OS_WIN_VMX`) with Node 24 and pnpm provisioned under `C:\Users\<user>\mt\node`.
   - Guest password readable at runtime from `--win-password-file` / `CROSS_OS_WIN_PASSWORD_FILE` (default `~/.config/cairn/cross-os-win.pass`, falling back to `~/ISOs/unattend_src/autounattend.xml`).
   - If no Windows VM exists or is running, the script fails fast without downloading an ISO or creating a VM.

## Usage

Run directly on the Mac mini:

```sh
node scripts/ops/cross-os-test.mjs --target linux --sha origin/main
node scripts/ops/cross-os-test.mjs --target windows --sha origin/main
node scripts/ops/cross-os-test.mjs --target all --sha <commit-sha>
```

Run from a workstation over SSH (fetches or bundles `<sha>` to the mini first, then runs on the mini without GUI pop-ups):

```sh
node scripts/ops/cross-os-test.mjs --ssh <mini-ssh-host> --target linux --sha HEAD
node scripts/ops/cross-os-test.mjs --ssh <mini-ssh-host> --target windows --sha <commit-sha>
```

Restrict to one package suite with `--suite runner` or `--suite desktop` (default: `all`).

## Suites executed

- **Linux (`--target linux`)**:
  - `pnpm install --frozen-lockfile --ignore-scripts --store-dir /mtwork/pnpm-store`
  - `runner`: `CAIRN_MINI_TEST=1 pnpm --filter @xiechimon/cairn-cli test`
  - `desktop`: `CAIRN_MINI_TEST=1 pnpm exec vitest run --project @cairn/desktop`
- **Windows (`--target windows`)**:
  - `call pnpm install --frozen-lockfile --ignore-scripts`
  - `runner`: `call pnpm --filter @xiechimon/cairn-cli test`
  - `desktop`: `call pnpm exec vitest run --project @cairn/desktop`

## Output, locks, and disk hygiene

- Each target acquires an atomic per-target lock (`$CROSS_OS_STATE_DIR/locks/cross-os-<target>.lock`) and reclaims stale locks whose owner PID is dead.
- Full test output and the tested SHA are written to `$CROSS_OS_LOG_DIR/cross-os-<target>-<sha9>-<timestamp>.log` (default `~/mt/logs/`).
- Standard output ends with a single summary line per target:
  - `PASS target=<target> sha=<sha> suite=<suite> duration=<n>s log=<log-path>`
  - `FAIL target=<target> sha=<sha> suite=<suite> exit=<code> duration=<n>s log=<log-path>`
- Ephemeral worktrees under `/mtwork/runs/` (Linux) and guest work directories under `C:\Users\<user>\mt\cross-os-work\` (Windows) are cleaned up after each run.
