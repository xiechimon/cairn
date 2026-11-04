# #880 judgment: `waitChip(/规划中/)` requires the UI to sample a sub-second transient — the oracle does not hold; not a product defect

## Conclusion in one sentence

The reject branch's server-side planning window is only **175~375ms** under the stub, while the phase chip is a **pure sampling face**
(SSE events only serve as invalidation hints; the chip copy = the `PHASE_UI` mapping of the todo query snapshot); under a 2vCPU CI load, the
"SSE→invalidate→refetch→response build" round trip always exceeds the window, and by the time each sample is built the phase has already flipped back to
confirm — the DOM **never rendered** `规划中`, and all 150s × 303 polls saw `确认`. This is
**the test oracle asserting a transient that the architecture does not guarantee to be observable**, not a UI refresh-chain failure.

## Criterion 1: today's three CI hits have exactly the same dump signature

| hit | run (att1) | revision-step created | v2 persisted | planning window | UI chip at timeout | server phase at timeout |
| --- | --- | --- | --- | --- | --- | --- |
| PR #876 lane | 37259164634 | @…631708 | @…631927 | **219ms** | `"确认"` | `confirm` |
| main after #876 merged | 37262325352 | @…521275 | @…521483 | **208ms** | `"确认"` | `confirm` |
| PR #879 | 37272143997 | @…496639 | @…496814 | **175ms** | `"确认"` | `confirm` |

Raw dumps: `ci-dumps-2026-10-05.log` (including #879's Playwright failure block — byte-identical shape to #880's ticket quote:
`Expected pattern: /规划中/`, `Received string: "确认"`, `303 × locator resolved`). All three cases' DB ground truth is 2 plan rows (v1+v2), 2 step rows plan/done — **the server-side reject loop completed correctly end to end**, and the `确认` on the UI chip is exactly the real phase at the timeout moment. The chip did not stop updating and carried no stale value: it showed the correct current state throughout — only the `规划中` intermediate state was never captured by any single sample.

## Criterion 2: mechanism reproduction (deterministic, injected sampling delay)

The code chain (all current main code):

- `apps/web/src/detail/dhead.tsx:62-63`: the chip copy = `PHASE_UI[phase ?? todo.phase].chip`;
  on the live face `phaseOverride` is always null (`todo-detail-page.tsx:502`), and the data source = `useTodo`.
- `apps/web/src/api/hooks.ts:177-182`: `useTodo` → the `GET /api/todos/<id>` snapshot.
- `apps/web/src/api/sse.ts:2`: the S8 canon — "SSE events serve only as invalidateQueries hint signals",
  and the phase is not rendered directly from the event payload.

⇒ the only way the chip can show `规划中`: some `/api/todos/<id>` response is **built within the planning window**.
When the window is shorter than the sampling round trip, it is physically impossible.

Reproduction (`repro-spec.ts.txt`, archived from a one-off spec; how to run at the end of this file): inject a 600ms request delay on
`**/api/todos/*` after the confirm gate (> the measured window of 175~375ms, < all 30s budgets), simulating the CI's "sampling round trip > window":

- `ORACLE_880=old` (the original oracle `waitChip(/规划中/)`): **2/2 red**, the failure signature byte-identical to CI
  (`repro-injected-old-oracle-run1.log` / `run2.log`).
- `ORACLE_880=new` (the persistent-evidence oracle, the same fix shape as this PR makes to the real test): **1/1 green**, the reject
  loop completes end to end (reject bubble → plan card v2 → version chip v2 → DB revision step → confirm → review gate),
  in 7.3s (`repro-injected-new-oracle-run1.log`).

## Criterion 3: local core-starvation natural reproduction = 0 hits (consistent with history)

On macOS (M2, 8 cores) with bounded burners (fixed count + a 45min lifetime cap + a close-out kill + a pgrep
self-check): 1 round of 6 burners, 1 round of 14 burners (pre-fix code), both green (`starve-pre-fix-*.log`); post-fix,
10 rounds at 6 burners in `starve-post-fix.log`. The local natural hit rate is **0/12** — consistent with #698's
20 rounds zero-reproduction and #767's 5 rounds all green. Reason: the macOS scheduler gives a bursting process full cores, while the CI condition is
**the whole stack** (vitest + server + daemon + chromium) squeezed onto 2 vCPU, stretching every stage's millisecond-level delays at the same time — local core starvation cannot create the same-shaped condition, so the deterministic evidence face goes through criterion 2's injected reproduction.

## Why #767 did not fix it

#767 fixed **invalidation loss** (an invalidate swallowed by react-query's dedup while a mount fetch was in flight, leaving the chip stuck on a
stale value) — on that path the chip shows a **stale** phase. This signature is a separate, independent path: the invalidation did not get lost and the refetch did happen, but
**the sampling moment was later than the window's close**, so the chip shows a **fresh and correct** confirm.
#767's judgment document already named this shape at the time ("a sub-second transient is unobservable under a sampling architecture … this shape is not invalidation loss")
and listed it as "left for ruling 1", recommending option a (the oracle re-pins persistent evidence); this PR executes that ruling.

## Product-face verdict: no defect

Under a real LLM the planning window is tens of seconds and the user necessarily sees `规划中`; the stub's 200ms window is created by the test harness itself. The three-layer watch (the XMON-60 reconciliation / the #462 watchdog / the seq-hole check) is unrelated — the UI and the server are consistent throughout, and no state is lost anywhere. If the product requires "transient phases guaranteed visible" (option b:
rendering the event payload directly + a minimum display duration), that is a product change touching the S8 canon and needs its own ticket; this fix does not rule out that option.

## The fix

`integration/test/m5-web-e2e.test.ts`, the reject branch:

- Delete `waitChip(/规划中/)` and the redundant `waitChip(/确认/)` after it (the chip never left `确认`,
  and the latter passes immediately under the failure shape with no discriminating power).
- Re-pin the persistent evidence chain instead: **the reject bubble** (persists on send, carrying the "reject accepted" semantics the original transient assertion stood for) →
  **plan card v2** → **version chip v2** (30s budget, the uniform cross-process assertion convention of this file) → a new
  **DB revision-step assertion** (a second plan step row = the server-side ground truth that the phase really re-entered planning, replacing
  the r5 §4 coverage `规划中` used to carry).
- `waitChip` is kept for the persistent gates (confirm / review / done — these phases stay until a user action, so sampling always hits them).

## How to rerun

```sh
# mechanism reproduction (a one-off spec, not entered into the test suite):
cp docs/verify/880/repro-spec.ts.txt integration/test/scratch-880-repro.test.ts
cd integration
ORACLE_880=old pnpm exec vitest run test/scratch-880-repro.test.ts   # red: the same signature as CI
ORACLE_880=new pnpm exec vitest run test/scratch-880-repro.test.ts   # green: the fix works
rm integration/test/scratch-880-repro.test.ts

# the real test after the fix:
cd integration && pnpm exec vitest run test/m5-web-e2e.test.ts       # 3/3
```
