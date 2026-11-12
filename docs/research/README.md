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
| [2330-claude-entrypoint-and-setup-token-quota.md](2330-claude-entrypoint-and-setup-token-quota.md) | none | `claude -p` (sdk-cli) and interactive mode cost the same allowance; setup-token rate-limit events not yet measurable on omarchy (D50 spike) |
| [mergify-merge-queue-spike.md](mergify-merge-queue-spike.md) | none | Mergify merge queue on a personal-account scratch repo: free install, semantic conflict caught with batching and bisect, label/status entry gates, author/committer, outside merges; go as a cairn pilot |

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
| [2513-tla-statecharts.md](2513-tla-statecharts.md) | `assets/2513/` (Mermaid charts and pstack view modules) | pstack `statechart` on the merge-gate and step-claim TLA+ models: readability, two model coverage findings, a scoped go on emitting charts from the verify skills |
| [892-gate-usage-measurement.md](892-gate-usage-measurement.md) | none | Gate usage measured: withPlan distribution and every path that skips the gate; the basis for ADR 0014 and spec 18 §5 |
| [amp-native-sandbox-orb.md](amp-native-sandbox-orb.md) | none | Amp's native machine execution model, sandbox design and Orbs; where the permission-rules philosophy comes from |
| [dsh-sig-walk-2026-11.md](dsh-sig-walk-2026-11.md) | none (screenshots on `pr-assets/2490`) | #2489 walk of DeepSeek Harness's super-agent prototype and sig: routing, fast path, watchdog, memory, pairing; comparison with cairn, adoptions for #2487, #2488, #1784, and a proposed positioning rewrite |
| [eval-methods.md](eval-methods.md) | none | Agent and LLM evaluation methods and current practice (including a close read of pi's evaluation side) |
| [m7-w5-ai-review-slice.md](m7-w5-ai-review-slice.md) | none | M7-W5.1 (#312) slice decision, grill and premortem |
| [migration-surface.md](migration-surface.md) | none | #409 migration inventory (appendices A and B list the selectors of 46+3 specs file by file); the ledger behind spec 16 acceptance |
| [xmon48-filter-panel-closure.md](xmon48-filter-panel-closure.md) | none | XMON-48 board filter interaction research, wrap-up and decision material |
| [r15-agent-responsibility-default.md](r15-agent-responsibility-default.md) | none | Default responsibility text for the first agent: evidence from seven ecosystems' sources and the trade-off (t-0198; shares a number with r15-multica-run-rendering but is a different ticket) |
| [research-loop-plan.md](research-loop-plan.md) | none | Design plan for agents that research outward (D63, on D60's thread model): research threads before a stuck build's last retry and before new mechanisms, a search tool for pi, sourced expiring memory, daily intake; spikes, cost and open decisions |
| [review-gate-prior-art-2026-11-11.md](review-gate-prior-art-2026-11-11.md) | none | Why `review-gate` exists, how other teams gate on AI review, and what the 13 PRs on the night of 2026-11-11 actually cost. Recommendation only |

### Recovered research (2026-11-06 to 2026-11-09)

These archived notes were recovered in #3597. Private measurements and account details are redacted; the original session labels are historical.

| Note | Assets | Content |
|---|---|---|
| [agent-small-computer-2026-11-08.md](agent-small-computer-2026-11-08.md) | none | The agent's own computer: how others build it, and what cairn's lacks |
| [ai-frontend-quality-2026-11-06.md](ai-frontend-quality-2026-11-06.md) | `ai-frontend-quality-2026-11-06/` | AI-written frontends: why others' look good, where cairn falls short, what to change (2026-11-06) |
| [band-aid-audit-2026-11-08.md](band-aid-audit-2026-11-08.md) | none | Band-aid audit, 2026-11-08 |
| [bot-identity-and-coauthorship-2026-11-07.md](bot-identity-and-coauthorship-2026-11-07.md) | none | Research: bot identity, human co-authorship and human override on GitHub (2026-11-07) |
| [branch-model-2026-11-08.md](branch-model-2026-11-08.md) | none | Branch model: a thread owns one stored work ref |
| [cairn-dogfood-feasibility-2026-11-06.md](cairn-dogfood-feasibility-2026-11-06.md) | none | Orchestrating cairn with cairn: feasibility checks, pilots and closing gaps (living document, since 2026-11-06) |
| [chat-markdown-polish-2026-11-08.md](chat-markdown-polish-2026-11-08.md) | none | Research: claude.ai list bullets, code blocks, copy button and status lines, measured for cairn's chat transcript (2026-11-08) |
| [coordinator-compaction-2026-11-07.md](coordinator-compaction-2026-11-07.md) | none | Coordinator context compaction: how others do it, and what cairn should do (2026-11-07) |
| [desktop-app-stack-2026-11-08.md](desktop-app-stack-2026-11-08.md) | none | Desktop app stack for cairn (2026-11-08) |
| [desktop-mobile-mcp-forms-2026-11-08.md](desktop-mobile-mcp-forms-2026-11-08.md) | none | Desktop app, mobile and MCP management: what form each takes (2026-11-08) |
| [frontend-skills-and-storybook-loop-2026-11-06.md](frontend-skills-and-storybook-loop-2026-11-06.md) | none | What makes good-looking AI frontends: your starred skills, the Storybook self-check loop, and the gap to the cairn gallery (2026-11-06) |
| [hand-rolled-audit-2026-11-09.md](hand-rolled-audit-2026-11-09.md) | none | Hand-rolled implementations audit |
| [logo-design-2026-11-08.md](logo-design-2026-11-08.md) | none | Logo design prior art for Cairn (2026-11-08) |
| [personal-agent-memory-2026-11-07.md](personal-agent-memory-2026-11-07.md) | none | Long-term memory and context compaction for personal agents: how others do it, and what the Coordinator should adopt (2026-11-07) |
| [pr-evidence-review-2026-11-06.md](pr-evidence-review-2026-11-06.md) | none | PR evidence review: why screenshots disappeared, and how a backend PR can be reviewed in two minutes (2026-11-06) |
| [pr-flow-speed-2026-11-09.md](pr-flow-speed-2026-11-09.md) | none | Research: why some PRs take hours from open to merge (2026-11-09) |
| [research-docs-placement-2026-11-08.md](research-docs-placement-2026-11-08.md) | none | Where research notes, designs and evidence should live |
| [review-findings-before-ready-2026-11-07.md](review-findings-before-ready-2026-11-07.md) | none | Research: address review findings before marking a PR ready (2026-11-07) |
| [seamless-device-auth-2026-11-08.md](seamless-device-auth-2026-11-08.md) | none | Seamless browser auth from the owner's own tailnet devices (2026-11-08) |
| [serif-typography-2026-11-08.md](serif-typography-2026-11-08.md) | none | Research: where claude.ai uses its serif, and where cairn should use Source Serif 4 (2026-11-08) |
| [sidebar-coordinator-icon-2026-11-08.md](sidebar-coordinator-icon-2026-11-08.md) | none | Sidebar: brand mark vs. Coordinator row icon (2026-11-08) |
| [single-bot-identity-2026-11-08.md](single-bot-identity-2026-11-08.md) | none | One bot identity for xiechimon/cairn |
| [t3code-devices-and-scope-2026-11-06.md](t3code-devices-and-scope-2026-11-06.md) | `t3code-devices-and-scope-2026-11-06/` | t3code machines (Environments) and settings scope: hands-on research and comparison with cairn |
| [task-stall-flow-2026-11-08-priorart.md](task-stall-flow-2026-11-08-priorart.md) | none | Prior art: keeping agent work moving when the agent asks the user mid-task (2026-11-08) |
| [task-stall-flow-2026-11-08.md](task-stall-flow-2026-11-08.md) | none | Why Coordinator tasks stop midway, and the flow that keeps them moving (2026-11-08) |
| [thread-pr-placement-2026-11-06.md](thread-pr-placement-2026-11-06.md) | `thread-pr-placement-2026-11-06/` | Where a thread's (agent task's) PR should live and how much to show: reference product survey |
| [trajectory-self-improvement-2026-11-08.md](trajectory-self-improvement-2026-11-08.md) | none | Trajectory self-improvement: can cairn read its own traces daily and improve itself? (2026-11-08) |
| [ui-ux-audit-2026-11-06.md](ui-ux-audit-2026-11-06.md) | `ui-ux-audit-2026-11-06/` | cairn UI/UX audit (2026-11-06) |
| [user-computer-model-2026-11-08.md](user-computer-model-2026-11-08.md) | none | The user's own computer: drive it directly, in the background, and confine every harness the same way |
| [zero-command-access-2026-11-08.md](zero-command-access-2026-11-08.md) | `zero-command-access-2026-11-08/` | Zero-command access from all of the owner's devices (2026-11-08) |

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

- `r9-pi-sdk.md`, cited by `docs/spec/00-foundation-decisions.md` and `r4-foundation.md`, was deleted in `cae19acf` (2026-09-19) and exists only in git history.
- Specs, ADRs and code comments that cite the r1 to r9 series (for example "r3 §1.4") point at notes removed from the working tree; read them at `e95b775`.

## Citation conventions

- Notes cite each other by file name, so renaming a note breaks inbound links from specs, ADRs and other notes.
