# PR evidence review: why screenshots disappeared, and how a backend PR can be reviewed in two minutes (2026-11-06)

Labels: **[`实测`]** run by hand or original text read in this round; **[`推断`]** derived from `实测`, can be re-checked; **[`猜测`]** everything else. This note is research plus a proposal; it did not change any gate, template or skill.

## 1. Conclusions

- Screenshots did not disappear overall. UI PRs mostly still carry screenshots (50-100% every day from 10-31 to 11-05); backend PRs never had screenshots and have almost no request/response evidence (of 159 backend PRs since 10-30, only 4 carry any). Only 3 of the latest 25 PRs touched `apps/web/src`, so when ian opens the recent PRs he basically sees no images. [`实测`, script in the appendix]
- The root cause is the rule itself: the template and the skill define backend Proof as "one line with a test name", and the gate only checks whether Proof is written and whether image links open, never requiring images or request records. The sentence in the skill "for API changes paste the before and after request and response from verify-cairn" has no check behind it and is in effect a dead rule. [`实测`]
- Proposal: give backend PRs a card of "requirement clause -> real request -> response -> database rows before/after -> conclusion", with three fixed lines `Live / Mocked / Not covered`. It was run for real on #3110; results are in section 6.

## 2. Audit: the latest 25 PRs

Scope: `gh pr list --state all --limit 70`, dropping the Mergify queue PRs and taking the latest 25 (#3062-#3124). Of the first 30, 14 are `app/mergify` queue PRs whose bodies are merge summaries only and contain no evidence. [`实测`]

| PR | Type | Proof has image | Real request/response | Test name only | Notes |
|---|---|---|---|---|---|
| #3124 | UI | Yes, 4 | None | No | Screenshots come from a fixture page, which the PR itself states |
| #3118 | CI | None | None | No | Pasted command output (33 pass) |
| #3116 | CI | None | None | No | Pasted manual gate output |
| #3113 | CI | None | None | No | Prose retelling of survivor output |
| #3112 | Backend | None | Prose retelling only ("got 401") | Partly | Ran with a fake sidecar, original not pasted |
| #3111 | Verification | None | None | No | TLC result table |
| #3110 | UI+backend | Yes, 3 | None | No | Has a schema table, no curl and no database rows |
| #3109 | CI | None | None | No | Timing measurements |
| #3108 | Ops | None | None | No | Pasted script output |
| #3105 | Docs | None | None | No | |
| #3101 | UI+backend | Yes, 2 | None | Partly | The new endpoint `POST /providers/:pid/test` gave only a test name |
| #3099 | Docs | None | None | No | |
| #3093 | Ops | None | None | Yes | |
| #3092 | Test | None | None | Yes | Test count only |
| #3089 | Backend test | None | None | Yes | Has the original failure text |
| #3088 | Misc | None | None | No | Prose retelling of grep results |
| #3083 | Backend | None | None | Yes | |
| #3077 | Backend | None | Prose retelling only ("seeded 1 rule") | Partly | Started on a copy of the live database, database rows not pasted |
| #3076 | Go sidecar | None | Pasted one line of output | No | Size table |
| #3075 | Backend | None | None | Yes | Langfuse was not really pushed to |
| #3073 | Backend | None | None | Yes | One curl would prove the 401 |
| #3071 | daemon | None | None | Yes | Fake E2B client |
| #3067 | CI | None | None | Yes | |
| #3065 | Test | None | None | No | Tested the count of /tmp leftovers |
| #3062 | Docs | None | None | No | |

[`实测`] Of the 9 PRs that changed server or daemon source: 0 pasted raw requests and responses, 0 pasted database rows, 5 had only test names, 2 had only prose retelling, and 2 contained only UI screenshots. All 9 image links returned HTTP 200 and render normally.

Per-day statistics (`all.json`, PRs merged 10-26 to 11-06, not counting Cursor/shields badge images) [`实测`]:

| Date | UI PRs with images | Backend PRs with request/response |
|---|---|---|
| 10-27 | 7/9 | 0/18 |
| 10-30 | 8/22 | 0/26 |
| 11-02 | 14/16 | 1/20 |
| 11-04 | 14/25 | 3/43 |
| 11-05 | 6/12 | 0/15 |

## 3. Root causes (files and line numbers per `origin/main`)

1. **Template** `.github/PULL_REQUEST_TEMPLATE.md:3`: `Backend: one line naming the test that fails on main, its failure text, and that it passes here.` This line was added in #2207 (10-30, d0bb29077), and from then on backend evidence was defined as a test name. [`实测`]
2. **Skill** `.claude/skills/pr-cairn/SKILL.md:21-25` repeats the same rule. Line 69 says `API changes: before and after request and response, captured with verify-cairn`, but the "Gate facts" table at lines 147-155 has no matching check, so an author who follows line 22 passes. [`实测`] When the two statements conflict, an agent picks the easier one. [`推断`]
3. **Gate** `scripts/pr-evidence-gate.py`: the docstring at lines 8-13 states it checks only whether there is an answer, not how good the answer is; `section_verdicts` (lines 150-164) only looks at whether Proof is empty; the image check (lines 358-374) applies only to images already in the body. Nowhere in the file is an image or request record required. #2201 (10-30, 20f741216) removed the screenshot-archive-source check, and the original commit message says "Evidence links are no longer required". [`实测`]
4. **The 600-character cap** (line 114 and lines 353-356) squeezes Proof into a single sentence. Tables and code blocks do not count toward the cap, so the cap itself does not block request records; nobody just reminds the author. [`推断`]
5. **Outdated doc** `.claude/skills/verify-cairn/SKILL.md:24` still says the gate rejects screenshots outside `docs/verify/<issue>/` (#1983); that check was deleted in #2201. [`实测`]
6. **PR composition**: recent PRs are mostly backend and ops, with 14 Mergify queue PRs mixed into the list, hence ian's impression that "there have been no screenshots lately". [`推断`]

## 4. Video: Elie Steinbock, "How I Built an Open Source Grok Bot in a Day"

Source: https://www.youtube.com/watch?v=xk-aLMQRYfk , length 19:53, published 2026-10-15. English auto-captions were fetched with agent-reach's `yt_sub.py`, 4,244 words, with recognition errors in the spelling of project names. [`实测`]

The author's method for accepting agent output [`实测`, all from the caption text]:

1. **Write the plan first** (about 1 hour), then run with `/goal` until the plan is entirely ticked off, and finally run a security scan.
2. **Verification is the first priority**: he requires a screenshot of every page, and without screenshots the goal counts as not finished and the agent keeps working.
3. **Use emulators for third-party services** (emulate.dev, LocalStack, and Composio/Daytona emulators he had an AI write himself). The emulators are stateful, speak the real protocol and run offline in CI, so an agent can verify itself without logging in to real services.
4. **Run Playwright in CI on every PR**, screenshotting about 350 pages across the whole site. He does not look at every one, only the few that changed, and new screenshots are pasted into the PR.
5. **Merge by risk tier**: an agent sweeps new PRs every few hours, simple fixes are merged automatically, and for large features it sends him the screenshots and waits for his approval. Another scheduled bot cleans up redundant copy and runs security checks.

Takeaway for cairn: screenshots work for him because CI generates them automatically, not because of the author's self-discipline; for the backend he relies on emulators, not screenshots. [`推断`]

## 5. Industry practices (9 kinds, all with sources)

~~X and Reddit could not be read this round: `tw.sh` lacks `twitter_auth_token`, Reddit returned Blocked, and Exa (mcporter) is not installed on this machine.~~ **11-06 incremental revision**: access has been fixed, and the 11 additional X and Reddit items are in the "Increment" section at the end. The table below still comes entirely from blog and official-doc original text. [`实测`]

| # | Practice | Source | Key points |
|---|---|---|---|
| 1 | Command plus output, pasted into the PR as is (curl evidence) | Simon Willison, "Your job is to deliver code you have proven to work" https://simonwillison.net/2025/Dec/18/code-proven-to-work/ ; Claude Code best practices https://code.claude.com/docs/en/best-practices | Manual testing has three steps: set up the initial state, execute the change, show the effect, preferably written as pasteable terminal commands. Saying only "All tests pass" carries almost no information |
| 2 | Have the agent generate a demo document, reducing room to cheat | Willison, "Showboat and Rodney" https://simonwillison.net/2026/Feb/10/showboat-and-rodney/ | The commands in the document are actually executed by the tool with output recorded, and can be replayed for verification |
| 3 | Review the tests: after reverting the implementation the tests must fail | Same as #1; Google, "Small CLs" https://google.github.io/eng-practices/review/developer/small-cls.html | Tests and the change go in the same CL. cairn's current rule goes only this far |
| 4 | Contract/snapshot diff | oasdiff README (`gh api repos/oasdiff/oasdiff/readme`) | Automatically lists breaking and non-breaking changes for API consumers. cairn's schema-glance already does this at the database layer |
| 5 | Before/after comparison of database or state, plus emulators | emulate.dev https://emulate.dev ; the video | Stateful Stripe/GitHub/Google stand-ins, not mocks. verify-cairn already prescribes the three-piece set of "screenshot + API JSON + SQLite rows" |
| 6 | A temporary environment per change, with observability | OpenAI, "Harness engineering" https://openai.com/index/harness-engineering/ ; Vercel Preview https://vercel.com/docs/deployments/environments | Every worktree can start an app instance, with logs, metrics and traces all queryable by the agent; one preview deployment per branch |
| 7 | Trace and network records | Playwright Trace Viewer https://playwright.dev/docs/trace-viewer-intro | Lets you replay every action, every network request and page snapshot step by step |
| 8 | AI reviews first, humans spot-check | Cognition, "Devin Review" https://cognition.ai/blog/devin-review ; Stripe, "Minions" https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents ; GitHub Copilot docs https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/review-copilot-output | Devin groups and orders related changes and explains them segment by segment; Stripe merges over 1000 agent-written PRs a week, all of them human-reviewed; GitHub specifies that the initiator's own approval does not count, and reminds you to check `.github/workflows/` changes first |
| 9 | Review depth by risk, small PRs or stacked PRs | Graphite, "Stacked diffs" https://graphite.com/guides/stacked-diffs ; Google Small CLs; the video | A small PR is easier to review; low risk merges automatically, and a large feature has a human look at the evidence |

What they share: the reviewer looks at the **execution record**, not the author's summary. Evidence is generated by tools, not retold by the author. [`推断`]

## 6. Proposal: a two-minute evidence card for backend PRs

**Trigger**: the PR changed `apps/server/src/routes*.ts`, or added/changed externally visible HTTP behavior.

**Card content** (placed in Proof, in English; tables and code blocks do not count toward the 600 characters):

1. **Requirement**: a link to the requirement text, plus a one-sentence quote of the original. For third-party interfaces, an official-doc screenshot must be attached.
2. **Requests table**: at least one row per requirement clause, with columns "scenario | request | HTTP status and key JSON | database before -> after | pass/fail".
3. **Before**: run the same request on code without this change, one line of result.
4. **Three coverage-label lines**: `Live:` (the real system), `Mocked:` (fake/stub/emulator), `Not covered:`.
5. Test names drop to one line, in a collapsed section.

**ian's two-minute reading**: first check whether each clause in the requirement has a matching row, then scan the pass column, and finally read `Mocked` and `Not covered`.

### Example: #3110 (D110 composer draft cross-device sync)

Environment [`实测`]: 8791/5273 were already taken by another lane's verify stack (a different worktree, started 04:56), so the previous agent started a separate isolated stack in the `pr-evidence-example` worktree (eb690632a, which includes #3110) on ports 8795/5277, with `CAIRN_HOME` in a scratch directory. 8787 was not touched. The "Before" line is a read-only GET against the 8791 stack, whose code is at ae86f0cb2 and does not include #3110. The output below is from this round's rerun.

The requirement text (#3104):

> what the user typed and the attachments added … must survive closing the app and reopening it on any device, and clear only after a successful send.

The PR would be written like this:

| Clause | Request | Response | `composer_draft` rows (scope `todo:review-demo`) | ✓ |
|---|---|---|---|---|
| Before (code without #3110) | `GET /api/teams/$T/drafts/todo:review-demo` | `404 {"error":"Not found"}` | table absent | — |
| survives close | `PUT …/drafts/todo:review-demo` `{"content":"Ship the drafts API"}` | `200 {"content":"Ship the drafts API","updatedAt":1793971645041}` | 0 → 1 (`Ship the drafts API`, uidLen 21) | ✓ |
| any device | `GET …/drafts/todo:review-demo` | `200` same content and updatedAt | 1 → 1 | ✓ |
| overwrite | `PUT` `{"content":"Ship the drafts API v2"}` | `200 … "updatedAt":1793971645059` | 1 row, content v2 | ✓ |
| bad scope | `PUT …/drafts/evil%20scope` | `400 {"error":"invalid draft scope"}` | unchanged | ✓ |
| clears after send | `PUT` `{"content":""}` | `200 {"content":"","updatedAt":null}` | 1 → 0 | ✓ |

```text
Live: isolated verify stack 8795 on eb690632a, SQLite read with sqlite3 -readonly.
Mocked: none. Auth was off (CAIRN_AUTH=off); "any device" was a second HTTP client as the same user.
Not covered: attachment tokens, two real browsers, per-user isolation with auth on, the 30-day expiry.
```

This card directly exposes what the original PR evidence lacked: nothing covered "attachments" in the requirement with a request; and when #3110 merged the Review section still said `Pending Codex cloud review`. [`实测`]

### What to change to enforce it (none changed this round)

| Location | Change |
|---|---|
| `.github/PULL_REQUEST_TEMPLATE.md:3` | Replace the Backend sentence with the four parts of the evidence card |
| `.claude/skills/pr-cairn/SKILL.md:21-25`, `:69`, `:147-155` | Unify into one rule, and add a row to the Gate facts table |
| `.github/workflows/pr-evidence.yml:148-153` | Follow the schema-glance pattern: when the diff touches `apps/server/src/routes*.ts`, pass the gate an `--api-card` argument |
| `scripts/pr-evidence-gate.py` | With `--api-card`, require a `### Requests` table with at least one row containing an HTTP status code and all three coverage-label lines; add tests too |
| `.claude/skills/verify-cairn` | Add a `vp.mjs` driver that generates the table above automatically (requests, responses, `sqlite3 -readonly` rows before and after), so authors do not copy it by hand |
| `.claude/skills/verify-cairn/SKILL.md:24` | Delete the outdated #1983 statement |

The gate can check only the format of the card, not whether the content is true; whether it matches the requirement still depends on Codex review and ian's spot checks. [`推断`]

## 7. Questions for ian to decide (each with a recommended answer)

1. **For evidence on the backend implementation side, text records or screenshots (Swagger/Postman screenshots)?** Recommended: text tables and code blocks. Text can be copied, grepped and validated by the gate; screenshots are kept only for the requirement-original side.
2. **Should the gate enforce the evidence card?** Recommended: yes, triggered only when `routes*.ts` changed, following the schema-glance approach.
3. **Can an internal requirement (an issue or a Dxxx in a plan) use "link + original quote" instead of a screenshot?** Recommended: internal requirements can; third-party interfaces must attach an official-doc screenshot.
4. **Should the three lines `Live / Mocked / Not covered` be mandatory?** Recommended: mandatory, for all code PRs. The current `Not verified:` merges into `Not covered:`.
5. **Must there be a Before line?** Recommended: required for new endpoints and behavior changes; one line of 404 or the old response is enough.
6. **Should third-party integrations get emulators?** Recommended: yes, GitHub first (emulate.dev already has it), then consider E2B and Langfuse. #3071 and #3075 both left gaps on the critical path because there was no real call.
7. **Should we follow the video and run full-page screenshots in CI for every PR?** ~~Recommended: not for now. Land the backend evidence card first, and UI keeps using the existing before/after comparison table.~~ **11-06 incremental revision**: recommended to do a narrow version, ranked after the backend evidence card. Screenshot only the routes the diff touches, take the baseline from `main`, show results inline as a PR comment, and do not put them in a CI artifact archive. For the reasons see section B of the "Increment" at the end.

## Appendix: location of raw data

A scratch cache directory for this research holds: `real25.json`, `all.json`, `scripts/{audit,trend,proofs}.py`, `scripts/example.sh`, `example-rerun.txt`, `video.txt`, and `src/*.md` (the fetched original source text).

## Increment (11-06 additional reading)

This section only fills in the X and Reddit parts that the previous version lacked and does not redo the earlier text. The original text is cached in a second scratch cache directory (`tw/*.json`, `rd/*.xml`, `src-hugo.md`).

**How access was fixed** [`实测`]: agent-reach was reinstalled as the GitHub-released 1.6.1 (the same-named package on PyPI is not this project), adding the `twitter` and `reddit` channels. X search and post reading go through agent-reach's OpenCLI backend, and X long-form articles go through `api.fxtwitter.com`. Reddit search goes through agent-reach's public-web; post bodies and comments use Reddit's comment RSS (`/comments/<id>/.rss`), about 45 seconds apart, backing off and retrying on 429. These routes did not work: the `.json` of `www.reddit.com` and `old.reddit.com` is blocked by Reddit ("blocked by network security"), OpenCLI post reading returns 403, and Claude in Chrome is not allowed to open reddit.com. Exa is not installed: agent-reach 1.6 no longer uses mcporter, and web search still uses WebSearch.

### A. What each new source added

| # | Source | What it adds | Label |
|---|---|---|---|
| 1 | Hugo Richard (Nuxt team), "What My Pull Requests Look Like Now", [X](https://x.com/hugorcd/status/2117639080607662490), [original](https://hugorcd.com/writing/what-my-pull-requests-look-like-now) | Evidence is chosen by change type, as a table, not a template: pages use before/after screenshots of the same size and crop; bugs use outputs from both sides for the same input; performance uses several measurements on both sides under the same load; commands use real output, not retyped; a new API pastes the calling code. Honesty rules: "Before" must be live, the base branch or the last deployment, not a reverted copy; every screenshot must have been looked at; no real data; state what was not done (for example "the test was not run on the old code first"). The first line of the PR says who did what and whether the author has already reviewed it | `实测` |
| 2 | Ben Holmes (Warp), "Addressing the code review bottleneck", [X](https://x.com/BHolmesDev/status/2118411592627052937) | Three levers: before humans look, run several rounds of a self-built review agent and send only the comments needing human judgment to the PR; have the agent test with a computer, with screenshots and recordings as required PR description fields that must include before and after states; score with five merge-risk items (Verification, Alignment, Impact, Rollback cost, Error detection), suggesting writing Impact and Rollback cost into the PR description first. Guard against excess evidence: multiple screenshots only for different flows, recordings trimmed of blank time and compressed to 10-15 seconds | `实测` |
| 3 | Addy Osmani, [X](https://x.com/addyosmani/status/2113677798774898773) and the long post [Critical thinking when agents do the work](https://x.com/addyosmani/status/2117512471930167377) | Besides E2E tests, he has Claude hand back recordings and screenshots as evidence of "done". The long post warns: the more the output looks right, the easier "cognitive surrender" is; suggests asking each time "what would have to be true for this to be wrong", and then actually checking | `实测` |
| 4 | Lauren Tan (poteto), [X](https://x.com/poteto/status/2109436202554372476) | A verification artifact must prove three things at once: it was done right, it matches the intent, and it is easier to review than reading the whole PR. For UI, usually a recording or screenshot. Her `/create-verification-skill` generates a "feature map" so the agent walks to every feature like a user. Verification is only an approximation and can also be wrong | `实测` |
| 5 | Thorsten Ball (Amp), [recording post](https://x.com/thorstenball/status/2110082835684200710), ["why still use PRs"](https://x.com/thorstenball/status/2111130129355481240) | The agent recorded an end-to-end demo video, and he asked whether review would change once there is a video. The main objection in replies: a video only proves the path the agent chose to record, so the untested cases should be listed too | `实测` |
| 6 | Guillermo Rauch (Vercel), [X](https://x.com/rauchg/status/2097134278358548658) | Review, testing and QA are the new bottleneck, and agent-browser supports 60fps recording. One reply suggests pairing recordings with a machine-readable record (steps, timestamps, console) | `实测` |
| 7 | openrijal and replies, [X](https://x.com/openrijal/status/2118375985057841177) | The agent took screenshots, but the images sat in the CI ZIP artifact, so the PR looked finished while the reviewer could not see them. The rule he added is that UI screenshots must be inline in the PR description. A reply adds: write the steps to reach the state next to the screenshot | `实测` |
| 8 | kerem, [X](https://x.com/kerem/status/2118145117559423464) | Every PR gets a pixel diff of the whole app, and on failure CI saves three images (before, after and diff), which Claude reads and then fixes | `实测` (author's own account) |
| 9 | r/Playwright SnapDrift, [post](https://www.reddit.com/r/Playwright/comments/1rrvidr/) | Publish screenshot baselines on main, compare PR screenshots with the latest successful baseline, pick routes by changed files, and update a drift summary with a PR comment. Comments: baselines on long-lived branches go stale, and a perceptual diff can replace them; others ask why not just use Playwright's own `toHaveScreenshot` | `实测` |
| 10 | r/mcp pr-ui-compare, [post](https://www.reddit.com/r/mcp/comments/1wolege/) | Build "before" in a temporary worktree and produce a side-by-side GIF for the PR description. Comments: reviewers look at the GIF and do not read the line "adjusted header spacing"; when used for a PR it should reject uncommitted changes, otherwise what is in the image may not be in the PR | `实测` |
| 11 | r/ExperiencedDevs [1qbrayz](https://www.reddit.com/r/ExperiencedDevs/comments/1qbrayz/), [1towli9](https://www.reddit.com/r/ExperiencedDevs/comments/1towli9/), [1s3f06x](https://www.reddit.com/r/ExperiencedDevs/comments/1s3f06x/); r/ClaudeCode [1st4wqk](https://www.reddit.com/r/ClaudeCode/comments/1st4wqk/) | A Claude Code pilot at a 6k-person company was swamped by review volume. A small win was marking low-risk zones in the codebase, where only tests and bot review run, plus a quick human glance. Comment suggestions: the author self-reviews first, and each review is limited to 15 minutes. Another post refuses to review AI PRs "the author cannot understand"; others say tests all pass but the architecture drifts slowly (someone mentioned ArchUnit). Common practice on r/ClaudeCode: small diffs, tests and lint first, a second session reviewing only the diff against a checklist, and high-risk PRs merged by a human | `实测` |

What the sources share: evidence must be **placed where the reviewer is standing** (inline on the PR page, not in an artifact bundle), must be **compared on both sides** (same input, same crop, same load), and must **state what is not covered**. [`推断`]

### B. Effect on this note's recommendations

| Item in this note | Changed? | Basis |
|---|---|---|
| Section 6 evidence card: Requirement -> Requests -> Before -> `Live / Mocked / Not covered` | **Unchanged, with two rules added**: (1) Before may only be taken from the base branch or live (the #3110 example used the ae86f0cb2 stack without that change, which complies); (2) the card must render on the PR page, not just give a CI artifact link | #1, #7, #10 [`推断`] |
| Section 6 card fields | **Suggest adding an optional line `Rollback:`**, required only when changing migrations, auth or billing. cairn's existing Risk section already covers Impact, so it is not added separately | #2 [`推断`] |
| Section 7 question 1: text or screenshots for backend evidence | Unchanged, still recommend text. #1 and #2 both require real output that is not retyped, and text meets that more easily | #1, #2 [`推断`] |
| Section 7 question 4: three coverage-label lines mandatory | Unchanged, with more reason: #1's "state what was not done" and #5's "list the untested cases" are exactly `Not covered` | #1, #5 [`推断`] |
| Section 7 question 7: CI full-page screenshots | **Changed** (see the revision marker in section 7): from "not for now" to "do a narrow version". The industry does run this, but always trimmed to the changed routes with results inline in PR comments, and nobody screenshots all 350 pages of the whole site | #8, #9, #10 [`推断`]; how much CI time cairn would need was not measured [`猜测`] |
| Section 4 video conclusion "screenshots work because CI generates them automatically" | Unchanged; #7 is a counterexample: auto-generated but put in the wrong place, equally useless | #7 [`推断`] |
| New question (for ian to decide) | **Should the first line of the PR state the author and review status** (for example `Written by <agent> for ian; ian has not reviewed it yet`)? Recommended: yes. The cost is one line, and the reviewer knows at a glance whether they are the first to look | #1 [`推断`] |

This increment contains no facts that contradict the earlier text; it changed only the access note at the start of section 5 and the recommendation of section 7 question 7, and both are marked "11-06 incremental revision".
