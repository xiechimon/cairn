# Keeping the omarchy host's RAM for agents (2026-11-09)

Owner request (ian, 2026-11-09): how to stop leftovers from eating RAM so it runs agents. Read-only research: no host change was made. Claims are marked Measured (read or run in this session), Inferred (derived from Measured) or Unverified (the rest).

Domain row used: "Host ops: services" in the research SOURCES.md (systemd man pages plus the tools' own docs and source). Added: kernel docs, Node, Playwright, Vitest source.

## 1. Measured state (2026-11-09 ~02:20 PST)

| Fact | Value | Tag |
|---|---|---|
| RAM / swap | 31.0 GiB RAM; zram0 31.1G (zstd, priority 100) plus btrfs swapfile 31G (priority 0) | Measured `free`, `swapon --show` |
| zram now | 19.3G data compressed to 6.3G (6.5G RAM, ratio 2.95), no mem_limit | Measured `zramctl` |
| swapfile used | ~3G | Measured `swapon` |
| `/tmp` | tmpfs 16G, `nr_inodes=1048576`, usrquota, 8.7G used (13G earlier today) | Measured `df`, `mount` |
| `/tmp` resident in RAM | `Shmem` only 0.12-0.40 GB while `/tmp` holds 8.7G, so ~8G of tmpfs pages sit in swap | Inferred from `/proc/meminfo` Shmem vs `df` |
| Per-process swap | 14.6G (`VmSwap` sum); total swap used ~25G; the ~10G remainder is shmem (tmpfs) | Inferred |
| Swap owners (`VmSwap`) | docker containers 10.1G; terminal scopes (pi, codex, claude sessions) 2.2G; other user apps 1.4G; Claude desktop scope 0.3G | Measured |
| Docker | 27 containers, 4.5 GiB resident; 17 are `measure-community` (ian's Java stack: 14 `app.jar` JVMs, seata `-Xms2048m`, mysql, nacos), 8 are `cairn-langfuse` | Measured `docker stats`, `ps` |
| Cache | buff/cache 8-11.6G, slab 3.5G (1.9G reclaimable) | Measured, reclaimable so not a leak |
| Load | 1-min 12.8 now; 5/15-min averages 46 and 45; PSI memory some avg300 3.4%, io some avg300 35%, cpu some avg300 5.8% | Measured `/proc/pressure/*` |
| Kernel OOM kills | none in the kernel log | Measured `journalctl -k` |
| systemd-oomd kills | marked `cairn-daemon.service` (00:06) and the whole `app-com.anthropic.Claude-*.scope` (00:52, 10G, holding every Claude Code session) for pressure on `app.slice` above 50% for 20s | Measured `journalctl -u systemd-oomd` |

### /tmp contents by cause (Measured `du`, sizes at the time)

| Class | Size | Why it leaks |
|---|---|---|
| Vitest `/tmp/<21-char nanoid>/ssr/<sha1>` | 1681 dirs, 4.9G (0.07G <1h, 0.97G 1-6h, 2.5G 6-24h, 0.5G 1-2d, 0.8G >2d) | See 2.1: Vitest creates the dir with `join(tmpdir(), nanoid())` and removes it only on clean close |
| `tsx-1000` | 986M, already a symlink to disk (`~/.cache/tsx-1000`), so it is not RAM | Measured `ls -la`, `disk-caches.conf` |
| `t3c-*`, `chief-image-*`, `lr-src`, `rs`, `cairn-assets-*`, `yt-sub` and other named agent scratch | ~1.9G | Agents write named scratch by hand; nothing owns it |
| Playwright `playwright-transform-cache-1000` | 396M, already on disk via `PWTEST_CACHE_DIR` | Measured |
| `claude-1000` (Claude Code) | 142M | Used by the tool; excluded from age cleanup by `x /tmp/claude-1000` |
| Playwright profile and artifacts dirs | ~0 now (4 dirs, 0 bytes) | Measured `du`; both use `os.tmpdir()` (see 2.2) |
| `cairn-test-*` and `ct-*` | ~0 now (548K) | The guard and `test-temp-run` work for the prefixes they know |

Hedge on aging: my own `du` and `ls` reads bump directory atime under relatime, so atime-based "older than N days" counts taken after my reads are lower bounds. The bucket sizes above use mtime. Inferred.

## 2. Mechanisms and the sources that own them

### 2.1 Vitest temp dir (root cause of the largest /tmp class)

- Measured: installed `vitest@5.0.1`, `node_modules/vitest/dist/chunks/index.DzobfTyw.js`: the project constructor sets `this.tmpDir = join(tmpdir(), nanoid())` (line 12021) and the core sets `_tmpDir = join(tmpdir(), nanoid())` (20431). `clearTmpDir()` runs `rm(this.tmpDir, {recursive: true})` (12286) and its only caller is the project close path (12236).
- Measured: a surviving dir holds `ssr/<sha1>` files of transformed code for a worktree path (e.g. `/tmp/seX6xTA53ZamJ61X-PXcv/ssr/...`, 29M, mtime 2026-11-08 04:20).
- Inferred: any vitest run that is SIGKILLed, times out, or is torn down with its lane never reaches `clearTmpDir`, so the dir stays until age cleanup. 1681 survivors in about 2.5 days is about 2G/day.
- Measured: `tmpdir()` is Node `os.tmpdir()`, which reads `TMPDIR`, then `TMP`, then `TEMP`, then `/tmp` ([Node os.tmpdir](https://nodejs.org/api/os.html#ostmpdir)). So one env var redirects the whole class, including heavy-slot paths that call `tmpdir()`.

### 2.2 Playwright

- Measured: `playwright-core@1.63.0/lib/coreBundle.js` builds `join(os.tmpdir(), "playwright-artifacts-")` in five places (lines 38830, 39760, 43057, 44153, 50498), so it follows `TMPDIR`.
- Measured: `/tmp/playwright_chromiumdev_profile-*` exists on the host. Unverified: it is also `os.tmpdir()`-based (not located in source).
- Measured: `outputDir` defaults to `<package.json dir>/test-results` and is cleaned at the start of each run ([Playwright outputDir](https://playwright.dev/docs/api/class-testconfig#test-config-output-dir)). Cairn's slot config already puts `outputDir` and `web-dist` under `tmpdir()/cairn-heavy-slot-N` (`scripts/heavy-slots.mjs`), which are two fixed dirs, not a growing class.
- Measured: `PWTEST_CACHE_DIR` already moves the transform cache to disk (`50-disk-caches.conf`).

### 2.3 Why `TMPDIR` needs `CAIRN_HEAVY_SLOTS_DIR` (cairn rule)

- Measured: `scripts/heavy-slots.mjs` `slotLockDir`: `CAIRN_HEAVY_SLOTS_DIR` wins; on non-darwin the default is `join(tmpdir(), 'cairn-heavy-slots')`.
- Measured: `docs/lessons/1703-direct-vitest-skipped-slot.md`: on 2026-10-29 a session set `TMPDIR` without `CAIRN_HEAVY_SLOTS_DIR`, so its runs took slots in a private lock dir beside other lanes' e2e runs, a bypass of the lease. The lesson says "a Linux TMPDIR override is still a bypass".
- Inferred: a global or per-lane `TMPDIR` is safe only when every lane also gets one shared `CAIRN_HEAVY_SLOTS_DIR=/tmp/cairn-heavy-slots`. The lock dir holds a few tiny files, so keeping it on tmpfs costs no RAM, and it stays in `x /tmp/cairn-heavy*` of the age rule.
- Measured: the host already sets `CAIRN_HEAVY_SLOTS=2` in `50-disk-caches.conf` and a comment there says "Do not set TMPDIR here".
- Measured: PR #3601 (open, third review round, P2 on screenshot port isolation) queues every Vitest and Playwright entry through one kernel-flock allocator; its doc says the shared default stays 2 slots and the slot dirs are shared.

### 2.4 Existing cleanup, and why it still leaves GB

- Measured: `~/.config/user-tmpfiles.d/tmp-age.conf` has `e /tmp - - - 2d` plus `x` exclusions. The user timer `systemd-tmpfiles-clean.timer` runs once per day (last run Nov 8 18:07; first run exit 73 because root-owned dirs are unreadable, the drop-in `shared-tmp.conf` accepts exit 73; the second run finished). Next run 2026-11-09 18:08.
- Measured: `~/.cairn/tools/test-temp-guard.mjs` runs every 15 minutes (journal: "deleted 8", "deleted 13" stale entries) with a 120-minute max age, but only for names in `test-temp-policy.json` prefixes (`ct-`, `cairn-test-`, `prefixes: [...]` and so on). Measured: no pattern for 21-character nanoid names, so vitest dirs are outside its scope.
- Measured: the system `q /tmp 1777 root root 10d` rule exists too (`/usr/lib/tmpfiles.d/tmp.conf`); tmpfiles ages by the newest of atime, mtime, ctime ([tmpfiles.d(5)](https://www.freedesktop.org/software/systemd/man/latest/tmpfiles.d.html), local man page read), and takes a BSD lock on live dirs.
- Inferred: a 2-day daily sweep bounds the nanoid pile at about 2-3 days of production (4-6G), which matches the 4.0G of <2d dirs seen. The age rule works; the pile is the intended steady state of a rule that is too slow for a RAM-backed `/tmp`. The systemd docs say `/tmp` is "typically on tmpfs and thus backed by RAM/swap" and should hold "smaller, size-bounded files" ([systemd.io TEMPORARY_DIRECTORIES](https://systemd.io/TEMPORARY_DIRECTORIES/)).
- Measured: Arch wiki Tmpfs page returned an Anubis "Access Denied" to my fetch. Blocked: Arch wiki tmpfs, zram and zswap pages were not read; the kernel and systemd documents below are used instead.

### 2.5 `PrivateTmp` and `systemd-run`

- Measured ([systemd.exec(5)](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html), local man): `PrivateTmp=yes` gives a private namespace and removes the files when the service stops, but "the backing storage of the private temporary directories will remain on the host's /tmp/ and /var/tmp/", i.e. here the same tmpfs. `PrivateTmp=disconnected` is a fresh tmpfs per unit (still RAM, charged to that unit's cgroup). Neither moves bytes to disk.
- Inferred: `systemd-run --scope` makes a `.scope` unit; `PrivateTmp` is an exec setting of services, so a scope gets cgroup limits but no private `/tmp`. A transient service (`systemd-run --user -p PrivateTmp=yes ...`) can. Unverified: it needs unprivileged user namespaces in the user manager; not tested.
- Inferred: the per-lane lifetime with disk backing is better done by `TMPDIR=<disk dir>` created by the launcher plus `rm -rf` on exit, with the disk age rule as the net for SIGKILL.

### 2.6 zram vs zswap on this host

- Measured: Omarchy ships `/usr/share/omarchy/default/systemd/zram-generator.conf.d/90-omarchy.conf` (`zram-size = ram`, zstd, priority 100, comment: "even a full device occupies roughly a third of RAM"), sysctls in `/etc/sysctl.d/99-omarchy-sysctl.conf` (swappiness 150, vfs_cache_pressure 50, page-cluster 0, watermark_scale_factor 125, dirty bytes 64M/256M) and `/etc/tmpfiles.d/omarchy-zswap.conf` (zswap off at boot: "in front of swap-on-zram just double-compresses pages"). Kernel cmdline has `zswap.enabled=0`. `/tmp` is the stock systemd `tmp.mount` (`What=tmpfs`), not an Omarchy choice.
- Measured ([kernel zram doc](https://docs.kernel.org/admin-guide/blockdev/zram.html)): `mem_limit` caps compressed memory; writeback of idle pages needs a backing block device ("a partition") set before `disksize`; zram larger than twice RAM is "wasteful" at 2:1.
- Measured ([kernel zswap doc](https://docs.kernel.org/admin-guide/mm/zswap.html)): zswap compresses into a pool and, when full, evicts LRU pages to the backing swap device; the shrinker (off by default) writes cold pages out proactively; `memory.zswap.writeback` can be cgroup-scoped. The page does not discuss zram.
- Inferred: zram never gives memory back to disk, so cold idle JVMs stay in RAM forever at about one third size; zswap over the existing btrfs swapfile would, but only if zram is removed (double compression otherwise). Unverified: with io PSI some avg300 already 35% on LUKS+btrfs, adding swap-to-disk writeback could hurt more than the 3-4G it frees; test before adopting.
- Inferred: the current zram size (31G nominal) is not the problem; its content is. At the current ratio, a full device would cost about 10.5G RAM.

### 2.7 cgroup limits and systemd-oomd

- Measured ([cgroup-v2](https://docs.kernel.org/admin-guide/cgroup-v2.html)): `memory.high` throttles and reclaims, never OOM-kills; `memory.max` kills inside the cgroup; `memory.low` protects best-effort; `memory.swap.max` hard-limits swap; tmpfs/shmem is charged to the cgroup that instantiated the pages and stays there; `memory.oom.group=1` kills the whole group.
- Measured (local `systemd.resource-control(5)`): `MemoryHigh=`, `MemorySwapMax=`, `ManagedOOMMemoryPressure=`, `ManagedOOMPreference=avoid|omit` (honored for pressure kills when the cgroup owner matches the monitored ancestor's owner).
- Measured (local `systemd-oomd(8)`, `oomctl`): oomd here monitors only `/user.slice/user-1000.slice/user@1000.service/app.slice`, limit 50% for 20s, swap limit 90% (swap used is 40%, so the swap rule is idle). It kills whole child cgroups of `app.slice`.
- Measured (`/proc/<pid>/cgroup`): lanes live inside terminal scopes (`app-graphical.slice/app-Hyprland-xdg-terminal-exec-*.scope`) and `app-com.anthropic.Claude-*.scope`; Claude desktop and every Claude Code session it runs share one scope (10G at 00:52). cairn-daemon is its own user service.
- Inferred: the oomd kill unit is the whole Claude scope, because no per-lane cgroup exists. One memory spike kills all sessions at once. The pressure that caused the kills is mostly reclaim stalls, caused by `app.slice` memory sitting behind swap.
- Inferred: tmpfs pages written by a lane are charged to the cgroup of the writer, not to any Java container, so `/tmp` growth raises the lane's pressure score with `ManagedOOMMemoryPressure` while giving no process that can be killed to free it (oomd kills a cgroup, which does not free shmem unless the files are removed, and files persist after kill). Inferred from the kernel doc plus the unit model.
- Chris Down's "In defence of swap" is the reference `systemd-oomd(8)` itself cites for keeping swap on; I did not fetch it.

### 2.8 Agent tools

- Measured: `claude` keeps state under `/tmp/claude-1000` (142M: `bash-edit-diff` 129M). Unverified: there is a Claude Code env var to relocate it (`CLAUDE_CODE_TMPDIR`); not verified in docs or the installed binary this session.
- Unverified: Codex CLI honors `TMPDIR` through Rust `std::env::temp_dir`; I could not read its source (binary only; the string `TMPDIR` appears in the mise wrapper, not in codex). pi docs (`mise/installs/pi/.../docs`) contain no `TMPDIR` mention (grep empty). Treat both as unverified; they inherit `TMPDIR` from the launcher in any case, since it is an environment variable.
- Measured: 41 repository files contain a literal `'/tmp/` string (grep over apps, packages, scripts, integration). Unverified: most are fixtures, not allocation sites; review before relying on a global `TMPDIR`.

## 3. Comparison of options

| Option | How it works | RAM effect on this host | Trade-offs | Source |
|---|---|---|---|---|
| A. Keep tmpfs, cap it (`size=4G`) | `tmp.mount` drop-in or fstab option | Ceiling of 4G logical; ENOSPC instead of RAM growth | Lanes fail with ENOSPC mid-run; needs sudo; does not remove leaks | systemd.io TEMPORARY_DIRECTORIES (programs must handle ENOSPC) |
| B. `/tmp` on disk (mask `tmp.mount`) | root fs btrfs, zstd | All of `/tmp` leaves RAM (~3-5G incl. swapped) | Disk wear and 86%-full root (131G free); page cache still absorbs hot writes; sockets and other consumers change; needs sudo and a reboot or remount; a systemd statement that /tmp is RAM-backed by design | systemd.io, `tmp.mount` read on host |
| C. `TMPDIR` on disk for lanes only (`~/.cache/lane-tmp`) plus `CAIRN_HEAVY_SLOTS_DIR=/tmp/cairn-heavy-slots` | Env in `environment.d` and the lane launcher | Removes the vitest and Playwright and agent-scratch classes (nearly all of the 4.9G + 1.9G logical) | Needs the lease dir pinned (AGENTS.md rule); no sudo; hard-coded `/tmp` literals still go to tmpfs; Java/docker unaffected | Node os.tmpdir; vitest source; heavy-slots.mjs |
| D. Per-run root under `test-temp-run.mjs` with `TMPDIR=root` for the child | Supervisor already tracks and deletes its root; vitest dirs would land inside it | Removes the leak at its source even if root stays on tmpfs; deletes on exit including SIGINT/SIGTERM | SIGKILL of the supervisor still leaks (disk root plus age rule covers it); the supervisor is not wired into the Vitest entry points (grep: only tests and `orb-trial-report.yml` mention it) | `scripts/test-temp-run.mjs`, `scripts/test-tmpdir.mjs` |
| E. Faster age cleanup (`e /tmp - - - 6h` for nanoid names only) | tmpfiles glob plus a timer every 15 min | Bounds the pile to ~6h of production (about 0.5-1G) | Live runs older than 6h lose dirs (multi-hour e2e); tmpfiles ages by atime/mtime/ctime so active dirs are mostly safe Unverified; user timer is daily now | tmpfiles.d(5) |
| F. `PrivateTmp=yes` units per lane | namespace plus cleanup at stop | None (backing store is host `/tmp`); disconnected tmpfs is still RAM | Guaranteed cleanup only | systemd.exec(5) |
| G. `MemoryHigh`, `MemorySwapMax` per lane scope (`systemd-run --user --scope`) | cgroup v2 | Caps one lane's anon plus shmem; shifts reclaim to the offender | No private `/tmp`; a too-low `MemoryHigh` slows the lane without killing it (cgroup-v2 doc); sizing needs measurements I do not have | cgroup-v2; resource-control(5) |
| H. systemd-oomd tuning (`ManagedOOMPreference=avoid` on cairn-daemon and the control plane; lane scopes as the kill candidates) | xattr on cgroup | No GB, but kills hit one lane instead of the Claude scope | `avoid` only counts when the cgroup owner matches; needs per-lane scopes first | systemd-oomd(8), resource-control(5) |
| I. zswap over the swapfile, no zram | kernel param change | Frees 3-4G of cold JVM memory to disk | I/O PSI already 35%; Omarchy turned zswap off on purpose; reboot | kernel zswap doc; Omarchy tmpfiles comment |
| J. Reduce the side stack (docker memory caps, stop idle compose projects, JVM `-Xmx`) | `docker update --memory`, `docker compose stop`, JVM flags | Largest single block (below) | It is ian's own project and needs his decision | `docker stats`, `ps` |
| K. Heavy-slot lease (#3601) | 2 shared slots for every Vitest/Playwright start | Bounds peak simultaneous test memory and load (107-113 spikes) | Does not touch resident leftovers; the PR is unmerged and not green | PR #3601 body |

Interaction with #3601 (Inferred): the lease limits how many test processes exist; it neither places nor cleans their temp files. Options C and D change only `TMPDIR`; the lock directory must stay at `CAIRN_HEAVY_SLOTS_DIR`, and the PR's slot dirs (`cairn-heavy-slot-N`, built from `tmpdir()`) would move to disk with `TMPDIR`, which is wanted (about 2 small trees). A test in #3601's family should assert that with `TMPDIR` overridden the lock dir stays shared; `scripts/heavy-slots.test.mjs` already covers an overridden `TMPDIR` for the lease.

## 4. Ranking of root causes by GB (RAM-equivalent, now)

Conversion: zram ratio 2.95 (Measured), so a swapped logical GB costs about 0.34 GB of RAM. All sums below are Inferred.

| Rank | Cause | Logical size | RAM cost now |
|---|---|---|---|
| 1 | ian's docker Java/mysql side stack (17 containers `measure-community`) | 4.5G resident total in docker (all 27) plus 10.1G swapped | ~4.5G resident + ~3.4G zram = ~7.9G (the langfuse 8 are a share of the 4.5G, ~1.4G Measured sum of the cairn-langfuse rows is not measured; I read only the top rows) |
| 2 | `/tmp` tmpfs | 8.7G (13G earlier) | 0.4G resident + ~2.8G zram = ~3.2G now; ~4.5G at 13G |
| 3 | Lane processes (pi 978M, node 496M, claude 614M, claude-desktop 1.1G, plus Chromium 1.4G) | 4.6G RSS plus 2.2G swapped | ~5.3G; this is real agent work, not leftovers |
| 4 | Burst: simultaneous vitest/Playwright workers when 5+ lanes start tests (load 107-113) | not measured | Unverified: several GB for minutes; only visible as pressure spikes |
| 5 | Page cache plus slab | 8-11.6G plus 3.5G | reclaimable, not an agent loss Measured (`available` 9.6-12G) |

## 5. Recommendation, ordered by impact

Expected GB are RAM-equivalents (Inferred unless noted). Host-config items need sudo and ian's OK; repository items follow AGENTS.md (red-first tests, no comments, `pnpm prepush`).

1. Shrink or stop ian's Java/docker side stack (about 4-8G). Host or ian's project, no repo change: `docker stats --no-stream` to pick containers; `docker compose -p measure-community stop` when not in use, or `docker update --memory 400m --memory-swap 400m <name>`; lower seata `-Xms2048m` to `-Xms256m`. Needs ian's decision (his project). If it must stay up, a `MemoryHigh` on the docker scopes is the fallback (cgroup-v2 doc).
2. Put lane temp on disk with the lease dir pinned (about 3-5G, ends the growth). Repository: a lane launcher (`scripts/ops/` systemd units and the lane wrapper) exports `TMPDIR=$HOME/.cache/lane-tmp/<lane>` and `CAIRN_HEAVY_SLOTS_DIR=/tmp/cairn-heavy-slots` together, creates the dir, and removes it at exit. Test first (red on today's code): launching a child with only `TMPDIR` set makes `slotLockDir` resolve to a private dir (this is lesson 1703). Host, no sudo: add both variables to `~/.config/environment.d/50-disk-caches.conf` (and edit its "Do not set TMPDIR" comment), extend `~/.config/user-tmpfiles.d/tmp-age.conf` with `e %h/.cache/lane-tmp - - - 2d`, and add `~/.cache/lane-tmp` to `roots` in `~/.cairn/tools/test-temp-guard.mjs`. Check the 41 `'/tmp/` literals before rollout; keep `cairn-daemon`'s `UnsetEnvironment=TMPDIR` drop-in consistent.
3. Wire the existing supervisor into every Vitest and Playwright entry and give it `TMPDIR` (about 2-5G of nanoid leftovers per day removed at the source). Repository: `scripts/test-temp-run.mjs` spawns the child with `TMPDIR: root` (and `CAIRN_HEAVY_SLOTS_DIR` computed with `slotLockDir` before the override), then `package.json` scripts and `scripts/prepush-vitest.mjs`, `scripts/heavy-slots.mjs` wrappers call it. Red test: run vitest in a killed child and assert no `/tmp/<nanoid>/ssr` survives under `CAIRN_TEST_TEMP_ROOT` after the supervisor exits. Land it after #3601 merges to avoid editing the same admission code; touch `vitest.config.ts` only if the supervisor cannot be the single entry (single path rule: one entry, delete direct calls).
4. Make cleanup match a RAM-adjacent `/tmp` (about 1-3G steady-state saving, host, no sudo). Add a nanoid pattern to the 15-minute guard: in `~/.cairn/tools/test-temp-policy.json` support a regex or glob `^[A-Za-z0-9_-]{21}$` with a 6-hour age, or a `systemd --user` timer with `systemd-tmpfiles --user --clean` every 30 minutes and an `e /tmp/<glob> - - - 6h`. Keep the `x` exclusions. This is also the safety net for hard-coded `/tmp` writers after step 2. If the guard lives in the repo (it is installed from `scripts/ops/` or `~/.cairn/tools/`; not checked), change the source and reinstall.
5. Give lanes their own cgroup and a budget (protects the work more than it frees RAM; 0-2G; cuts the blast radius from 10G of Claude sessions to one lane). Repository: the lane launcher runs each lane under `systemd-run --user --scope -p MemoryHigh=<size> -p MemorySwapMax=<size> -p ManagedOOMPreference=...` and the lane scope name carries the ticket. Sizes need measurement first: collect `memory.peak` per lane for a week (`cat /sys/fs/cgroup/.../memory.peak`) rather than guess. Host, sudo-free: `ManagedOOMPreference=avoid` drop-ins on `cairn-daemon.service` and the control plane user units. Do not turn on `/tmp` size caps (option A) before step 2, because a hard-coded writer would fail mid-run.

Deferred or rejected:
- Moving all of `/tmp` to disk (option B): not needed once steps 2-4 land; needs sudo, a reboot, and 131G free on an 86%-full root. Revisit if hard-coded writers still exceed 3G after a week. Unverified.
- zswap instead of zram (option I): not recommended; Omarchy disabled it on purpose and I/O pressure is already high. Revisit only with a measured I/O benchmark.
- `PrivateTmp` per lane (option F): no RAM benefit on this host (backing store is host `/tmp`).
- Resizing zram: current size is not the cause; a `mem_limit` would turn compressed-memory exhaustion into swapfile traffic. Leave `zram-size = ram`.

Open measurements before steps 3 and 5: (a) how many of the 41 `'/tmp/` literals allocate; (b) per-lane `memory.peak`; (c) the cairn-langfuse share of docker memory; (d) whether Codex CLI and pi honor `TMPDIR` (verify by running one with `TMPDIR` set and listing the dir); (e) why this host's `systemd-tmpfiles-clean` ran only twice in the window I could read (the journal window was short).

## Sources

- systemd: [TEMPORARY_DIRECTORIES](https://systemd.io/TEMPORARY_DIRECTORIES/), [tmpfiles.d(5)](https://www.freedesktop.org/software/systemd/man/latest/tmpfiles.d.html), [systemd.exec(5)](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html), [systemd.resource-control(5)](https://www.freedesktop.org/software/systemd/man/latest/systemd.resource-control.html), [systemd-oomd(8)](https://www.freedesktop.org/software/systemd/man/latest/systemd-oomd.service.html), [systemd-run(1)](https://www.freedesktop.org/software/systemd/man/latest/systemd-run.html); the man pages were read from the host's systemd 262.1 install.
- Kernel: [zram](https://docs.kernel.org/admin-guide/blockdev/zram.html), [zswap](https://docs.kernel.org/admin-guide/mm/zswap.html), [cgroup v2](https://docs.kernel.org/admin-guide/cgroup-v2.html) (read the first 100000 characters; the PSI section was not read).
- Node: [os.tmpdir](https://nodejs.org/api/os.html#ostmpdir). Playwright: [outputDir](https://playwright.dev/docs/api/class-testconfig#test-config-output-dir) and installed `playwright-core@1.63.0/lib/coreBundle.js`. Vitest: installed `vitest@5.0.1` source.
- Omarchy: `/usr/share/omarchy/default/systemd/zram-generator.conf.d/90-omarchy.conf`, `/etc/sysctl.d/99-omarchy-sysctl.conf`, `/etc/tmpfiles.d/omarchy-zswap.conf` on the host (its GitHub repo was not opened).
- Cairn: `AGENTS.md` (TMPDIR rule), `scripts/heavy-slots.mjs`, `scripts/test-temp-run.mjs`, `scripts/test-tmpdir.mjs`, `docs/lessons/1703-direct-vitest-skipped-slot.md`, PR #3601.
- Blocked: Arch wiki (Tmpfs, Zram, Zswap, OOM) returned "Access Denied" (Anubis); not read. Not read: Codex CLI source, pi source for `TMPDIR`, kernel PSI document, Claude Code docs for its temp dir.

## 6. Implementation follow-up (#3630)

Design: [disk-backed temporary work](../design/3630-disk-temp.md). PR number pending creation.

The original recommendation 2/4 scope is unchanged. Recommendation 3 (rewiring every test admission path) is deferred; PR #3601 remains open at the follow-up check. This change must not modify its heavy-slot allocator, admission configs or cairn-heavy wrapper before it merges.
# Installed agent temp-root checks (2026-11-09)

No model request was sent. No live Cairn request was made. Agent state and XDG directories were isolated in the lane scratch tree; both temp overrides included `CAIRN_HEAVY_SLOTS_DIR=/tmp/cairn-heavy-slots`.

| Tool/source | First-hand observation | Interpretation and limit |
|---|---|---|
| Codex CLI 0.167.0, installed `/home/ian/.local/share/mise/installs/codex/0.167.0/bin/codex` | Measured: running `--version` with TMPDIR set to the scratch `research/codex-temp` and CODEX_HOME set beneath it prints `Refusing to create helper binaries under temporary dir` followed by exactly the overridden root, then `codex-cli 0.167.0`; exit 0. | Measured: the installed Rust runtime resolves its system temp root from TMPDIR. This is not a complete session/temp-writer exercise. |
| Codex source at `rust-v0.167.0` | Measured: `codex-rs/arg0/src/lib.rs:326` computes `std::env::temp_dir()`; lines 349-368 instead place dispatch-helper dirs under CODEX_HOME using `tempdir_in`. | Inferred: setting TMPDIR redirects system-temp users, but does not relocate CODEX_HOME-owned helpers/state; the actual version command distinguishes these roots. |
| pi 1.5.0, installed standalone Bun ELF | Measured: isolated offline RPC startup loaded an explicit extension, called Node-compatible `os.tmpdir()` then `fs.mkdtempSync(join(tmpdir(), "pi-tmpdir-probe-"))`, and wrote `research/pi-temp/pi-tmpdir-probe-AtXIL4/observed.json`. Printed tmpdir exactly matched TMPDIR; exit 0. | Measured: the installed pi process's temp API honors TMPDIR. The allocation was a probe extension, not a model-directed built-in tool. |
| pi 1.5.0 embedded bundle (`strings` of the installed ELF) | Measured: the embedded os shim computes `env.TMPDIR || env.TMP || env.TEMP || "/tmp"`; `dist/utils/output-files.js` imports `tmpdir` from `os`, and `createOutputFilePath` joins it with the requested prefix. The bash output spill path uses `createOutputFileStream("pi-bash", ".log")`. Editor, share and clipboard paths also call os.tmpdir. | Inferred: these pi temp allocations follow TMPDIR, supported by the real binary's runtime probe. |
| pi persistent extension install temp | Measured: installed CHANGELOG says temporary extension installs use private `~/.pi/agent/tmp/extensions` with 0700 rather than os.tmpdir()/pi-extensions. | Measured: not every pi directory is system temp; agent state must remain separately managed. |

Source: https://github.com/openai/codex/blob/rust-v0.167.0/codex-rs/arg0/src/lib.rs

pi source owner: https://github.com/earendil-works/pi ; installed package.json reports `@earendil-works/pi-coding-agent` 1.5.0 and repository directory `packages/coding-agent`. Embedded source identifiers above are from the installed binary, not an unpinned online branch.

## Repro commands

Codex: create the scratch temp root and its home subdirectory, set TMPDIR to the root and CODEX_HOME to its home subdirectory, set CAIRN_HEAVY_SLOTS_DIR to the shared lock root, then invoke the absolute binary with `--version`.

pi: set TMPDIR to scratch research/pi-temp, PI_CODING_AGENT_DIR to scratch pi-agent, PI_OFFLINE=1 and PI_TELEMETRY=0; isolate all XDG directories; run the absolute binary with `--offline --no-session --no-extensions --no-mcp --no-skills --no-prompt-templates --no-themes --no-context-files --no-approve -e <scratch>/research/pi-temp-probe.ts --mode rpc` and empty stdin. The explicit extension runs only on session_start, creates the probe dir, records its path, then calls ctx.shutdown().

## Probe scope

Not covered: actual model sessions, all Codex temp writers, pi built-in bash spill execution, external agent-written hard-coded /tmp paths. No conclusion that TMPDIR redirects intentional state directories.

### Literal-path audit

Measured: `rg -l "'/tmp/" apps packages scripts integration` on the branch found 46 files (the earlier research counted 41). This is a source audit, not a runtime claim. Broader `/tmp/` matching also found lane prompt producers/readers; those migrate together. Shared heavy-slot locks and X11/container paths remain fixed.

| File | Decision |
|---|---|
| `integration/test/web-search-pi-e2e.test.ts` | Allocates a persistent evidence directory; move under the owned integration temp home. |
| `packages/shared/test/test-tmp-ratchet.test.ts` | Fixture, expected error, fake path or input string; no actual directory allocated at the literal path. Retain. |
| `packages/shared/test/restart-prompt.test.ts` | Fixture, expected error, fake path or input string; no actual directory allocated at the literal path. Retain. |
| `integration/test/plan-revision.test.ts` | Fixture, expected error, fake path or input string; no actual directory allocated at the literal path. Retain. |
| `packages/shared/test/permission-rules.test.ts` | Fixture, expected error, fake path or input string; no actual directory allocated at the literal path. Retain. |
| `scripts/dispatch-dedupe.test.mjs` | Fixture, expected error, fake path or input string; no actual directory allocated at the literal path. Retain. |
| `packages/shared/test/computer-screen-protocol.test.ts` | Fixture, expected error, fake path or input string; no actual directory allocated at the literal path. Retain. |
| `apps/web/test/slash-commands.test.ts` | Fixture, expected error, fake path or input string; no actual directory allocated at the literal path. Retain. |
| `scripts/ops/host/as-bot.test.mjs` | Fixture, expected error, fake path or input string; no actual directory allocated at the literal path. Retain. |
| `scripts/ops/host/tools/weekly/memory-regression.sh` | Tiny model-list file, no directory allocation; keep outside this directory-allocation change. |
| `scripts/ops/host/tools/weekly/learn-eval.sh` | Tiny model-list file, no directory allocation; keep outside this directory-allocation change. |
| `apps/daemon/test/workspace-source.test.ts` | Fixture, expected error, fake path or input string; no actual directory allocated at the literal path. Retain. |
| `apps/daemon/test/skills-worktree.test.ts` | Fixture, expected error, fake path or input string; no actual directory allocated at the literal path. Retain. |
| `apps/daemon/test/skill-tool.test.ts` | Allocates /tmp/test-skill; replace with the existing owned testTempDir helper. |
| `apps/web/e2e/skill-import.spec.ts` | Fixture, expected error, fake path or input string; no actual directory allocated at the literal path. Retain. |
| `integration/eval/chief-dispatch/wire-tap.mts` | Tiny fixed JSONL diagnostic output, protected eval surface; retain. |
| `apps/daemon/test/runner-review.test.ts` | Fixture, expected error, fake path or input string; no actual directory allocated at the literal path. Retain. |
| `apps/web/e2e/sidebar-elapsed.spec.ts` | Writes screenshot files; use Playwright testInfo.outputPath. |
| `apps/daemon/test/runner-local.test.ts` | Fixture, expected error, fake path or input string; no actual directory allocated at the literal path. Retain. |
| `apps/daemon/test/runner-cred-fallback.test.ts` | Fixture, expected error, fake path or input string; no actual directory allocated at the literal path. Retain. |
| `apps/server/test/thread-schedule-tool.test.ts` | Fixture, expected error, fake path or input string; no actual directory allocated at the literal path. Retain. |
| `apps/server/test/computer-screen-routes.test.ts` | Fixture, expected error, fake path or input string; no actual directory allocated at the literal path. Retain. |
| `apps/server/test/computer-private-audience.test.ts` | Fixture, expected error, fake path or input string; no actual directory allocated at the literal path. Retain. |
| `apps/web/e2e/project-new-repo.spec.ts` | Fixture, expected error, fake path or input string; no actual directory allocated at the literal path. Retain. |
| `apps/web/e2e/project-new-fs-pick.spec.ts` | Fixture, expected error, fake path or input string; no actual directory allocated at the literal path. Retain. |
| `apps/daemon/test/orb-services-ensure.test.ts` | Fixture, expected error, fake path or input string; no actual directory allocated at the literal path. Retain. |
| `apps/web/e2e/chief-home-header-width.spec.ts` | Writes a screenshot file; use Playwright testInfo.outputPath. |
| `apps/web/e2e/project-github-issues.spec.ts` | Fixture, expected error, fake path or input string; no actual directory allocated at the literal path. Retain. |
| `apps/server/test/steer.test.ts` | Fixture, expected error, fake path or input string; no actual directory allocated at the literal path. Retain. |
| `apps/daemon/test/orb-e2b.test.ts` | Fixture, expected error, fake path or input string; no actual directory allocated at the literal path. Retain. |
| `apps/web/e2e/probe-1011.mjs` | Allocates a screenshot/evidence directory; default to ~/.cache/cairn-evidence/1011. |
| `apps/server/test/github-repo-dot-segments.test.ts` | Fixture, expected error, fake path or input string; no actual directory allocated at the literal path. Retain. |
| `apps/web/e2e/probe-1011-attr.mjs` | Allocates a screenshot/evidence directory; use the same ~/.cache/cairn-evidence/1011 root. |
| `apps/daemon/src/computer/guard-quoted.ts` | Literal X11/protected-path protocol detection, not allocation; retain. |
| `apps/server/test/skill-import.test.ts` | Fixture, expected error, fake path or input string; no actual directory allocated at the literal path. Retain. |
| `apps/daemon/test/computer-guard-rakazo.test.ts` | Fixture, expected error, fake path or input string; no actual directory allocated at the literal path. Retain. |
| `apps/server/test/schedule-continue.test.ts` | Fixture, expected error, fake path or input string; no actual directory allocated at the literal path. Retain. |
| `apps/daemon/test/git.test.ts` | Fixture, expected error, fake path or input string; no actual directory allocated at the literal path. Retain. |
| `apps/web/e2e/make-indent-compare-1011.mjs` | Reads and writes the probe directory; migrate with its producers. |
| `apps/daemon/test/claude-session-env.test.ts` | Fixture, expected error, fake path or input string; no actual directory allocated at the literal path. Retain. |
| `apps/daemon/test/claude-scrub-permissions.test.ts` | Fixture, expected error, fake path or input string; no actual directory allocated at the literal path. Retain. |
| `apps/daemon/test/claude-mcp-strict.test.ts` | Fixture, expected error, fake path or input string; no actual directory allocated at the literal path. Retain. |
| `apps/daemon/test/config-state.test.ts` | Fixture, expected error, fake path or input string; no actual directory allocated at the literal path. Retain. |
| `apps/web/e2e/composer-slash.spec.ts` | Fixture, expected error, fake path or input string; no actual directory allocated at the literal path. Retain. |
| `apps/daemon/test/computer-orb.test.ts` | Fixture, expected error, fake path or input string; no actual directory allocated at the literal path. Retain. |
| `apps/server/test/project-dual-source.test.ts` | Fixture, expected error, fake path or input string; no actual directory allocated at the literal path. Retain. |
