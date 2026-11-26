# Keeping the repository's documents healthy (2026-11-26)

Question from the owner (paraphrased in English): how should we maintain documents such as stale ones, and not only stale ones?

Measured at `7a24317cd`. Claim tags: **[M]** measured (read or run first-hand for this note), **[I]** inferred from measurements, **[G]** guess. Recommendations only; nothing here is implemented.

## Conclusion

1. **The checks verify form, not whether a text is still in force.** All three document checks that run in CI pass, while the generated ruling table still states "no project-run hosted control plane", a clause the owner superseded on 2026-11-25 in the spec it is generated from. [M]
2. **The dangling-reference ratchet grows.** Since `doc-refs-gate` landed (2026-11-22), all four commits that touched its baseline added rows, 34 in total, each in a change that removed code. Nothing stops `--write-baseline` from accepting new rows. [M] The gate's own growth path is how deletions leave documents stale. [I]
3. **The costliest cases are retired mechanisms still described as current**: the PR flow, the npm release pipeline, ADR files, manual `queue/main` pushes, a hosted-plane ban. [M]
4. **Recommendation, in order:** remove the second copy of each ruling; separate living documents (must be current) from dated records (never updated, never read as current); for living documents make the dangling-reference baseline shrink-only and let the change that retires a mechanism register its name as a retired term; delete or rewrite the dead living documents; accept orphaned research and lessons.
5. **Not recommended:** freshness dates on every document, a second link checker, a prose linter, doc tests, an identifier-drift gate, a duplicate-text gate, an orphan gate, a size gate.

## 1. Inventory [M]

- 1,099 tracked `.md` files; 793 under `docs/`: lessons 357, design 209, research 175, spec 19, ops 15, docs root 10. `.claude/skills/verify-cairn` holds another 157.
- Outside research, lessons, changelog, upstream and reference folders: 476 documents, about 594k words. The largest design document has 10,778 words.
- "Orphan" here means no other tracked text file contains the path or file name (a loose test, so real reachability is no better): design 80 of 209 (26 more are referenced only from research or lessons), lessons 352 of 357, research 37 of 175, ops 6 of 15, spec 0 of 19.
- Status lines in `docs/design`: 89 have one in the first 15 lines, 120 do not. The vocabulary is free-form (accepted, proposed, approved, design, proposal, revision, implemented, retired, superseded, shipped, building and more).
- Exact duplicate paragraphs of 25 words or more: 32, of which 22 come from the `CLAUDE.md` symlink to `AGENTS.md`. Of the 10 real ones, 5 are between `.claude/skills/verify-cairn/SKILL.md` and `docs/agent-dispatch-prompts.md`. Reworded duplicates are not counted.
- `AGENTS.md`: 64 lines, 17,395 bytes. Ship step 4 explains preflight twice in two neighbouring paragraphs. Over the last 500 first-parent commits (2026-11-21 to 2026-11-26) it was edited 15 times, 11 of them growing it, from 15,610 bytes.

## 2. Existing mechanisms: what each finds today [M]

| Mechanism | Result today | What it cannot see |
| --- | --- | --- |
| [`scripts/doc-refs-gate.mjs`](../../scripts/doc-refs-gate.mjs), in `prepush` and CI; 0.46 s locally | 373 docs, 204 known stale references (195 paths, 9 links in `--report`), no new ones | Skips research, lessons, ADR, verify, changelog, upstream, vendor and generated docs. Only links and backtick paths rooted at a top-level directory; no prose ids such as `ADR 0026`, no JSON. Baseline can grow |
| [`scripts/doc-drift.mjs`](../../scripts/doc-drift.mjs); 2 min 3 s | 27 missing paths in `docs/spec` (19 docs), 0 identifiers | Spec only. Its only caller is `gardener-weekly.mjs --drift`, and no workflow has run that since `aaaf5a03e` (2026-11-16) removed the scheduled workflow. CI runs its unit tests only |
| [`scripts/generate-canon.mjs`](../../scripts/generate-canon.mjs) `--check`; 0.09 s | 16 rulings, up to date | Compares [`docs/canon/rulings.json`](../canon/rulings.json) with the generated page. Never compares a ruling with the spec text it cites |
| [`scripts/generate-feature-map.mjs`](../../scripts/generate-feature-map.mjs) `--check` | 55 features agree | Recipe prose |
| [`scripts/doc-reader-tests.mjs`](../../scripts/doc-reader-tests.mjs) | Selects tests that mention a changed doc path | Only covers documents that some test already reads |
| [`anti-slop-foundations.test.ts`](../../apps/web/test/anti-slop-foundations.test.ts), `design-skill-routing.test.ts`, `design-doc.test.ts` (read, not run here) | Pin rule-row length, named checks, unique rule ids, 150-line `DESIGN.md`, token counts, override ids | Design rules only |
| [`scripts/agent-rules.test.mjs`](../../scripts/agent-rules.test.mjs) (read, not run here) | Bans retired merge-ceremony words | In three files only, so `docs/pr-review.md` and `CONTRIBUTING.md` escape |

Baseline growth since 2026-11-22 (349 first-parent commits): distinct rows added by `0b0d06261` 5, `0775d0acc` 8, `faa4b65e3` 6, `867cd5b56` 15 (that one also removed 3); 34 added across the four. 33 are in `docs/design`, 1 in `docs/spec/18`. Row count at end of day: 174 on 11-22, 209 on 11-25 and 11-26.

## 3. Hand-verified cases [M]

| # | Case | Kind |
| --- | --- | --- |
| 1 | [CANON](../CANON.md) `positioning.no-hosted-plane` still bans a project-run hosted control plane. [Spec 18 §4](../spec/18-positioning-and-differentiation.md) says the 2026-11-25 decision supersedes that clause. `f8592f20e` changed the spec without `rulings.json` (last changed 2026-11-21); CI passed | contradicting, generated copy |
| 2 | CANON `positioning.license` says "nothing is sold"; the same §4 now describes a paid official hosted service | contradicting |
| 3 | `README.md` says there is no hosted control plane and no resold compute. This may still describe today's product, since the hosted service is not shipped; the direction it states has changed. Chinese README not checked | possibly stale |
| 4 | No ADR file is tracked (removed in `d7ba791f7`), yet 192 lines outside research, lessons and changelog cite an ADR number, including CANON, specs, verify skills, tests and a source file | dangling |
| 5 | [`docs/spec/README.md`](../spec/README.md) says a later change removes specs 21, 24 and 07; all three are already gone | stale |
| 6 | [`docs/pr-review.md`](../pr-review.md) cites a missing `pr-evidence-gate.py`, a four-section PR template that is not the real one, two `AGENTS.md` sections that do not exist, and a squash auto-merge flow | stale, whole document |
| 7 | [`CONTRIBUTING.md`](../../CONTRIBUTING.md) documents a `release` workflow, changesets, a version script and npm publishing; the workflow was deleted in `c9010010d`, and the script and changeset folder do not exist. It also routes maintainers through `queue/main` | stale |
| 8 | [`tested-sha-landing.md`](../design/tested-sha-landing.md) has a new note on top (speculative queue) while the body still says lanes push `HEAD:queue/main`, which `AGENTS.md` forbids | contradicting, appended not replaced |
| 9 | Manual `queue/main` routing also remains in [`repo-hygiene.md`](../ops/repo-hygiene.md); the cairn-design-review skill says Cairn lands through `queue/main`, and [`preflight-ci-verification.md`](../design/preflight-ci-verification.md) describes a serial `queue/main` pipeline | stale |
| 10 | [`lane-workers.md`](../ops/lane-workers.md) says code review is off; [`agent-dispatch-prompts.md`](../agent-dispatch-prompts.md) tells every implementation brief to add a review-convergence block and follow a PR flow. The latter also holds the owner's personal dispatch preferences, which `AGENTS.md` says belong in owner config | contradicting, wrong audience |
| 11 | [`docs/README.md`](../README.md) presents `lessons/` as an active folder; the retro-cairn skill calls it frozen. The freeze itself holds: nothing added since 2026-10-30 | contradicting |
| 12 | [`message-first-sending.md`](../design/message-first-sending.md) says nothing is built and a shared file is not on main; the outbox files and that file exist (`9fc9b89dc`, 2026-11-12) | stale status |
| 13 | [`coordinator-steer-consumption.md`](../design/coordinator-steer-consumption.md) says two issues remain open (both closed 2026-11-10) and relies on a retired review bot | stale status |
| 14 | [`side-panels-backend-gaps.md`](../design/side-panels-backend-gaps.md) says a field is absent on the live stack; `apps/web/src/api/mappers.ts` now maps it from wire data | stale |
| 15 | [`duet-shaped-clients.md`](../design/duet-shaped-clients.md) plans a PR order; [`action-journal-undo.md`](../design/action-journal-undo.md) still calls itself implementation design although undo is implemented | stale status |
| 16 | `light-framework.md` and `secret-gateway.md` link source removed by the 2026-11-24 deletions (now baselined) | dangling |

**Sample.** `random.seed(20261126)`, 20 of 242 files from `docs/*.md`, `docs/design` and `docs/ops`. Prose claims were checked against code for 8: stale process or status in 5 (rows 12 to 15), accurate in 3 (`design-rules-on-demand`, `chief-stop-visibility`, `owner-default-name`). The other 12 were not read for truth, so 5 of 8 is not a repository-wide rate: the 8 were chosen as checkable, not at random within the 20. Snapshots such as `design/audit-2026-11-20.md`, which cites a removed rules file, are not wrong for their date; they mislead only if read as current. [I]

**Why an identifier gate fails.** 87 of 209 design documents name at least one camelCase identifier that no longer appears under `apps`, `packages`, `scripts` or `integration` (301 names). [M] The top entries are retirement notes whose job is to name removed things. Of three sampled misses, two name something deliberately removed and one (`readServerVersion` in `remote-server-version.md`) looks like real drift. [M] A gate on this would mostly block correct text. [I]

## 4. Agent-instruction layer (aggregates only)

Repository side: cases 8 to 11, plus the doubled preflight paragraph. `.claude/settings.json` has one hook, a remote-only install step. The retro-cairn `SKILL.md` frontmatter is not valid YAML (rejected by Ruby's parser and by Vale); Claude Code still listed the skill with its description in this session. [M] A stricter loader might not. [G]

Owner-private side (global instructions, project memory, user hooks; no content is copied here) [M]:

- Memory is structurally clean: 36 files, none unindexed, no dead index entry or wiki link. About 54 KB together with the global instructions.
- It is semantically not clean. At least six memory entries or index lines carry superseded guidance: older text kept beside its replacement, stacked dated updates that revise each other, a description of a replaced merge queue, a deleted file cited as current.
- Global instructions expect pull-request evidence and review gates; this repository says there is no pull request and its lane document says review is off. Repository and private routing guidance also disagree.
- One skill requires a background agent for research; a user hook denies that kind of agent. This happened while writing this note, which was therefore researched inline.
- That hook's exemption is a keyword match on the prompt text, so wording alone satisfies it.
- The task reports that the same hook recommended an outdated lane vendor after the owner had moved. The old text was not observed; the file read today is current.

A format check finds none of this. [I]

## 5. Prior art

| Source | How it handles document health | Trade-off here | Operated |
| --- | --- | --- | --- |
| [Google docguide](https://github.com/google/styleguide/blob/gh-pages/docguide/best_practices.md) | Change docs in the same change as code; delete dead docs; a small fresh set beats a large stale one; avoid duplicates | Fits a repo where agents land many changes a day. Needs someone to say which docs are living | read |
| [Software Engineering at Google, ch. 10](https://abseil.io/resources/swe-book/html/ch10.html) | Docs have owners and a canonical source; one purpose and audience per doc; freshness dates with reminders after about three months | A reminder needs a human who answers it. A bumped date is easy to fake [I]. The whole measured window of case 1 is younger than one review period | read |
| [Diátaxis](https://diataxis.fr/how-to-use-diataxis/) | Sort by reader need (tutorial, how-to, reference, explanation); improve iteratively | Helps audience mixing; says nothing about retirement | read |
| [Nygard ADR](https://www.cognitect.com/blog/2011/11/15/documenting-architecture-decisions), [MADR](https://github.com/adr/madr/blob/develop/template/adr-template.md) | Short decision records; status proposed, accepted, deprecated or superseded with a link to the replacement | Right shape for dated records. Status is only as good as the habit of setting it | read |
| [Python PEP 1](https://peps.python.org/pep-0001/) | Fixed statuses, `Replaces` headers; a finished PEP is a historical document, not the living spec; only some types stay Active | Closest to the split recommended below | read |
| [Kubernetes KEP template](https://github.com/kubernetes/enhancements/blob/master/keps/NNNN-kep-template/kep.yaml), [reviewer guide](https://kubernetes.io/docs/contribute/review/for-approvers/) | Machine-readable `status`, `replaces`, reviewers and approvers; docs go through role-based review | Assumes standing human reviewers. No freshness rule was found in the two pages read | read |
| [Rust Reference authoring guide](https://github.com/rust-lang/reference/blob/master/docs/authoring.md), [rustdoc tests](https://doc.rust-lang.org/rustdoc/write-documentation/documentation-tests.html) | Main text describes the current edition only; stable rule ids; code blocks compile and run as tests | Executable proof for examples only | `rustdoc 1.98.1 --test` on a scratch file calling a removed function: failed with E0425 as expected |
| [Python doctest](https://docs.python.org/3/library/doctest.html) | Runs interactive examples in text | Cairn's docs are mostly shell commands with side effects [I] | scratch file: 1 of 2 examples failed on the planted wrong output |
| [lychee](https://github.com/lycheeverse/lychee) | Fast link checker with offline and fragment modes | Finds broken links, not backtick paths or truth | v0.24.2, offline: 358 live files, 1,355 links, 22 errors in 0.11 s; all of `docs/` 214 errors in 0.23 s, including links from research records |
| [Vale](https://github.com/vale-cli/vale) | Prose rules as YAML, including banned terms | A banned-term rule adds a binary for what a small script does [I] | v3.28.1, three terms over the same list: 115 ADR hits and 1 `queue/main` hit in about 1 s, while `git grep` matched 128 lines for the same patterns; two files errored on frontmatter |
| [Swimm Auto-sync](https://docs.swimm.io/features/keep-docs-updated-with-auto-sync/) | Docs hold code snippets; CI auto-updates trivial moves and fails when a human must re-verify | Proves coupled snippets, not prose decisions; adds a vendor format | blocked: needs a vendor account and vendor-format docs [G] |
| [Mintlify agent](https://www.mintlify.com/docs/agent) | An agent proposes doc changes as pull requests | Cairn has agents and no PR flow | blocked: the page says the agent needs a Pro or Enterprise plan |
| [Claude Code memory](https://code.claude.com/docs/en/memory), [best practices](https://code.claude.com/docs/en/best-practices) | Under 200 lines per file; path-scoped rules and skills for narrow guidance; contradictions may be resolved arbitrarily; review periodically, `/doctor prompt-audit`; `MEMORY.md` loads up to 200 lines or 25 KB; instructions are context, so must-happen rules belong in hooks | Matches Cairn's on-demand design rules. `AGENTS.md` is 64 lines but 17 KB of long lines [M], so a line target says little [I] | loaded in this session; `prompt-audit` not run |
| [AGENTS.md](https://agents.md/) | Nested files; the closest file wins; chat overrides | No lifecycle guidance on the page | read |
| [Codex guide](https://learn.chatgpt.com/docs/agent-configuration/agents-md), [loader source](https://github.com/openai/codex/blob/main/codex-rs/core/src/agents_md.rs) | Concatenates global and project files; 32 KiB default budget, truncates and warns | The root file is over half the default budget before nested files [I] | source read; CLI not run |
| [pi loader source](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/resource-loader.ts) | Picks `AGENTS` or `CLAUDE` files per directory | No size cap seen in a keyword search [I] | upstream source searched; installed package not available in this worktree |
| [Amp manual](https://ampcode.com/docs/markdown/customize/agents-md) | Parent, subtree, personal and workspace files; recommends a general root and specific subtree files | Same split advice | read; CLI not run |
| [Cursor rules](https://cursor.com/docs/rules) | Glob-scoped rules; keep under 500 lines; point to files instead of copying them | Supports one copy plus scope | read |

Papers (abstracts re-read for this note; some are also cited in the [agent memory study](agent-memory-systems-2026-11-26.md)):

- [Stale instruction files override code](https://arxiv.org/abs/2610.30571): on 40 Python projects, 90.1% of choices followed the stale file over the existing code; agents often noticed the conflict. One user-level sentence giving code precedence reversed this in their setup.
- [Evaluating AGENTS.md](https://arxiv.org/abs/2602.11988): instructions are followed, general task success does not improve, cost rises over 20%, repository overviews do not help.
- [Factorial adherence study](https://arxiv.org/abs/2605.10039): no detectable effect of file size, position, layout or adjacent contradictions on a trivial annotation task; compliance fell as a session generated more functions. It does not show that contradictions are harmless for conflicting workflow instructions. [I]
- [IFScale](https://arxiv.org/abs/2507.11538): at 500 keyword instructions the best models reached 68%; far from this setting.
- [Guardrails beat guidance](https://arxiv.org/abs/2604.11088): negative constraints helped where positive directives hurt; random rules helped as much as curated ones.

Together: a stale instruction is acted on, so retirement matters more than a length target. [I]

## 6. Pattern that fits

**Few living documents, held to the code by the change that breaks them; everything else is a dated record.** This is PEP's historical-versus-active split plus Google's same-change and delete-dead rules. [I]

- **Living** (must be true today): root `*.md`, `docs/*.md`, `docs/spec/`, `docs/ops/`, project skills (not vendored or changelog), `apps/web/DESIGN.md` and the `## Rules` surfaces.
- **Record** (true on its date): research, lessons, verify, and by default `docs/design/`. A record that still governs behaviour has that rule moved into a living document, or is named in a short living list (surface rules and the landing mechanism are candidates).
- **Owner of retirement: the change that retires the thing.** A later sweep is a backstop. With changes landing this fast (500 first-parent commits in under six days), a periodic gardener is always behind, and the last one stopped running without anyone needing to notice. [I]

## 7. Per failure kind

| Kind | Decision | Rung and routine |
| --- | --- | --- |
| Generated drifting | Keep both `--check` gates; remove the hand-kept ruling copy (C1) | code |
| Contradicting: ruling vs spec | C1 | code |
| Dangling, living | Shrink-only baseline (C3) | CI |
| Dangling, records | Accept | none |
| Stale after a retirement | Retired-term list (C4) plus same-change rule | CI, review rule |
| Stale prose with no removed name or path | Accept that no gate finds it. Routine: whoever relies on a living doc and finds it wrong fixes it in the same task; monthly agent sweep (C7) | review rule, routine |
| Dated record read as current | C2 banner and index rule | skill and instruction text |
| Duplicated | One home, others link. Fix the known ones (C5); no gate | review rule |
| Orphan or unread | Accept for records. Delete or link living orphans in the sweep | routine |
| Too long or too many instructions | No new size gate: loaders already warn or cap, and the evidence on length is mixed. New area rules go in skills or path-scoped rows; each retirement deletes its text | existing design-rows mechanism, review rule |
| Wrong audience | Owner preferences leave the repository (C6) | review rule |
| Private-layer contradictions | Owner-config work (C8); repository CI cannot see it | routine |
| Retirement ownership | The retiring change | one line in `AGENTS.md` (C2) |

## 8. Concrete changes, in order

"Owner yes" marks a change to intended behaviour, public positioning, contributor policy, or removal of intentional functionality.

| Order | Change | Code areas | Owner yes? |
| --- | --- | --- | --- |
| C0 | Bring the two superseded rulings and the README answer in line with the 11-25 decision, separating "today's product" from "direction" | `docs/canon/rulings.json`, `docs/CANON.md`, `README.md`, `README.zh.md` | **Yes**: public positioning wording |
| C1 | One source per ruling: mark the ruling sentence inside its spec and generate the table from the marks; `rulings.json` keeps only id, spec and date, or goes away. A removed mark or missing id fails the existing `--check` | `scripts/generate-canon.mjs` and test, `docs/spec/18, 19, 22, 29`, `docs/canon/` | No (same page, same ids). Spec 19, 22, 29 rulings summarise a whole volume and need one marked sentence each |
| C2 | Define living and record; one banner line in the design and research indexes; add to `AGENTS.md`: "the change that retires a mechanism, path or rule updates or deletes every living document that describes it, replacing text instead of adding a note above it" | `docs/README.md`, `AGENTS.md` | **Yes**: changes how `docs/design` is read |
| C3 | Refs gate: records (including default `docs/design`) report only; living documents cannot gain baseline rows, and `--write-baseline` refuses growth | `scripts/doc-refs-gate.mjs`, its test and baseline, optionally `scripts/baseline-ledger.mjs` | No after C2 |
| C4 | Retired-term list over living documents with a per-file count baseline that only shrinks: ADR numbers, the old PR gate name, manual `queue/main`, the deleted design-rules file. The retiring change adds its term | extend `scripts/agent-rules.test.mjs` or add a small gate beside the refs gate | No |
| C5 | Fix dead living text: rewrite the landing and release parts of `CONTRIBUTING.md`; delete or rewrite `docs/pr-review.md`; rewrite the old body of `tested-sha-landing.md`; fix cases 5, 9, 11; merge the two preflight paragraphs; fix the retro-cairn frontmatter | as named | `CONTRIBUTING.md` and `pr-review.md`: **yes** (outside contributor policy). Rest: no |
| C6 | Move personal dispatch and lane preferences out of the product repository, keeping only rules any contributor needs; remove the review block that contradicts the lane document | `docs/agent-dispatch-prompts.md`, `docs/ops/lane-workers.md`, `AGENTS.md` pointer, their readers | **Yes** |
| C7 | Retire `doc-drift.mjs` and the gardener `--drift` path; replace the dead schedule with a monthly agent task that takes living documents only, checks claims against code, fixes or deletes, and reports what it sampled | `scripts/doc-drift.mjs` and test, `scripts/gardener-weekly.mjs`, `.github/workflows/ci.yml`, spec 28 mentions | **Yes**: removes functionality and adds a routine |
| C8 | Outside the repo: replace memory entries instead of appending; check that paths cited by memory exist; reconcile global PR and review expectations with this repo; reconcile the research skill with the agent hook and make its exemption structural. Consider the code-precedence sentence from the stale-file paper | owner's user config | **Yes**: owner's own setup. The sentence also weakens instructions that intentionally differ from current code [I] |

### Gate admission for C3 and C4

| Requirement | C3: no new living rows | C4: retired terms |
| --- | --- | --- |
| Ratchet baseline | Existing rows kept; growth refused [design] | Current counts committed; today's living set has 153 ADR-pattern lines, 8 old-PR-gate lines, 8 `queue/main` lines (a different scope from the 192 in case 4) [M] |
| Replay on recent main | Of 34 rows added in 349 commits, only the `docs/spec/18` row is living. So one commit (`867cd5b56`) would have been blocked, correctly: the spec cited a deleted file [M]. Replay classifies the committed rows; it did not rerun a modified gate [I] | Last 500 first-parent commits: no net addition of an ADR number or the old PR gate name. `queue/main` would have flagged `4f7701d99` and `5397943ec`, both before the speculative queue landed (`48ba97997`, 11-25), when the term was current; no hit after [M]. That clean window is about one day, so extend the replay before enabling. The deleted design-rules file has 0 living mentions |
| Hollow satisfiers | Removing backticks, rewording a path, or moving a file into a record folder passes. Negative controls: a planted dangling path in a living doc is red; a planted grown baseline is red. Moving living to record needs a reviewed edit to the living list. The rewording hole stays open [I] | Rewording escapes. Negative control: a planted retired term is red; raising a count is red. It stops copy-forward, not every stale description [I] |
| Judges the change under test | Reads the checked-out tree | Same |
| Added CI time | Existing gate runs in 0.46 s on this laptop; no new step expected. CI time must be measured on the implementing change [M local, G CI] | A pattern search over living docs; Vale took about 1 s on a similar list. Measure the real implementation in CI [G] |

**Rejected gate, with its replay.** "A change to a spec section cited by a ruling must also change `rulings.json`": over 500 commits it fires 4 times. One is the real miss (`f8592f20e`). The other three (`23634c735`, `72d6cfca6`, `29d422637`) touch a ruling that cites a whole volume and, judged by their subjects, did not change it [I]. Limited to numbered sections it fires once, correctly, but pasting a new hash or touching the file would satisfy it without reading the ruling. That is a hollow satisfier, so C1 removes the copy instead. C1 still cannot catch new prose elsewhere in a spec that contradicts a marked sentence. [I]

**What the plan does not catch.** Cases 12 to 14 (status and behaviour prose with nothing removed). C2 makes most of them harmless by classifying them as records; in living documents only reading finds them. [I]

**Why not freshness dates.** Dates on about 476 documents would need an answering owner for each reminder, can be bumped without reading, and would not have flagged case 1, which went wrong one day before this note. [I] Reconsider for a living list that has become small.

## 9. Limits

- No percentage of stale documents is claimed. Rows in section 3 are verified cases, not a census.
- Orphan and duplicate counts come from literal matching; semantic duplicates and unlinked-but-searched documents are invisible to them.
- Whether agents load a given repository document was not measured from session traces.
- The private layer was read on one machine on one day.
- The replays cover under six days of history because of the commit rate.
