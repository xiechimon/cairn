# ADR 0009 · Site-wide enter/exit motion converges on shadcn defaults — revoking the motion-value surface of the #73 replication discipline

> **superseded-in-part (2026-10-08, ADR 0012 / #991 Q9 / #1013)**: the D3② surface — the in-repo canon for dropdown/popover motion (the `duration-100` + slide -8px ratified by this ADR, which later grew into the V2 scale-fade override via #790/#805: scale .98 + fade, 100ms ease-out) — is partially superseded: motion duration/curves are part of the base-nova form, and keeping custom ones means skin adaptation beyond semantic mapping (violating zero-skin decision ② of #980); the canonical anchor for dropdown/popover motion switches to **the registry upstream default animation** (execution vehicle = #1003 batch 0b, PR #1045 @ `da5972ce`: dropdown/popover motion re-anchored to upstream; dialog-shell / floating-shell scale-fade is kept until the #1008 shell-retirement batch). The literal values of D3② are identical to the re-anchored upstream defaults (`duration-100` + slide -8px is the upstream `duration-100` + `slide-in-from-*` classes), so the numeric conclusion is unchanged — what changes is the canonical source: the motion-value surface no longer has an in-repo first-hand canon from this point on. The original text is kept wholesale as the historical ledger, not deleted; D1 / D2 / D3①③ / D4 / D5 are outside this amendment's scope.

> Status: **Decided and in effect** (2026-10-02, user picked direction B: "I choose B").
> Source: #644's prototype delivery (`docs/research/644-motion-shadcn-prototype.md` §2/§4, interactive prototype
> `docs/research/assets/644/motion-prototype.html`). This ADR records "what is revoked, and where the revocation stops";
> per-domain construction scope and acceptance live in the execution tickets (which cite this ADR); batch bookkeeping is recorded in the motion-batch entry of spec 16.

## Problem Statement

Since #73, the site's motion layer has been a **transition registry replicating the reference site's production stylesheet** (`apps/web/src/styles/motion.css`, whose header states verbatim "Values mirror the official production stylesheet"; values copied one by one from `docs/research/assets/r1/f965382e067739e9.css`). Meanwhile, spec 16's shadcn rollout has landed components carrying tw-animate-css default motion into 6 surfaces (B1 overlay shells, dropdown/popover/dialog registry components) — the site already runs **two motion systems side by side**, with three measurable drifts. The mixed state must converge; #644 presented the user with both convergence directions, along with real numbers and costs:

- **Direction A**: migrate the mechanism to shadcn and bridge the values back to the replicated ones (zero perceptual drift from the reference site);
- **Direction B**: adopt the shadcn default motion language site-wide (perceptible drift from the reference site; requires explicitly overturning #73).

The user chose **B**. This ADR records the boundary and reasoning of this reversal to prevent two things: someone continuing to build per the replication discipline; or, conversely, someone over-interpreting the reversal onto the geometry/color surfaces.

## Recon facts

| # | Fact | Source |
|---|---|---|
| F1 | The consumption surface of the motion.css replication registry = 14 tsx files (including the three `components/ui` adapter layers dialog-shell / floating-shell / select) + `useOverlayMount` manual enter/exit in 2 files; the mechanism is hand-written keyframes + `data-overlay-state` keep-alive mounting | #644 prototype §1.1 (measured by grep) |
| F2 | `tw-animate-css@1.4.0` is already a web dependency; 6 tsx files already use the `animate-in` family; reading the dist verbatim, the defaults are `.15s` / `ease`; enter/exit is driven by Base UI `data-open/data-closed` and **does not need** the manual keep-alive mechanism | #644 prototype §1.2 |
| F3 | Three existing drifts: ① dialog-shell carries `zoom-in-95`, while r8 capture measurements show the reference site's centered dialog is **fade only**; ② dropdown/popover 100ms / slide -8px vs the replicated 150ms / -4px; ③ mount fade-in 200ms ease-out vs tw default 150ms ease | #644 prototype §1.3 (read from source + measured records) |
| F4 | e2e assertions on the motion surface are rare: 2 `getAnimations().finished` waits (mechanism-agnostic) + spinner duration (a kept surface) — re-pinning cost ≈ 0; the visual spec pins static-state geometry/colors, not motion values | #644 prototype §2 (measured by grep) |
| F5 | "Prefer reference implementations, invent nothing from thin air" is the current discipline (ADR 0008 D5); motion values deviating from the reference site can therefore **only change via an explicit reversal**, not as a side effect of migration — and F3 shows it is happening as a side effect | ADR 0008 + the #644 ticket |

## Decision

| ID | Decision |
|---|---|
| **D1** | **Site-wide enter/exit motion converges on shadcn/tw-animate-css defaults (direction B)**: the tw default tier (150ms `ease` base tier, overlay fade+zoom-95, the already-rolled-out duration-100 components keep their values) is the canon; motion.css's replicated enter/exit values are void, and the `overlay-mount` / `anim-*` / `useOverlayMount` manual mechanisms retire with each surface |
| **D2** | **Explicitly revoke the #73 replication discipline — motion-value surface only**: motion.css's header claim "values copied one by one from the reference site's stylesheet" loses its canonical status for enter/exit motion; the #73 / r8 measured values are no longer the construction basis. **Pixel discipline for geometry and color is unaffected** (spec 16's "structure only, zero visual re-pinning" and the #411 criterion stand) — this revocation must not be over-interpreted |
| **D3** | **The three existing drifts are each ratified by B, not silently changed**: ① dialog `zoom-in-95` = new canon (the r8 "fade only" criterion is voided from here); ② dropdown/popover `duration-100` + slide -8px = new canon; ③ mount fade-in returns to the tw default tier. Each is booked in its execution ticket as "ratified by B" |
| **D4** | **Kept surfaces (shadcn has no competing default; values untouched)**: tab indicator slide (#644 reference-site measured left/top/width/height 150ms ease, carried by Base UI Tabs.Indicator), ~~spinner reel (#471)~~ (amended out 2026-10-03; see "Amendments" at the end: the loading indicator switches to the loading-dev Atom contract, #672), hover/press tint family (#73/#629), `prefers-reduced-motion` site-wide degradation rule (from #672 onward the loading surface's copy is carried by loading-dev library styles, behaviorally equivalent) |
| **D5** | **Scheduling form**: the motion batch is woven into spec 16's B3/B4 per-domain batches (each domain's motion is collected while its structural migration happens), not a separate site-wide change wave; spec 16 gains a motion-batch entry for bookkeeping; acceptance reuses that volume's §2 template + this ticket's F4 motion-assertion list |

The reasoning in one sentence: the user has confirmed they want the mechanism unification (one animate-in/out set, manual keep-alive removed), and they explicitly accept motion drift from the reference site — B carries one less layer of "bridged values" bookkeeping than A, and the mixed state converges from here.

## Premortem (assuming it failed: the three most likely failure modes + guardrails)

| Failure mode | Guardrail |
|---|---|
| **Change-of-face regret**: after the site-wide motion takes on the "generic shadcn face", the user wants the reference-site feel back on some surface | The mechanism is unified; reverting = changing single-surface values (duration/ease/enter-*), not switching mechanisms; the D4 kept surfaces were never touched anyway |
| **Revocation over-interpreted**: a builder uses this ADR as a pass for "reference alignment void" and casually changes geometry/colors | D2 states verbatim "motion-value surface only"; the execution ticket's acceptance includes a "must not touch per-face geometry/color canon" item |
| **Dual system lingers**: the migration stalls halfway, half-replicated half-default, messier than today's mixed state | Woven into the existing B3/B4 propulsion mechanism (not an independent volunteer batch); execution-ticket acceptance = zero remaining consumers of `anim-*` / `overlay-mount` / `useOverlayMount` (grep-verifiable), motion.css shrunk to the D4 kept surfaces |

## Amendments

- **2026-10-03 · #672**: D4 kept surfaces remove `spinner reel (#471)`. User agreed on 2026-10-03: the transcript loading indicator switches to a **loading-dev** (MIT, React 19+) pilot; the indicator is `Atom` (`size=16`, `duration=900` pinned to the old reel's cycle — the atom library default is 1000ms; the user picked it after seeing the live preview) — i.e. **the todos.dev replication discipline is abandoned at this one loading-state spot** (a product-level decision; geometry/color pixel discipline is unaffected, D2's boundary stands). The canonical contract for the loading state from here on = the loading-dev library: the root node carries `aria-hidden` itself; `prefers-reduced-motion` freezing is carried by library-injected styles (`animation: none` + the rotor settling at a static `rotate(60deg)` pose), behaviorally equivalent to this ADR's site-wide degradation rule. motion.css's `spinner-reel` keyframes are deleted together with the reel; the "motion.css shrunk to the D4 kept surfaces" line in #656's acceptance is counted against the amended D4. Whether to roll out (a unified site-wide loading-state entry point) awaits the user's decision after seeing the pilot artifact.
- **2026-10-08 · #991 Q9 (booked as #1013)**: D3② amended — the canonical anchor for dropdown/popover motion switches to the registry upstream default (the #790/#805 in-repo scale-fade V2 canon retires); reasoning and scope are in the superseded-in-part header note; execution vehicle = #1003 (batch 0b, PR #1045 @ `da5972ce`, already merged to main).
