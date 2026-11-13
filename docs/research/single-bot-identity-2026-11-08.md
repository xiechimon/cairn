# One bot identity for xiechimon/cairn

Question (ian, 2026-11-08): the repository shows two bot identities on branches, PRs and commits. Should one go? Which one stays, and what has to change so that only one is needed?

Labels: `实测` means read or run first-hand in this session, `推断` means derived from `实测`, `猜测` means the rest.

## The two identities today

| Identity | Kind | Created | Used for | Evidence |
|---|---|---|---|---|
| `cairnwright[bot]`, id 347615582 | Bot user of the GitHub App `cairnwright` | 2026-10-25T02:45:25Z | Push auth, PR opener (`app/cairnwright`), committer in `as-bot.sh`, author of 61 main commits | `实测` `gh api users/cairnwright%5Bbot%5D`, `git log origin/main --format=%ae` |
| `cairnwright`, id 348051526 | Regular GitHub User (machine account), display name `Cairnwright` | 2026-10-26T00:10:38Z | Git author exported by `~/.cairn/tools/app-token/as-bot.sh`; author of 125 main commits (latest 2026-11-07) | `实测` `gh api users/cairnwright`, `as-bot.sh` lines 10–11, `git log` count |

The User account is not a repository collaborator (`实测` `gh api repos/xiechimon/cairn/collaborators` returns only `xiechimon`).

## Why the User account and the author ban exist

The reason is cosmetic. It is not Vercel, security, signing or code-owner review.

Timeline, all `实测`:

1. 2026-10-25, #1666: ian chose a GitHub App with the `[bot]` mark over a bot user account. The App was meant to open PRs so ian could approve them under Code Owners. The ticket says so: "Switch to a GitHub App identity (with the [bot] mark), not a bot user account" (#1666 body, translated).
2. 2026-10-25T03:45Z and 04:22Z, coordinator relays in the Mac session transcript: ian wanted a commit to look like `2f2536620`, showing "xiechimon and claude committed" with two avatars side by side. The coordinator asked for a User account `cairnwright` so commits would show "cairnwright (no [bot], spiral avatar)". ian registered it himself.
3. 2026-10-26T00:10Z, in the session transcript: ian replied "done" (in Chinese). An agent set the avatar and the display name. It switched `as-bot.sh` to author commits as the User, with the App as committer. Throwaway PR #1755, "co-author display check", confirmed the two-person display.
4. GitHub's squash merge writes the PR opener as author, so a squashed App-opened PR lands on main as `cairnwright[bot]` and the User-account author is lost. The GitHub changelog states the opener rule: "whoever opened the pull request became the sole author of the squash commit", and since then branch commit authors are added as co-authors ([changelog 2019-12-19](https://github.blog/changelog/2019-12-19-improved-attribution-when-squashing-commits/)). Incidents #2024, #2028, #2088 and #2136 show it happening here (`实测` on main commits `51cab1f0`, `4bbfe50e`, `c683123a`, `78b85594`).
5. To protect the User-account author, #1806 (2026-10-26T08:01Z, commit `4361feda1`) added `commit-author.yml`, which rejects `cairnwright[bot]` as author. Bot PRs now merge by rebase from exactly one commit, and squash is forbidden. The incidents then added the recovery recipes, `sign-commits.sh` (squash a lane to one commit), the single-commit check in `merge-pr.sh`, and the product merge API 409 for bot openers (#2127, `apps/server/src/services/builds.ts`). Every later rule protects the decision made in step 3 (`推断` from the order of the commits and PRs above).
6. 2026-10-31, plan decision D48 in the living plan, "decided (ian 10-31, confirmed)" (translated): bot commits are authored as `cairnwright[bot]` with `Cairn-Thread:` and `Co-authored-by: ian`. The plan's identity-switch row reads "delete the rejection in `commit-author.yml`; restore squash" and adds "you close the `cairnwright` regular account (non-blocking)" (translated). The compatibility half shipped in #2378/#2408. The switch itself, #2289, is still OPEN (`实测` `gh issue view 2289`). This research therefore confirms a decision that already exists. It is not a new design.

### The Vercel hypothesis is refuted

- Vercel's author check covers private repositories only: "commits on private Git repositories … will only be deployed if the commit author also has access to the respective project on Vercel"; "For public Git repositories, a different behavior applies" ([Vercel docs, Deploying Git repositories](https://vercel.com/docs/git)). `xiechimon/cairn` is public (`实测` `gh api repos/xiechimon/cairn --jq .visibility`).
- I tallied 107 Vercel commit statuses on main commits from 2026-10-24 to 2026-10-26: 52 "Deployment rate limited", 27 "deploying", 25 "Canceled by Ignored Build Step", 2 "completed", 1 "Skipped". None is an author or team-membership block (`实测`). `d2533d10e` gives the actual Vercel problem in its own message: PR previews hit the daily deployment cap. That is unrelated to authorship.
- The site no longer deploys through the Vercel Git integration. `site/vercel.json` sets `"git": { "deploymentEnabled": false }`, and `.github/workflows/site-deploy.yml` deploys with `vercel deploy --prod` from Actions using `VERCEL_TOKEN` (`实测`). The commit author can never block a deploy now, so Vercel needs no deploy hook or other fix.

## How others do it

| Source | Opener / author | Human credit | Merge method on main | Verified | Link |
|---|---|---|---|---|---|
| GitHub Copilot cloud agent | App identity; "commits are authored by Copilot" | The requester is "marked as the co-author" | Squash or any method | "commits are signed, so they appear as Verified" | [risks-and-mitigations](https://docs.github.com/en/copilot/concepts/agents/coding-agent/risks-and-mitigations) (`实测` docs) |
| Renovate (`renovatebot/renovate` PR #47844) | `renovate[bot] <29139614+renovate[bot]@users.noreply.github.com>`, committer `GitHub` | None | Squash; the main commit `77a892bc` is still authored by `renovate[bot]` | `verified=true` | `实测` `gh api repos/renovatebot/renovate/pulls/47844/commits`; [Renovate GitHub platform docs](https://docs.renovatebot.com/modules/platform/github/): when run as an App, `gitAuthor` is the App's noreply email |
| Dependabot (`dependabot/dependabot-core` PR #16535) | `dependabot[bot] <49699333+dependabot[bot]@…>`, committer `GitHub` | None | Squash | `verified=true` | `实测` `gh api repos/dependabot/dependabot-core/pulls/16535/commits` |
| GitHub machine-account rules | — | — | — | — | ToS B.3: "Accounts registered by 'bots' or other automated methods are not permitted"; a human may keep "no more than one free machine account". The User account is legal but redundant ([ToS](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service), `实测`) |
| GitHub bot signature rule | — | — | — | Bot signatures verify only for API requests "authenticated as the GitHub App … and contains no custom author information" | [commit signature verification](https://docs.github.com/en/authentication/managing-commit-signature-verification/about-commit-signature-verification) (`实测` docs) |
| Co-author trailers | — | A `Co-authored-by:` trailer with an email linked to the account counts as a contribution | — | — | [multiple authors](https://docs.github.com/en/pull-requests/committing-changes-to-your-project/creating-and-editing-commits/creating-a-commit-with-multiple-authors) (`实测` docs) |
| cairn spike #3409 (2026-11-07) | App commit via `PUT contents` | Author `cairnwright[bot]`; the `Co-authored-by: xiechimon` trailer is preserved | — | `verified: true`, committer `web-flow` | `docs/research/bot-identity-and-coauthorship-2026-11-07.md` (`实测` there) |
| cairn today | App opens the PR; the User authors the commit; ian's Mac identity commits the rebased result | `Co-authored-by: xiechimon` | Rebase from one commit for bot PRs, squash for human PRs | Local commits are `unsigned` under both identities (`实测` `4361feda1`, `f96a47408`) | this repo |

Every product with an agent or bot uses one App identity for opener, author and committer, credits the human with a trailer, and merges by squash. None runs a parallel user account for authorship (`推断` from the rows above).

## Recommendation

Use exactly one identity: the GitHub App `cairnwright` (`cairnwright[bot]`). It opens branches and PRs and authors every commit cairn writes. When ian instructed the work, the commit carries `Co-authored-by: xiechimon <id+login@users.noreply.github.com>`. The daemon already adds this trailer through `apps/daemon/src/step-attribution.ts` (#3413). Autonomous work carries no human trailer. This is D48 as ian confirmed it on 10-31, and #2289 is the ticket for it: reuse #2289 and do not open a new issue.

Root fix: the User account existed only so commits would display a `Cairnwright` name without the `[bot]` mark. Drop that cosmetic goal. GitHub then shows `cairnwright[bot]` with xiechimon as co-author, the same shape as Copilot (`推断`: co-author display works for any linked email; confirm with a screenshot in acceptance). Once the author is the opener, squash keeps the author, so the ban, the rebase rule and the single-commit rule all lose their purpose.

Signing (optional follow-up, not part of this change): locally made commits stay `unsigned`, as they are today. To get `Verified` like Renovate, Dependabot and Copilot, the push would have to become API commits (`createCommitOnBranch`) with no custom author. That is a separate design.

### What to change and delete in the same change

Host tools have two copies that already differ: the repository copy under `scripts/ops/host/tools/` and the live copy in `~/.cairn/tools/` on omarchy (`实测` `diff`). Change both, then redeploy the live copy and read it back.

1. `scripts/ops/host/tools/app-token/as-bot.sh` and the live copy: set `GIT_AUTHOR_*` and `GIT_COMMITTER_*` to `cairnwright[bot] <347615582+cairnwright[bot]@users.noreply.github.com>`, and delete the `348051526` author lines.
2. `as-bot-author.sh`: delete it. Once `as-bot.sh` authors as the bot it is redundant. Remove its row in `scripts/ops/host/README.md` and the guidance sentence asserted by `scripts/commit-author-policy.test.mjs:95`.
3. `scripts/ops/host/tools/merge-pr.sh` and the live copy: delete `ACCEPTED_BOT_AUTHORS`, `signed_bot_commit`, the `app/cairnwright` opener branch, the single-commit refusal and `--rebase`. Every PR uses one squash path.
4. `scripts/ops/host/lanes/sign-commits.sh` (the live copy on the host): delete the squash-to-one-commit step. At most, keep a step that adds the co-author trailer when it is missing. The daemon already does this, so deletion is fine.
5. `.github/workflows/commit-author.yml`: invert the check rather than delete the workflow. It should reject only the retired User email `348051526+cairnwright@users.noreply.github.com` in the checked range and drop the rebase guidance. Keeping the check name avoids editing two Mergify conditions and stops any stale host script from bringing the User back. That follows the rule "fix a repeated error with constraints, not more rules". The alternative is to delete the workflow and remove `check-success = commit-author` from both queues in `.mergify.yml` and `scripts/mergify-config.mjs`. Do not delete the workflow alone: both Mergify queues require that check (`实测` `.mergify.yml` lines 14 and 76), so the queues would stall.
6. `scripts/commit-author-recovery.test.mjs`: delete it, along with its step in the workflow. The #2101 and #2136 recovery recipes no longer apply.
7. `.mergify.yml` bot queue: change `merge_method: rebase` (line 120) to `squash`, and keep the `author = cairnwright[bot]` queue split. Update `scripts/mergify-config.mjs` to match.
8. `apps/server/src/services/builds.ts`: delete the `xiechimon/cairn` opener guard that returns 409 for bot or unknown openers. It is the block that says "requires a verified human opener". Bot-opened PRs then squash through the product API like any other PR.
9. Documentation, rewritten in the same PR:
   - `docs/ops/agent-bot-identity.md`: replace "Commit author" (around lines 64–101) and the #2101/#2136 recovery sections (lines 155–181) with one paragraph that states the single identity and the trailer rule.
   - `docs/pr-review.md`: lines 59–63, "Merge method by commit author".
   - `.claude/skills/pr-cairn/SKILL.md`: lines 141–144.
   - `CLAUDE.md` line 41: replace "`--squash` for a human-opened PR, `--rebase` for one opened by `app/cairnwright`" with squash for every PR.
   - `docs/lessons/2024-bot-pr-squash-authorship.md`: mark the safeguard retired by #2289.
   - Keep the #2101 and #2136 evidence as a historical record. It moved to `docs/research/assets/2101` and `docs/research/assets/2136` when `docs/verify/` was removed on 2026-11-12.
10. The User account `cairnwright` (348051526): leave it unused. Do not delete it now. Reasons: (a) deleting frees the username, and someone could register `cairnwright` next to the App and impersonate it (`猜测`, standard username-release behavior); (b) its 125 main commits would lose their profile link (`推断`); (c) only ian can sign in to delete it. ian should set a profile note that says "retired, see the cairnwright App", keep 2FA on and grant it no repository access. The plan's "you close the regular account (non-blocking)" stays optional and non-blocking. If ian still wants it gone, the steps are Settings → Account → Delete account while signed in as `cairnwright`, entering the password himself.

### Failure modes (tests first)

| # | Failure mode | Test to write first (red before the change) |
|---|---|---|
| F1 | `commit-author.yml` is removed or renamed while Mergify still requires it, and every queue stalls | `scripts/mergify-config.test.mjs`: every `check-success` named in `.mergify.yml` maps to an existing workflow job name |
| F2 | A stale host script still authors as the User, and a mixed identity returns | `scripts/commit-author.test.mjs`: a range containing a `348051526+cairnwright` author fails; `cairnwright[bot]` with a trailer passes; xiechimon passes |
| F3 | The live `~/.cairn/tools` copy drifts from the repository copy | `scripts/ops/host/identity-compat.test.mjs`: `as-bot.sh` exports the bot as both author and committer, and nothing in `scripts/ops/host/**` mentions `348051526`; after deploy, read the live file back on omarchy |
| F4 | `merge-pr.sh` still refuses multi-commit bot PRs or still uses rebase | `scripts/ops/host/merge-pr-queue.test.mjs`: a bot-opened PR with 3 commits takes the squash path, and `--rebase` never appears |
| F5 | The product API still returns 409 for App-opened PRs | Server test next to the #2127 cases in `apps/server/test/`: the nine bot or unknown-opener cases now issue the SHA-bound squash PUT and return 202 |
| F6 | Squashing a multi-commit bot PR drops the `Co-authored-by: xiechimon` trailer (`猜测`: GitHub builds the default multi-commit message from the PR title and commit list) | Acceptance on a live PR. If the trailer is missing, set a Mergify `commit_message_template` that carries co-author trailers |
| F7 | The policy docs and `CLAUDE.md` keep a rebase rule | `scripts/commit-author-policy.test.mjs` / `scripts/agent-rules.test.mjs`: no merge rule names `--rebase` for `app/cairnwright` |
| F8 | Code-owner review breaks | Not affected: the opener is still the App, so ian can approve. No test needed |

Live acceptance (#2289's own checklist): one App-opened PR with two commits passes through the Mergify queue by squash. Then read three things: the main commit's author is `cairnwright[bot]`, its message contains `Co-authored-by: xiechimon`, and the `commit-author` push run is green (record the URL). Take a screenshot of the commit page showing both avatars.

### Protected paths touched (`packages/shared/merge-gate-paths.json`)

- Protected:
  - `.github/workflows/commit-author.yml` (`.github/**`)
  - everything under `scripts/` (`**/scripts/**`), including `scripts/ops/host/**`
  - `CLAUDE.md` (`**/CLAUDE*.md`)
  - `.claude/skills/pr-cairn/SKILL.md` (`**/.claude/**`)
  - `docs/pr-review.md`
  - `docs/lessons/**`
- Auto-merge class: `apps/server/src/services/builds.ts`, `docs/ops/agent-bot-identity.md`.
- Not protected: `.mergify.yml`.
- No file is on the canonical security-surface lists (`credentials`, `machineAndCommandBoundary`, `externalEntryAuth`). The App private key and `token.mjs` do not change.
- The rule change in `CLAUDE.md` is covered by ian's D48 confirmation (10-31). The PR still needs the Codex cloud review on its head, because it touches protected paths.
