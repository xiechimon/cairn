# #1908 — heavy-slot ports: e2e-affected takes its slot, port squatters get named

Issue: `scripts/e2e-affected.mjs` defaulted to slot 1's port (8398); an orphaned
`vite preview` from a killed run squatted a slot port and later pre-pushes on
that slot failed with a bare port-in-use error that named nobody (2026-10-27:
one held 8398 for over an hour and broke a push).

## What changed

- `scripts/heavy-slots.mjs`: `slotPortHolder(port)` resolves the listening
  process (`lsof`, `ss` fallback) plus its command (`ps`) and cwd
  (`/proc/<pid>/cwd`, `lsof` fallback); `slotPortReport({ slot, env })` formats
  the `[heavy-slots] slot N's port P is held by pid …, cwd …, command …` line.
- `scripts/e2e-affected.mjs`: after acquiring its lease, before spawning
  playwright, it fails with that report when the leased slot's port is held —
  standalone runs bind only the port of the slot they acquired and release the
  slot on exit (that part came with #1634; this lane pins it with a test).
- `scripts/prepush.mjs`: right after acquiring the lease, when the plan contains
  the `e2e:affected` step, the same check fails the push in seconds instead of
  minutes, before any plan step runs.
- Tests in `scripts/heavy-slots.test.mjs` run in a sandbox whose
  `E2E_AFFECTED_PORT` base and `TMPDIR` are isolated, so they never touch the
  real slot ports 8398-8459.

## Evidence

- `red.log` — the new tests against unmodified main: the module fails to load,
  `heavy-slots.mjs` does not provide `slotPortHolder` yet.
- `green.log` — `node --test scripts/heavy-slots.test.mjs` after the change:
  22/22 pass, including:
  - `slotPortHolder names the pid, cwd and command of whatever listens on the port`
  - `e2e:affected outside prepush uses only the port of the slot it acquired and releases it on exit`
  - `a squatted slot port fails e2e:affected before playwright and names the holding process`
  - `prepush reports a squatted slot port before running any check`
- `live-holder.txt` — real-machine artifact: a live listener on a port
  (28778, chosen outside the slot range so no lane is disturbed) is reported
  with pid, cwd and full command; the free neighbor port reports `null`.
- `live-collision.log` — real prepush run that hit a live lane's e2e on slot
  1's port minutes after the change landed: it failed in seconds naming pid,
  cwd and command instead of minutes later with a bare port-in-use error.
  During the task the incident class was live once more: pid 2870471
  (`vite preview … --port 8398 --strictPort`, cwd `/mnt/fast/lanes/cairn-1682/apps/web`)
  held slot 1's port; it exited before the scripted capture ran.
- `gates.log` — comment-discipline gate, single-use-helper gate and
  prepush-vitest results for this branch.
- `prepush.log` — full `pnpm prepush` output (run under the heavy-check lock).

## Acceptance

- e2e-affected never binds a slot port it did not acquire — pinned by the
  "uses only the port of the slot it acquired" test (slot 1 held by another
  process, the run gets slot 2's port, fake `pnpm` records `E2E_PORT` and the
  generated slot config carries slot 2's baseURL and build dir).
- Port-in-use failures name the holding process — pinned by the e2e-affected and
  prepush squatter tests (pid + cwd asserted against the live squatter child)
  and by `live-holder.txt`.
