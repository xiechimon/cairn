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

SIGKILL can leave private roots; guard reclaims stale ct-/lane-/step- roots using the same live-process check. Each private root keeps an open directory descriptor until cleanup, protecting even idle runs. Scan observes /proc cwd, fd and memory-mapped files for same-user processes; unreadable scans fail closed. Check references again immediately before deletion. It cannot atomically exclude a process acquiring a new reference after that check; this is a conservative age sweep, not a kernel lease protocol.

## Decisions

Use one shared environment constructor for paired defaults, consumed by test supervision, daemon and launcher CLI. Pin Linux lease directory to /tmp/cairn-heavy-slots and use the existing Darwin getconf convention. Do not change heavy-slot admission while #3601 is open. Only files truly allocating temp work migrate; fixtures, protocol paths, container paths and fixed tiny coordination locks remain. Host files stay in scratch for the owner to apply.

## 6. Delivery

Implementation: current Codex session. Review: head-bound Codex cloud review. PR number pending creation; update this section in the proposed PR body after creation. Coordinator design review approved in chat on 2026-11-09. No live Coordinator writes are authorized. The owner added a configurable 5 GiB cap: measure logical file bytes in lane-tmp, delete oldest non-live managed roots until under budget, and warn when live or unmanaged content prevents reaching it. The cap runs independently of the age threshold. Symlinks are counted without traversing them; filesystem metadata is outside the logical-byte budget.
