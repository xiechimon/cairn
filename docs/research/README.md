# docs/research/

Research notes archived per ticket. Once written they are not maintained; cite them as history, not as current rules (the current rules are indexed in `docs/README.md`). ADR 0015 covers `docs/verify/` only, not this directory.

The notes and captures from the early study of todos.dev (the r1 to r9 series and their `assets/r*/` folders) were removed from the working tree. They remain in git history at `e95b775`; read one with `git show e95b775:docs/research/<file>`.

## Index

### Foundation

| Note | Assets | Content |
|---|---|---|
| [r4-foundation.md](r4-foundation.md) | none | Foundation choice: craft-agents-oss, the pi SDK, the Claude Agent SDK, or fully in-house (some conclusions cite the archived `r9-pi-sdk.md`, see git history `cae19acf`) |

### Multica and runtime research (from 2026-09-29)

| Note | Assets | Content |
|---|---|---|
| [r10-multica-runtime.md](r10-multica-runtime.md) | none | The Multica runtime model end to end: definition, discovery, protocol family, execution, credentials, profiles, permissions (467 lines, source level) |
| [r11-runtime-gap.md](r11-runtime-gap.md) | none | Runtime capability gaps against Multica, G1 to G25 |
| [r12-save-and-start-behavior.md](r12-save-and-start-behavior.md) | none | Agent behavior after `保存并开始`: run directly or orchestrate in the background first (decision material) |
| [r13-multica-runtime-verify.md](r13-multica-runtime-verify.md) | none | Fresh-clone re-check of r10 (HEAD `2ea01ae`); line numbers follow that clone and are the reference for spec 17 |
| [r14-orchestration-parent-card.md](r14-orchestration-parent-card.md) | none | Whether the parent card stays after an orchestration split: three lines of evidence and a recommendation (XMON-98 decision point 1) |
| [r15-multica-run-rendering.md](r15-multica-run-rendering.md) | none | How Multica renders a run (UI and event stream), source-level facts; the basis for ADR 0011 |
| [machine-execution-plane.md](machine-execution-plane.md) | none | End-to-end research on running the same code on any machine; the basis for spec 21 (§4-7 session locality is a correctness item) |
| [herdr-multica-parity.md](herdr-multica-parity.md) | none | Whether herdr itself can produce the Multica experience (method research) |
| [r16-model-catalog-liveness.md](r16-model-catalog-liveness.md) | none | Model catalog liveness: withdrawn upstream models still listed, live models rejected |
| [1607-acp-execution-surface.md](1607-acp-execution-surface.md) | none | ACP as an execution surface |

### Design system and front-end craft (from 2026-09-23)

| Note | Assets | Content |
|---|---|---|
| [412-token-mapping.md](412-token-mapping.md) | none | The 117 names in tokens.css mapped mechanically to the shadcn semantic vocabulary, with a first draft; the head comment of `apps/web/src/styles/tokens.css` points here |
| [430-baseui-dialog-contract.md](430-baseui-dialog-contract.md) | none | Overlay behavior contract compared under Base UI, the re-check of the radix version from #418 |
| [644-motion-shadcn-prototype.md](644-motion-shadcn-prototype.md) | `assets/644/` (prototype HTML and GIFs) | Prototype and trade-offs for moving site-wide motion to shadcn; decided, the reference is ADR 0009 |
| [base-ui-coverage-map.md](base-ui-coverage-map.md) | none | Base UI coverage map: hand-built surfaces, cost per surface, batches and dates (baseline `633afa37`) |

### Positioning, evaluation and method

| Note | Assets | Content |
|---|---|---|
| [892-gate-usage-measurement.md](892-gate-usage-measurement.md) | none | Gate usage measured: withPlan distribution and every path that skips the gate; the basis for ADR 0014 and spec 18 §5 |
| [amp-native-sandbox-orb.md](amp-native-sandbox-orb.md) | none | Amp's native machine execution model, sandbox design and Orbs; where the permission-rules philosophy comes from |
| [eval-methods.md](eval-methods.md) | none | Agent and LLM evaluation methods and current practice (including a close read of pi's evaluation side) |
| [m7-w5-ai-review-slice.md](m7-w5-ai-review-slice.md) | none | M7-W5.1 (#312) slice decision, grill and premortem |
| [migration-surface.md](migration-surface.md) | none | #409 migration inventory (appendices A and B list the selectors of 46+3 specs file by file); the ledger behind spec 16 acceptance |
| [xmon48-filter-panel-closure.md](xmon48-filter-panel-closure.md) | none | XMON-48 board filter interaction research, wrap-up and decision material |
| [r15-agent-responsibility-default.md](r15-agent-responsibility-default.md) | none | Default responsibility text for the first agent: evidence from seven ecosystems' sources and the trade-off (t-0198; shares a number with r15-multica-run-rendering but is a different ticket) |

### Build-time captures (before ADR 0015, around 2026-09-24)

| Folder | PR | Content |
|---|---|---|
| `assets/issue-128/` | #131 | Three sidebar visual fixes, before and after |
| `assets/issue-137/` | #142 | Search interaction fix, before and after |
| `assets/issue-138/` | #145 | Segmented control family fix, before and after |
| `assets/issue-139/` | #144 | Border system unification, before and after |
| `assets/issue-146/` | #158 | Chief panel wrap-up, before and after |
| `assets/issue-147/` | #156 | Collapse family wiring, before and after |
| `assets/issue-148/` | #157 | Local-first cleanup of account and team, before and after |
| `assets/issue-149/` | #162 | Handling of scattered dead buttons, before and after |
| `assets/issue-159/` | #164 | Search result row fix, before and after |
| `assets/issue-160/` | #166 | Board drag unblocked, before and after |
| `assets/issue-161/` | #167 | Card shadow and border unification, before and after |
| `assets/issue-163/` | #165 | Two user-menu fixes, before and after |

These folders predate the `docs/verify/` convention. Each of the twelve PR bodies links its own folder, so keep them in place.

## Known broken links

- `r9-pi-sdk.md`, cited by `docs/spec/00-地基决议.md` and `r4-foundation.md`, was deleted in `cae19acf` (2026-09-19) and exists only in git history.
- Specs, ADRs and code comments that cite the r1 to r9 series (for example "r3 §1.4") point at notes removed from the working tree; read them at `e95b775`.

## Citation conventions

- Notes cite each other by file name, so renaming a note breaks inbound links from specs, ADRs and other notes.
