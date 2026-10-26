# #1012 sealed freeze evidence (#980 map terminal ticket)

The sealed tree = this PR branch (baseline main `e87186d3`, sha-identical to origin/main at kickoff).
This ticket is the audit ledger, not the build face: the tree changes only three annotation spots (`ci.yml` two gate comments,
the `ui-debt-gate.mjs` header comment) + this evidence directory, zero behavior change.

## ⚠️ Freeze state: provisional (coordinator instruction, 2026-10-09)

- **#1011 (#883 model picker re-review) is still OPEN, its verdict being measured by the parallel lane t-0261.**
  This ticket's "all subtickets closed" conclusion is **backfilled after #1011 closes** — no reading in this directory claims all subtickets are closed.
- **Merge gate: this PR does not merge before #1011 closes** (the merge right is the coordinator's).
- **The probe baseline (`probe-sealed/`) is archived first, not finalized**: if #1011 is judged
  "not self-resolved → re-cut a fix ticket", the fix landing changes the render face and the baseline must be re-cut after that;
  whether to rerun is the coordinator's call. If judged "self-resolved" (zero code change), this baseline becomes final.

## Directory

| Path | Content |
| --- | --- |
| `audit-sealed.sh` / `audit-sealed.txt` | in-tree audit rerun script (`bash docs/verify/1012/audit-sealed.sh`, rc=0 all pass) + this run's output: five gates PASS, ledger final counts, debt baseline floor, canonical annotations, gate verdicts landed in CI, handwritten shell retired face |
| `e2e-full.log` | full e2e freeze rerun raw log: **862 passed / 0 failed (5.3m)**, E2E_PORT 8399 (lsof-verified unoccupied before start), tree `e87186d3` |
| `probe-sealed/` | **the new baseline (provisional)** = run-4 full archive (`probe-comparison.md` + `probe-dump.json` + `probe-records.ndjson` + `probe-run.log`) — replaces `docs/verify/953/probe-sealed/` as the subsequent three-way diff baseline (the baseline is a convention, not a code pointer: the old-baseline column is taken from the spec's inline expected values, swapping the baseline is zero code change) |
| `flake-attribution/` | the four-round probe runs' full non-green reading attribution archive (see the "run ledger" below) |
| `gates.txt` | the five-gates single-round full output (registry / debt / drift / consumer-shape / dead-class, all PASS rc=0) |

## Ticket five-item reconciliation

### 1. Full e2e + probe freeze

**Full e2e green in one local pass**: 862/862 (5.3m, `e2e-full.log`), the same figure as the wave-1 close-out 862/862.

**The probe freeze = run-4** (port 8400, tree `e87186d3`): visual **894 rows — KEPT 894 / DRIFT 0 /
VIOLATION 0 / NOT-RUN 0** — the baseline only carries canonical values, zero flake values mixed in. tests ledger 861/1,
the only red = `provider-oauth.spec.ts:99` (`page.waitForLoadState` 30s timeout, load-flake signature),
that spec contributes no visual rows (NOT-RUN 0 proves full coverage), same-tree isolated rerun **7/7 green**
(`flake-attribution/rerun-provider-oauth.log`).

Four-round run ledger (same tree, all attribution archives in `flake-attribution/`):

| Round | port | tests | visual rows | Disposition |
| --- | --- | --- | --- | --- |
| run-1 | 8397 | 861/1 (page-scroll 5s visible timeout) | 891: KEPT 891 / 0 DRIFT / 0 VIOLATION / 0 NOT-RUN | the red attributed to flake (isolated rerun 5/5 green ×2); artifacts overwritten by run-2, only the log + summary header survive |
| run-2 | 8400 | 856/6 (4× 30s timeout + board-dnd frame sampling + fs-pick count) | 894: 892 KEPT / **1 DRIFT** | **voided** — polluted by this thread's own concurrent work (spec:parse's tsc + playwright --list ran alongside the probe), duration inflated 7.7m→12.7m; artifacts kept in `run2-contended/` for attribution |
| run-3 | 8400 | 861/1 (board-dnd:844 frame sampling t=8ms) | 894: 893 KEPT / **1 DRIFT** | the DRIFT row = the same board-dnd assertion, **harness race, not visual drift** (analysis below); the log kept in `run3/` |
| **run-4** | 8400 | 861/1 (provider-oauth load timeout, isolated 7/7 green) | **894: KEPT 894 / 0 / 0 / 0** | **archived as the new baseline** |

**board-dnd:844 race analysis (the sole DRIFT source in run-2/run-3)**: the test seeds the rAF frame sampler into the page before `mouse.up()`
(`t0` = the evaluate moment). After instrumentation (the probe preload records every
evaluate) lengthens the Playwright client round-trip, the first sampled frame can land **before** mouse.up dispatches —
the t=8ms `col:todo` frame is the pre-commit "commit not yet happened" state, not the "post-commit flash-back to the source column" that the #398 rule catches.
Criteria: the same-tree non-instrumented full e2e green (862/0), run-1 green under instrumentation too, the failing frame is always the first frame (t≤11ms).
No product-face regression. **Follow-up suggestion (the coordinator's call, not smuggled into this audit ticket)**: give that spec's sampler a
"drop the frame before mouse-up dispatch" guard or seed the sampler after up; the same-family precedent = #398 (the same spec's
high-load flake ticket).

### 2. Hash ledger final review (#989 gate face)

`ui-registry-gate` PASS, **reconciliation zero drift** (in-tree comparison, not refresh — this ticket does not run
`ui-registry-refresh.mjs`, ledger zero change):

- **Final count = 33 files = 26 registry (19 pristine / 7 registered deviations) + 7 adapters**;
  vendored snapshot shadcn@4.21.3 (fetched 2026-10-08); the ledger frozen from `a0659279`.
- The seven adapters (the #983-verdict zero-skin adaptation layer): `alert-dialog-shell` `dialog-shell` `panel`
  `seeded-avatar` `status-chip` `tag-chip` `toaster`.
- **Criterion annotation**: the task book's "30 items = 14 pristine / 7 deviated / 9 adapters" is the #1003 refresh-time ledger;
  the wave-1 / wave-2 tickets re-froze the ledger in their own PRs per the #989 discipline (select retired into pristine, chat primitives and
  tooltip etc. registered, the handwritten shell retired out of the ledger); the freeze-time authoritative ledger = the 33-file final count above.

### 3. #980 closure map audit

- **Decisions so far, one row per closed ticket**: the audit found 7 closed tickets missing rows (#1004–#1008, #1010, #1013),
  backfilled and written to the #980 body via `gh api PATCH`, read back byte-for-byte **MATCH**.
  After backfill, all 21 closed subtickets have rows (#981–#991, #1002–#1010, #1013).
- **All subtickets closed**: 23 subtickets, 21 CLOSED. **2 pending = #1011 (t-0261 judging) +
  #1012 (this ticket, closes with this PR's merge)**. Before #1011 closes this item does not hold, and is not claimed to hold.
- **Not yet specified empty**: ✓ (the body reads "(none —…)", after #991 graduates, a pure execution period).
- **Out of scope check**: ✓. Per-PR file-face scan of the 14 wave PRs
  (#1021/#1045/#1057–#1062/#1066/#1069/#1072/#1075/#1088/#1090):
  the change face = apps/web + docs + scripts + .github + verification tooling (verify-pacman skill scripts),
  plus three authorized exceptions — `biome.json`+`pnpm-lock.yaml` (#1003 dependency authorization,
  PACMAN_ALLOW_LOCKFILE_CHANGE passed the gate), `integration/test/m5-web-e2e.test.ts`
  (the F-R21 sequence pin's test-infrastructure face, inside the #1003 ticket), `.claude/skills/verify-pacman/` (verification tooling).
  **Zero apps/server / apps/daemon / packages semantic change** — the backend out-of-scope declaration holds;
  motion consumed, not redesigned (ADR 0009 face) ✓; Base UI kept (provable by the registry ledger) ✓;
  the composer not componentized ✓; the todos.dev pixel contrast shot not resurrected (parity/ still absent) ✓.

### 4. Historical canonical disposition audit

- **The #909 palette abdication archival sentence**: ✓ — the #909 2026-10-07 "overturn record" comment is on file
  (C · paper-blue abdicated to historical reference, E · warm-gray-rose finalized, the C asset original status-unchanged clauses all present).
- **spec/22 superseded annotation**: ✓ — the header superseded-in-part (ADR 0012 / #980) four faces ①–④ on file.
- **Remaining-volume annotation (#1013 ledger check)**: ✓ — ADR 0009 header superseded-in-part (D3②, #991 Q9) +
  revision entry; ADR 0012 revision section (Q9 F8 pointer + Q10 brand-slot closure); docs/spec/06
  superseded-in-part (the parity harness face); spec/11 overlay annotation (host-form anchor swap); spec/18
  remaining-volume audit closure (no invalidated face). All machine-rechecked by `audit-sealed.sh` (ALL CHECKS PASS).
- **The #851 gate keep-or-drop verdict**: **kept, turned into a permanent regression gate** (the verdict lands in the `ci.yml` two gate comments +
  the `ui-debt-gate.mjs` header note, pure annotation zero behavior change; after the change the debt/drift two gates rerun PASS). Reasons:
  1. **Coverage orthogonal, retiring loses the face**: the #989 registry gate's face stops at the `components/ui` boundary;
     the consumer-shape gate judges geometry box rows; the dead-class gate judges class tokens. debt's D1 (per-face CSS
     zero-add) and D2 (the bare button/input/select/textarea count) have no second gate carrying them; drift's
     G1–G4/G6 (.btn selector, hex literals, chip re-definition elsewhere, deliberate-native marker,
     brand-ink ledger) are likewise unique. G5 complements the registry ledger — the ledger pins file hashes and cannot see
     the color content inside registered-deviated files.
  2. **Baseline already at the floor, the ratchet purely prevents backsliding**: 0 per-face files, 3 bare controls (all deliberate-native-
     exempted hidden file triggers, the #953 final-ledger verdict) — "zero non-registry additions" (acceptance template v3 ⑦)'s
     mechanical carrier is exactly these two gates; retiring has zero benefit, losing them loses the whole face.
  3. **Keeping costs zero**: pure source scan, zero dependencies, sub-second, the D3/S5 dual ratchets already prevent "re-freeze raising the ceiling in-branch".

### 5. Evidence archiving + closing criterion

- This directory is the archive; the PR body cites raw permanent links.
- This PR's commit message carries `closes #1012`; **#980 is closed by the user after the merge** (closing the map is the user's ritual),
  this PR carries no #980 trailing tag. #1011 is not disposed of by this ticket.

## Full run ledger (freeze rerun summary)

| Run | Result | Evidence |
| --- | --- | --- |
| e2e full (8399) | **862/862 (5.3m)** | `e2e-full.log` |
| probe run-4 (8400, archived baseline) | visual **894 KEPT / 0 DRIFT / 0 VIOLATION / 0 NOT-RUN**; tests 861/1 (provider-oauth load flake, isolated 7/7 green) | `probe-sealed/` + `flake-attribution/rerun-provider-oauth.log` |
| probe run-1/2/3 | 891 all KEPT (run-1); run-2 voided (self-pollution); run-3 = board-dnd harness race (attribution above) | `flake-attribution/` |
| the five gates | all PASS rc=0 | `gates.txt` |
| audit-sealed.sh | ALL CHECKS PASS (rc=0) | `audit-sealed.txt` |
| local three gates | lint 0 error / typecheck five packages green / spec:parse PASS (862 tests / 112 files) | session record (finished before run-2) |