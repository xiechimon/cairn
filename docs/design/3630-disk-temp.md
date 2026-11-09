# Disk-backed temporary work (#3630)

Research: docs/research/host-memory-for-agents-2026-11-09.md, recommendations 2 and 4. No wire protocol, database or product state changes.

## Paths and failure modes

| Entry | Transition | Expected behavior / negative control |
|---|---|---|
| Lane run-worker | create private disk root, export paired env, run, exit cleanup | TMPDIR under HOME/.cache/lane-tmp; shared heavy lock stays /tmp/cairn-heavy-slots; child exit preserved; mkdir failure stops before child |
| Daemon stepEnv | create private disk root before session, remove after step | all create/continue backends receive same env; normal and failed steps clean up; explicit shared slot override retained |
| test-temp-run | create private supervised disk root, spawn with paired env, reclaim | raw os.tmpdir allocations land in owned run root; explicit test root retained; survivors fail and are removed |
| Guard | select known prefix or 21-character nanoid with real ssr directory, age check, inspect process references, delete | nanoid cutoff strictly older than 6h; no symlinks; owner only; active cwd/fd kept; inaccessible same-user process scans keep candidates; no recursive search through kept entries |
| Host env and age | proposed files only | paired global default; daemon must not unset just TMPDIR; no unsafe tmpfiles deletion of active lane trees |

SIGKILL can leave private roots; guard reclaims stale ct-/lane-/step- roots using the same live-process check. Each private root keeps a private regular lease file open inside its runtime directory until cleanup, protecting even idle runs. Close the lease before deleting the tree so Windows can remove it. Execute every daemon credential, timer, session-map and stop cleanup independently; aggregate errors only after all have run. Scan observes /proc cwd, fd and memory-mapped files for same-user processes; unreadable scans fail closed. Check references again immediately before deletion. It cannot atomically exclude a process acquiring a new reference after that check; this is a conservative age sweep, not a kernel lease protocol.

## Decisions

Use one shared environment constructor for paired defaults, consumed by test supervision, daemon and launcher CLI. Pin Linux lease directory to /tmp/cairn-heavy-slots and use the existing Darwin getconf convention. Preserve the shared heavy-slot admission established by merged PR #3601. Only files truly allocating temp work migrate; fixtures, protocol paths, container paths and fixed tiny coordination locks remain. Host files stay in scratch for the owner to apply.

## 6. Delivery

Implementation: current Codex session. Review: head-bound Codex cloud review. PR: [#3638](https://github.com/xiechimon/cairn/pull/3638). Coordinator design review approved in chat on 2026-11-09. No live Coordinator writes are authorized. The owner added a configurable 5 GiB cap: measure logical file bytes in lane-tmp, delete oldest owned non-live roots until under budget, and warn when live or protected content prevents reaching it. The cap runs independently of the age threshold. Symlinks are counted without traversing them; filesystem metadata is outside the logical-byte budget.

Runtime layout: each private root owns a `tmp` child for TMPDIR; CAIRN_TEST_TEMP_ROOT points at the root for strictly tracked helper allocations. Nested runs inherit ownership below that runtime child, so a killed daemon and framework caches are reclaimed with the supervisor without being misreported as helper leaks. Helper leaks and unknown entries beside `tmp` remain failures. Process tests inspect real self/child `/proc` entries through a scoped view, while a separate inaccessible-process test proves conservative retention; production still scans every same-user process.

Forward CAIRN_RUNTIME_TEMP_ROOT together with CAIRN_TEST_TEMP_ROOT when passing a step environment to children. This ownership metadata preserves the validated parent runtime subtree when a task overrides TMPDIR, so interrupted child runtimes remain reclaimable by their supervisor. Use a directory in place of maps for inspection-failure fixtures: reading it fails even when permission bits are bypassed.
