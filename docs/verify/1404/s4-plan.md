# P3 segment S4 plan: GitHub I/O for the merge-readiness gate (#1404)

Decisions: the default (bracketed) choice on all eight open questions in section 9, recorded on #1404 in comment 6339562372. S4 is split into S4a (transport, this branch) and S4b (gate shell, after #1479 merges).

Status: plan only, read-only step. Worktree `/home/user/pacman/.claude/worktrees/p3c`, branch `claude/bootstrap-p3-s4`, cut from origin/main `f45a36b`. Implementation starts after #1479 merges.

Sources read: `docs/spec/28` §3 (D1 to D4, D7) and §4 P3/P4; ADR 0021 (D3, D4, gate section); #1404 body and comments 6304303150, 6309587895, 6310264292, 6314008085; #1403 comments (P2 segment 2b design D); #1405 P4 plan (P4-0 `baseBehindBy`, open question 1); #1462 item 7; main `f45a36b`; #1479 at origin head `1174ebf` (round 2) and at the local round 3 head `39a108e` (worktree p3b, not yet pushed: it removes the `lib/github.ts` import and adds `apps/server/test/merge-gate-imports.test.ts`); P2 segment 2b in progress on local branch `claude/bootstrap-p2-seg2b` (adds `PUT pulls/{n}/merge`, the third api.github.com write).

## 1. What exists today (main `f45a36b`)

| Need | What is there | Gap for the gate |
|---|---|---|
| PR read | `apps/server/src/lib/github.ts:194-247` `githubPull`: conditional GET `pulls/{n}` through `conditionalGetJson` (`:157-189`), projects `state`, `merged`, `merge_commit_sha`, `merged_by`, `head.sha/ref/repo.id`, `base.ref/repo.id/default_branch/owner.login` (`GithubPull`, `:127-146`). Callers: `ci-loop.ts:636`; `githubPullState` (`:106-116`) for `builds.ts:843`. | No `draft`, `body`, `changed_files`, `mergeable_state`, `number`, `base.repo.full_name`, `head.repo.full_name`. The projection itself (for example "merged not boolean means unreadable", `:223-226`) is interpretation living outside D4 ④. |
| compare | `:253-279` `githubCompareStatus`: `compare/{base}...{head}?per_page=1`, both args must pass `isFullSha` (`:118-123`), returns only `status` or `'missing'`/`'invalid'`/null. Caller `ci-loop.ts:782`. | No files, no commits with parents, no `total_commits`, no paging, no `behind_by`. |
| Check runs | `:1263-1295` `githubCommitCheckRuns`: conditional GET `commits/{ref}/check-runs?per_page=100`, no paging (tail dropped, `:1253-1255`), malformed rows skipped silently (`:1284`), projects name/status/conclusion/output only. Caller `ci-loop.ts:947-955` reads by branch name `conversationBranch(cand.buildId)`. | No `head_sha`, `app.id`, `id`, `total_count`; no paging; reads by ref name. |
| Combined status | none | Needed: `commits/{sha}/status` with `sha`, `statuses[]`, `total_count`. |
| Required check list | none on main (a stale draft `githubRequiredChecks` exists only on the abandoned branch `claude/bootstrap-p2c`) | `GateInputs.checks.required` has no source. |
| File presence at a SHA (raw 404) | none | Handed to S4 by readiness (round 3 `readiness.ts:422`, pinned by test `readiness 不判链接的文件在那个提交上是否已存在（raw 404）：交给 S4 外壳`, round 3 test line 1161). |
| Commit status write | none. Writes today: `githubCreateIssue` `:1200`, `githubUpdateIssueTitle` `:1217`, both through `writeJson` (`:1171-1195`, POST/PATCH only); header exhaustive-write rule `:13-16` (`唯二`). P2 segment 2b adds `PUT pulls/{n}/merge` as the third and rewrites the header to `只此三处`. | The status POST becomes the fourth api.github.com write endpoint. |
| Failure classes | `GithubListFailure` (`:648-653`: timeout, network, rate-limited, status, malformed) with `getListPage` (`:696-728`); `GithubRateLimitedError` (`:420-438`) with reset and retry-after parsing in `intakeGet` (`:912-950`); `isRateLimited` / `isRateLimitedResponse` (`:399-415`); `nextPageUrl` (`:968-974`). | Reusable; the gate needs the rate-limit timing on reads. |
| Gate source | `services/merge-gate/{digest,evidence-link,paths,readiness}.ts`; `compareFilesFromResponse` (`digest.ts:100`) already turns a compare body into `CompareFile[]`; `parseRawEvidenceLinks` (`evidence-link.ts:82`). Main's `GateInputs.compare` is still `{files, commits: string[]}` (`readiness.ts:96`); #1479 replaces it. | No I/O shell. |
| Tables | S3 (#1469): `gate_digest`, `gate_round`, `gate_verdict`, `gate_state` (`db/schema.ts:806-913`). | `gate_state` has no "last status written" column. S4 does not need one (section 4.6). |

## 2. Constraints that shape S4

1. **#1479 round 3 import test** (`merge-gate-imports.test.ts` at `39a108e`): a module under `merge-gate/` may import only `@pacman/shared` (and only runtime names that are the very values of `records/merge-gate.ts`), `node:crypto`, and paths inside `merge-gate/`. The compiled JS may not contain `import(`, `require(`, `import.meta`, `createRequire`, `eval`, `Function`, `constructor`, `process`, `globalThis`, even inside string literals. Consequences: the shell cannot import `lib/github.ts`, cannot use the global `fetch`, cannot declare a class with a constructor, and cannot import `conversationBranch` or other shared helpers. All GitHub I/O reaches the gate through an injected port.
2. **ADR 0021 D4 ④**: everything that decides what a GitHub response means sits in `merge-gate/**` or `records/merge-gate.ts`. `lib/github.ts` is in the auto-merge set (#1462 item 7, P4 open question 1).
3. **#1479 contract** (round 3 text at the `GateInputs` declaration):
   - `pr.headSha` passed as GitHub gave it; readiness judges its form.
   - `compare`: every page requested with the same `{head}` SHA, by SHA, never by branch name, never through a URL-keyed cache; `files` only from page 1; `commits` as read (sha plus `parents[].sha`), no dedupe, no sort; `totalCommits` = page 1's `total_commits`, and any page whose `total_commits` differs makes the whole compare `'unreadable'`; `'malformed'` when `compareFilesFromResponse` returns null or commits are not `{sha, parents}`.
   - `checks`: `headSha` = the SHA requested; `runs[].headSha` = each run's `head_sha`; `statusSha` = the combined status `sha`; runs deduped per (app, name) keeping the latest, never per name only; statuses deduped per context; `complete` = all pages of both read; `required: null` when the list cannot be read.
4. **P4-0** adds `GateInputs.pr.baseBehindBy` and says "S4 fills it from the compare response it already reads for the digest".
5. **P2 segment 2b** is editing the `lib/github.ts` header and rate-limit helpers (`isRateLimitedText`). Whichever lands first, the other rebases.

## 3. Shape: two PRs

- **S4a, transport** (`lib/github.ts` and its tests only). Ordinary product source: under D7 it can take auto-merge after a pr-gate go, unless the user decides #1462 item 7 the other way. It does not depend on #1479.
- **S4b, gate shell** (`merge-gate/**`, a readiness input change, tests, fake GitHub helper). D4 ④, user merge. Depends on #1479 and S4a.

No caller is added in either. S6a wires the shell into the evaluator; S7 wires the status writer into the scheduler.

## 4. Design

### 4.1 Transport in `lib/github.ts` (S4a)

One private helper and thin named functions. They build the URL from the arguments the caller passes and return the response unread: no field of a body is interpreted here. Every parameter that changes what the gate sees (`per_page`, `page`, `filter`) is an explicit argument from the gate, with no default in `lib/github.ts`, so a change to it is a change in gate source.

```ts
export type GithubRawResult =
  | { kind: 'ok'; status: number; etag: string | null; link: string | null; body: unknown }
  | { kind: 'not-modified' }                       // 304, and only when If-None-Match was sent
  | { kind: 'failed'; failure: GithubRawFailure };

export type GithubRawFailure =
  | { kind: 'invalid' }                             // argument refused locally, no request sent
  | { kind: 'timeout' }
  | { kind: 'network' }
  | { kind: 'rate-limited'; status: number; resetAt: number | null; retryAfterSeconds: number | null }
  | { kind: 'status'; status: number; message: string | null }   // other non-2xx; message = GitHub's `message`, control chars stripped, max 200
  | { kind: 'not-json' };                           // 2xx whose body is not JSON
```

| Function | Request | Local argument checks |
|---|---|---|
| `githubPullRaw(f, token, o, r, n, {etag, timeoutMs})` | `GET repos/{o}/{r}/pulls/{n}`, `If-None-Match` when etag given | `n` positive safe integer |
| `githubBranchRaw(f, token, o, r, branch, {etag, timeoutMs})` | `GET repos/{o}/{r}/branches/{branch}` | branch non-empty; each `/`-separated segment `encodeURIComponent`'d; no `.`/`..`/empty segment |
| `githubBranchRulesRaw(f, token, o, r, branch, {page, perPage, etag, timeoutMs})` | `GET repos/{o}/{r}/rules/branches/{branch}?per_page=&page=` | as above; `1 <= perPage <= 100`, `page >= 1` |
| `githubCompareRaw(f, token, o, r, baseSha, headSha, {page, perPage, timeoutMs})` | `GET repos/{o}/{r}/compare/{baseSha}...{headSha}?per_page=&page=`, never conditional | both 40 lowercase hex (URL hygiene only; the gate checks again in its own source) |
| `githubCheckRunsRaw(f, token, o, r, sha, {filter, page, perPage, etag, timeoutMs})` | `GET repos/{o}/{r}/commits/{sha}/check-runs?filter=&per_page=&page=` | sha 40 hex; filter `latest` or `all` |
| `githubCombinedStatusRaw(f, token, o, r, sha, {page, perPage, etag, timeoutMs})` | `GET repos/{o}/{r}/commits/{sha}/status?per_page=&page=` | sha 40 hex |
| `githubContentsRaw(f, token, o, r, path, ref, {timeoutMs})` | `GET repos/{o}/{r}/contents/{path}?ref={ref}` | ref 40 hex; path segments encoded one by one, no `.`/`..`/empty, no control char, `?`, `#` or NUL in a decoded segment |
| `githubCreateCommitStatus(f, token, o, r, sha, {state, context, description}, {timeoutMs})` | `POST repos/{o}/{r}/statuses/{sha}`, JSON body exactly `{state, context, description}` (no `target_url`) | sha 40 hex; state in the four documented values; returns `{kind:'ok', status:201, body}` or a failure, never throws |

Common rules:
- Token is required (string) and goes only into `Authorization: Bearer`; URLs never carry it, failures never carry a URL. The gate does not run anonymously: it would spend the 60 per hour per-IP budget that `ci-loop` and the #931/#1217 guards share.
- Headers: the existing `API_HEADERS` (`application/vnd.github+json`, API version `2022-11-28`). Under that media type the PR `body` is the raw markdown the evidence parser expects.
- Conditional GET: the caller passes the etag; a 304 without a sent etag is `failed/status 304`, as `intakeConditionalGet` does (`:961`).
- Rate limit: 429, or 403 with `x-ratelimit-remaining: 0`, `retry-after`, or "rate limit" in the text, gives `rate-limited` with `x-ratelimit-reset` (ms) and `retry-after` (s) parsed as in `intakeGet`. The body text is read at most once.
- Single attempt, no retry, no redirect following beyond what `fetch` does; pages are requested by number, `Link` is only returned to the caller.
- `timeoutMs` passed by the caller (the gate uses 10 s so a seven-read evaluation stays well under a minute).
- The header's exhaustive-write list gains `POST repos/{o}/{r}/statuses/{sha}` (fourth, after P2 2b's merge PUT).
- `githubPull`, `githubCompareStatus`, `githubCommitCheckRuns` and the ci-loop are not changed.

### 4.2 Port and wiring

`merge-gate/github-port.ts` (type-only module) declares what the shell needs, structurally identical to the transport functions above with `fetch`, `token`, `owner`, `repo` already bound:

```ts
export interface GateGithubPort {
  pull(n: number, o: { etag: string | null }): Promise<GateRaw>;
  branch(name: string, o: { etag: string | null }): Promise<GateRaw>;
  branchRules(name: string, o: { page: number; perPage: number; etag: string | null }): Promise<GateRaw>;
  compare(base: string, head: string, o: { page: number; perPage: number }): Promise<GateRaw>;
  checkRuns(sha: string, o: { filter: 'latest'; page: number; perPage: number; etag: string | null }): Promise<GateRaw>;
  combinedStatus(sha: string, o: { page: number; perPage: number; etag: string | null }): Promise<GateRaw>;
  contents(path: string, ref: string): Promise<GateRaw>;
  createStatus(sha: string, p: { state: GateStatusState; context: string; description: string }): Promise<GateRaw>;
}
```

`GateRaw` is declared in the gate with the same shape as `GithubRawResult`. `lib/github.ts` does not import the gate (lib layer has no upward imports) and the gate does not import lib; TypeScript checks the structural fit at the wiring site. S4b adds a test (outside `merge-gate/`) that binds the real S4a functions over a fake `fetch` serving recorded responses and runs the shell end to end, so a drift between the two is a compile or test failure. The production binding is written by S6a.

### 4.3 The shell: `merge-gate/github-facts.ts` (S4b)

`readGateGithubFacts(port, req, cache): Promise<GateGithubFacts>`, where `req = {owner, repo, prNumber, ticketRef}` and `cache` is a caller-owned map of `{etag, body}` per request key (only for the conditional reads listed below). All reads are serial. The function never throws: a port that throws is treated as a `network` failure.

Output:

```ts
interface GateGithubFacts {
  pr: GateInputs['pr'];               // null = unreadable or not self-identifying
  defaultBranch: string | null;       // -> GateInputs.repo.defaultBranch
  checks: GateInputs['checks'];
  compare: GateInputs['compare'];
  evidence: GateEvidencePresence[];   // new readiness input, 4.5
  baseBehindBy: number | null;        // compare.behind_by, for P4-0
  ownStatus: { state: string; description: string | null } | null | 'unreadable';  // for 4.6
  rateLimited: { retryAt: number | null } | null;
  notes: string[];                    // why an input is unreadable (logs, not GateInputs)
}
```

S6a fills the rest of `GateInputs` from the database (policy, build, ticketRef, issueNumber, verdicts, round, availability).

Read order and rules:

1. **PR** `pull(n)`, conditional. On 304 the cached raw body is re-projected (the projection is never cached, so a gate change applies to cached bodies too); 304 with no cache entry is unreadable. Projection, each failure giving `pr: null` with a note:
   - `number === prNumber`; `base.repo.full_name` equals `owner/repo` case-insensitively (a renamed or transferred repo, or a response for another resource, does not count);
   - `state` open/closed, `merged` boolean, `draft` boolean (missing is unreadable, never defaulted to false), `changed_files` non-negative integer, `head.sha`, `head.ref`, `base.ref` strings;
   - `body` string, or null mapped to `''`; `head.repo` null maps to `headRepoFullName: null` (readiness: `pr-from-fork`);
   - `mergeable_state` string, otherwise null ("GitHub still computing");
   - `headSha` passed through as given; `defaultBranch` from `base.repo.default_branch` (null when absent).
   If `pr` is null or its head is not 40 lowercase hex (checked with the gate's own `FULL_SHA`), the shell reads nothing further: `compare: 'unreadable'`, `checks: null`, `evidence: []`.
2. **Base branch** `branch(pr.baseRef)`, conditional. Gives the base tip `commit.sha` (must be 40 hex, else compare is unreadable) and the classic protection: `protected: false` gives no classic contexts; `protected: true` with `protection.required_status_checks` gives `checks[] {context, app_id}`; `protected: true` without a readable `protection` object gives `required: null`.
3. **Rules** `branchRules(pr.baseRef, page)`, `per_page=100`, pages until a page has fewer than 100 entries (no `total_count` on this endpoint), cap 5 pages. `required_status_checks` rules contribute `{context, integration_id}`; other rule types are ignored; a malformed `required_status_checks` rule, any failed page, a 404, or the cap gives `required: null`. Required = union of classic and ruleset contexts, exact-name dedupe; the app bindings are kept internally for step 5.
4. **Compare** `compare(baseTip, pr.headSha, page)`, `per_page=100`, never conditional, never cached.
   - Page 1: `files = compareFilesFromResponse(body)`; null is `'malformed'`. `total_commits` must be a non-negative integer, else `'malformed'`. `commits[]` must each be `{sha: string, parents: [{sha: string}]}`, else `'malformed'`. `behind_by` (non-negative integer, else null) goes to `baseBehindBy`.
   - Pages 2..n while the collected count is below `total_commits`, cap 10 pages (1,000 commits). Each page must carry the same `total_commits` as page 1, else `'unreadable'`; files on later pages are ignored; an empty page stops the loop and the short list is passed as read; any failed page makes the whole compare `'unreadable'` (no partial files).
   - Output `{headSha: pr.headSha, files, commits (as read), totalCommits}`; readiness checks the SHAs' form, completeness, and the response's own head.
5. **Check runs** `checkRuns(pr.headSha, {filter: 'latest', page})`, `per_page=100`, cap 10 pages. Page 1 conditional only if the cached page 1 was the whole list (`total_count <= 100`). Every run must have string `name`, `status`, `head_sha`, integer `id`, and `app` null or `{id: integer}`; one bad entry makes `checks: null` (unlike `githubCommitCheckRuns`, nothing is skipped). `complete = false` when the collected count differs from `total_count`, a page's `total_count` differs from page 1's, or the cap is hit.
   - Dedupe per `(app.id or 'none', name)`, keeping the greatest `id` (the most recently created run; see fact F2 and assumption A2).
   - Order: for each required context bound to an app, that app's run is placed first, because readiness takes the first run by name (`readiness.ts` `checks.runs.find`). Other same-name runs stay in the list, so a failing one still reaches readiness's `mergeable-state` "not passing" rule.
6. **Combined status** `combinedStatus(pr.headSha, page)`, `per_page=100`, cap 5 pages, page 1 conditional under the same rule as check runs. `sha` must be a string and equal on every page (else `checks: null`), `state` string, `statuses[]` entries with string `context` and `state`; `statusSha` = page 1's `sha`. `complete = false` when the count differs from `total_count` or the cap is hit. Dedupe by lowercased context (contexts are case-insensitive, F4), keeping the latest `updated_at`, and on a tie the entry that is not `success`. The entry whose lowercased context is `MERGE_GATE_STATUS_CONTEXT` is also copied to `ownStatus` (with its `description`); it stays in `statuses` because readiness needs it for the `unstable` exemption.
7. **Evidence presence** (4.5).

Any `rate-limited` failure stops the evaluation: the inputs not yet read are unreadable, and `rateLimited.retryAt` is set from `retry-after` first, else `x-ratelimit-reset`.

### 4.4 Shell faults

#1479's Risk leaves the classification of deterministic shell faults to S4. Plan: no new blocker codes. A response that does not identify itself, a malformed PR or check SHA, or an over-cap list all stay transient (`pr-unreadable`, `required-checks-unreadable`, `patch-unavailable`), and the shell's note says which. A malformed compare body stays human (`compare-malformed`, as readiness already does). This is the side that never passes; the cost is a PR that waits until a person looks. See open question 7.

### 4.5 Evidence presence at the linked commit (S4b, readiness change)

- New `GateInputs.evidence: { sha: string; path: string; present: boolean | null }[]` (required field, so every caller decides).
- `evidence-link.ts` gains `qualifyingEvidenceLinks(body, {owner, repo, ticketRef}, compare)`: links pinned at a commit of `compare.commits` to a path the compare adds or changes (status not `removed`). Readiness switches to this helper, so the shell and readiness use one rule.
- The shell probes qualifying links in body order, at most 5 distinct `(sha, directory)` pairs per evaluation, and stops at the first present file. Probe: `contents(dirname(path), sha)` (a directory listing returns metadata only, while a file read returns up to 1 MB of base64). Present = an entry with `type: 'file'`, exact `name` and exact `path`. 200 without the entry gives false, except when the listing has 1,000 entries (the documented directory cap, F9), which gives null. 404 gives false. Any other failure gives null. A present result is memoized per `(owner/repo, sha, path)` for the process lifetime (a commit's tree never changes); absent and unknown results are not memoized.
- Readiness: `evidence-link-missing` unless some qualifying link has `present === true`; the detail says "not at the linked commit" or "presence unreadable". The test `readiness 不判链接的文件……交给 S4 外壳` is rewritten to the new input, with a true and a false leg.

### 4.6 The `pacman/merge-gate` commit status

S4a ships the transport `githubCreateCommitStatus`. S4b ships, in `merge-gate/gate-status.ts`:
- `gateStatusFor(readiness)`: `ready` gives `success`; any blocker of class `human` or `policy` gives `failure`; only `transient` blockers give `pending`; `error` is never written. Description: ready gives `ready, patch <first 12 hex of the digest>`; otherwise `<first.label> (<first.code>)`, plus ` +N` for the other blockers. No blocker detail (names come from PR authors), no `target_url` (the server URL is tailnet-only). Truncated to 140 code points (assumption A1). Context is always the constant `MERGE_GATE_STATUS_CONTEXT`.
- `planGateStatusWrite({policy, readiness, facts})` returns `skip` with a reason, or `write {sha, payload}`. Skips: policy `human` (always, whatever the environment; P3 production policy is the constant `human`, so production never writes); `readiness.headSha` null; `facts.checks.headSha` differs from `readiness.headSha` (the change check must compare against the same commit); `ownStatus === 'unreadable'` (no blind writes); the current own status already has the same state and description.
- `writeGateStatus(port, plan)`: one `createStatus` call, the raw result passed back, no retry.

"Only when the value changes" is answered by GitHub itself: the combined status read at the head already returns the current `pacman/merge-gate` entry, so S4 needs no database column and the rule holds across server restarts. A value written by someone else (an agent with `gh`) differs from the gate's and is overwritten on the next evaluation.

S7 owns: the scheduler call, the per-team rate limit (GitHub's secondary limit is 80 content-generating requests per minute and 500 per hour, and GitHub advises at least one second between mutative requests; proposed limit: serial, at least 2 s apart, at most 120 writes per team per hour, at most 20 per SHA tracked in memory, under GitHub's 1,000 per SHA and context), the handling of 403/404 (token user without push access: stop writing for that team and notify), and the integration test `pacman/merge-gate status 写入 head SHA 的集成测试（假 GitHub）` from #1404's acceptance list.

### 4.7 Request budget per evaluation

Steady state for a PR with under 100 commits, checks and contexts: PR (304 is free when authorized), branch (304), rules (304), compare (always counted), check runs page 1 (304 when unchanged), combined status page 1 (304 when unchanged), at most one contents probe until a present result is memoized. That is 1 to 7 counted requests, typically 1 to 3. At a 60 s cadence that is up to 420 per hour per build against the token's 5,000 per hour, which the team's ci-loop and intake also use. S6a and S7 must bound the cadence (for example, re-run the compare only when the PR or base tip etag changed, keyed by the SHA pair, if the user accepts that reading of "no URL cache", open question 8).

## 5. GitHub facts relied on

Checked with WebFetch on 2026-10-22 against the REST docs for API version 2022-11-28.

- **F1 Compare two commits**, https://docs.github.com/en/rest/commits/commits?apiVersion=2022-11-28#compare-two-commits
  - "When calling this endpoint without any paging parameter (per_page or page), the returned list is limited to 250 commits, and the last commit in the list is the most recent of the entire comparison."
  - "To process a response with a large number of commits, use a query parameter (per_page or page) to paginate the results."
  - "The list of changed files is only shown on the first page of results, and it includes up to 300 changed files for the entire comparison."
  - "The results are returned in chronological order, but the last commit in the returned list may not be the most recent one in the entire set if there are more pages of results."
  - `per_page`: "The number of results per page (max 100)." Default 30; `page` default 1.
  - `total_commits` is a required integer with no description. Measured (#1479 evidence `docs/verify/1404/s2-r10-github-shapes.txt` at `1174ebf`): it equals the count of commits across all pages (399 over four pages of 100) and equals `ahead_by` on a diverged compare; files appear only on page 1, and page 1 of a 399-commit range carries exactly 300 files.
  - `files[]`: `sha` string or null; `status` one of added, removed, modified, renamed, copied, changed, unchanged; `patch` optional; `previous_filename` optional.
  - Fine-grained permission: "Repository permissions for Contents", read (https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens?apiVersion=2022-11-28).
- **F2 List check runs for a Git reference**, https://docs.github.com/en/rest/checks/runs?apiVersion=2022-11-28#list-check-runs-for-a-git-reference
  - "Lists check runs for a commit ref. The ref can be a SHA, branch name, or a tag name."
  - "If there are more than 1000 check suites on a single git reference, this endpoint will limit check runs to the 1000 most recent check suites."
  - "OAuth app tokens and personal access tokens (classic) need the repo scope to use this endpoint on a private repository."
  - `filter`: default `latest`, values `latest`, `all`: "Filters check runs by their completed_at timestamp. latest returns the most recent check runs."
  - `per_page`: "The number of results per page (max 100)." Default 30.
  - Response: `total_count`, `check_runs[]` with required `id`, `head_sha`, `status` (queued, in_progress, completed, waiting, requested, pending), `conclusion` (success, failure, neutral, cancelled, skipped, timed_out, action_required, null), `app` (GitHub App or null), `started_at`, `completed_at`, `check_suite`.
  - Measured (same evidence file): every run carries `head_sha`; `pr-evidence` appears twice from the same app in two check suites even under the default `filter=latest`. So `latest` does not dedupe across suites, and the shell must.
- **F3 Get the combined status for a specific reference**, https://docs.github.com/en/rest/commits/statuses?apiVersion=2022-11-28#get-the-combined-status-for-a-specific-reference
  - "Users with pull access in a repository can access a combined view of commit statuses for a given ref."
  - "The ref can be a SHA, a branch name, or a tag name."
  - "Additionally, a combined state is returned. The state is one of: failure if any of the contexts report as error or failure; pending if there are no statuses or a context is pending; success if the latest status for all contexts is success".
  - Response fields `sha`, `state`, `statuses`, `total_count`; `per_page` max 100, default 30.
  - Measured: `sha` is present with zero statuses (`state: pending`, `total_count: 0`); read by branch name, `sha` is the commit the branch pointed at.
  - Not stated: that `statuses` holds only the latest entry per context. The shell dedupes itself.
- **F4 Create a commit status**, https://docs.github.com/en/rest/commits/statuses?apiVersion=2022-11-28#create-a-commit-status
  - "Users with push access in a repository can create commit statuses for a given SHA."
  - "there is a limit of 1000 statuses per sha and context within a repository. Attempts to create more than 1000 statuses will result in a validation error."
  - `state` (required): `error`, `failure`, `pending`, `success`.
  - `context`: "A string label to differentiate this status from the status of other systems. This field is case-insensitive." Default `default`.
  - `description`: "A short description of the status." No length is documented.
  - Response 201.
  - Fine-grained: "Repository permissions for Commit statuses", write; the combined status read is "Commit statuses", read.
- **F5 OAuth scopes**, https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps
  - `repo`: "Grants full access to public and private repositories including read and write access to code, commit statuses, ..."
  - `repo:status`: "Grants read/write access to commit statuses in public and private repositories."
  - "They do not grant any additional permission beyond that which the user already has."
  - The team connection requests `read:user repo` (`services/oauth.ts:152`), which covers every read and the status write; the connected user still needs push access for the write (F4).
- **F6 Get a pull request**, https://docs.github.com/en/rest/pulls/pulls?apiVersion=2022-11-28#get-a-pull-request
  - The `mergeable` value "can be true, false, or null"; null means a background job is computing it.
  - Default media type: "Returns the raw markdown body. Response will include body."
  - `body` string or null; `changed_files`, `commits`, `additions`, `deletions` integers; `mergeable_state` string; `draft` boolean (not marked required); `head.repo` documented as non-null, but null when a fork is deleted (existing code note at `lib/github.ts:136-137`).
  - Statuses 200, 304, 404, 406, 500, 503.
- **F7 Get a branch**, https://docs.github.com/en/rest/branches/branches?apiVersion=2022-11-28#get-a-branch
  - `protection.required_status_checks` has `contexts` (string array), `checks[] {context, app_id (integer or null)}`, `enforcement_level`, `strict`.
  - `branch`: "The name of the branch. Cannot contain wildcard characters."
  - Measured 2026-10-22, anonymous `GET repos/xiechimon/pacman/branches/main`: `protected: true`, contexts `check, pack-smoke, e2e-gate, pr-evidence`, each with `app_id` 15368, `enforcement_level: non_admins`.
- **F8 Get rules for a branch**, https://docs.github.com/en/rest/repos/rules?apiVersion=2022-11-28#get-rules-for-a-branch
  - "Returns all active rules that apply to the specified branch."
  - "Rules in rulesets with "evaluate" or "disabled" enforcement statuses are not returned."
  - `per_page` max 100, default 30.
  - Rule `required_status_checks` has `parameters.required_status_checks[] {context, integration_id}`, where `integration_id` is "The optional integration ID that this status check must originate from."
  - Fine-grained: Metadata, read.
  - Measured 2026-10-22: `[]` for `xiechimon/pacman` main (no rulesets).
- **F9 Get repository content**, https://docs.github.com/en/rest/repos/contents?apiVersion=2022-11-28#get-repository-content
  - "This API has an upper limit of 1,000 files for a directory."
  - `ref`: "The name of the commit/branch/tag."
  - A directory gives "an array of objects, one object for each item in the directory".
  - Files over 1 MB need the raw or object media type.
- **F10 Troubleshooting required status checks**, https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks
  - "If a check and a commit status have the same name, both must pass when that name is required."
  - "A protected branch can also require a status check from a specific GitHub App."
  - "Successful check statuses are `success`, `skipped`, and `neutral`."
  - "Required checks must pass on the latest commit SHA."
  - Readiness already matches these; the app binding is why the shell orders runs (step 5).
- **F11 Best practices**, https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api?apiVersion=2022-11-28
  - "Making a conditional request does not count against your primary rate limit if a `304` response is returned and the request was made while correctly authorized with an `Authorization` header."
  - "To avoid exceeding secondary rate limits, you should make requests serially instead of concurrently."
  - "If you are making a large number of `POST`, `PATCH`, `PUT`, or `DELETE` requests, wait at least one second between each request."
  - On rate-limit errors: honour `retry-after`, or wait until `x-ratelimit-reset` when `x-ratelimit-remaining` is 0.
- **F12 Rate limits**, https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api?apiVersion=2022-11-28
  - User budget 5,000 per hour, shared with every OAuth app acting for that user.
  - Unauthenticated 60 per hour per IP.
  - "no more than 80 content-generating requests per minute" and "no more than 500 content-generating requests per hour".
  - Exceeding a limit returns 403 or 429.

Assumptions not covered by the docs, to be captured live into `docs/verify/1404/` during S4:
- **A1** The description limit is 140 characters. Undocumented; reported by third parties: Zuul (https://opendev.org/zuul/zuul/commit/fb6cc99768104e40bc3c709dfe8a0c8ad09e6123) and ofborg (https://git.lix.systems/the-distro/ofborg/commit/5730914971c1f5e660aa1b3e7d4ccf5db2f36e76). The plan truncates at 140 code points either way. A live 422 probe needs a status write, so it waits for the user's OK and a drill repo.
- **A2** For two runs with the same app and name in different suites, GitHub's rollup uses the most recently created one. Capture a PR where an earlier `pr-evidence` suite failed and a later one passed, and compare with that head's `mergeable_state`.
- **A3** The combined status `statuses[]` is already one entry per context. The shell does not rely on it.

## 6. Failure modes (tests written first)

Transport (S4a, `apps/server/test/github-gate-transport.test.ts`):
1. The token appears in a URL, a failure object or a thrown error. It goes only in the Authorization header.
2. A SHA that is not 40 lowercase hex, or a branch or path segment with `..`, `.`, an empty segment, `?`, `#`, NUL or a control character, reaches the request path. The function returns `invalid` and sends no request.
3. A 304 is reported as not-modified when no etag was sent.
4. A 2xx body that is not JSON throws instead of returning `not-json`.
5. 429, or 403 with `x-ratelimit-remaining: 0`, `retry-after`, or "rate limit" in the text, is not `rate-limited`; reset and retry-after are wrong when the headers are empty or non-numeric; a plain 403 is reported as rate-limited.
6. A timeout or abort is reported as `network`, or a network `TypeError` as `timeout`.
7. Query parameters are missing or defaulted inside lib: compare without `per_page` (GitHub then caps the list at 250 commits, F1), check runs without the caller's `filter`, any read without the caller's `page` and `per_page`.
8. The status POST uses the wrong method or content type, sends `target_url` or extra fields, or mangles `state`, `context` or `description`; it retries; it throws on 422 instead of returning `status 422` with GitHub's message (control characters stripped, length capped).
9. A `Link` header to a host other than api.github.com is followed; transport only returns it.
10. The existing `githubPull`, `githubCompareStatus` and `githubCommitCheckRuns` behaviour changes (the `pr-reconcile` and `ci-loop` suites stay green).

Shell, PR (S4b, `merge-gate-github-facts.test.ts`, recorded shapes plus a stateful fake GitHub):
11. A response for another PR number, or whose `base.repo.full_name` differs from the project's repository, is used.
12. A missing or wrongly typed `state`, `merged`, `draft`, `changed_files`, `head.sha`, `head.ref`, `base.ref` or `base.repo.full_name` is defaulted instead of giving `pr: null`; in particular a missing `draft` must not become `false`.
13. `body: null` is treated as unreadable instead of `''`; `head.repo: null` throws instead of giving `headRepoFullName: null`.
14. A missing or null `mergeable_state` becomes anything other than null.
15. A 304 reuses a stored projection instead of re-projecting the cached body; a 304 with no cache entry is used.
16. With a malformed or missing PR head, the shell still requests compare or checks (with the bad value or a branch name).

Shell, compare:
17. Compare is requested with a branch name, or a later page with a different base or head than page 1 (asserted on the fake's request log); compare is sent conditionally or served from a cache.
18. An unreadable or malformed base tip falls back to a branch-name compare instead of `'unreadable'`.
19. Files are taken from a page other than 1, or concatenated across pages.
20. A `total_commits` that is not a non-negative integer passes; a page whose `total_commits` differs from page 1's does not make the compare `'unreadable'`.
21. Only page 1 is read when `total_commits` exceeds 100; or the loop does not stop at an empty page or the 10-page cap.
22. Commits are deduped, sorted or repaired before being passed (the contract wants them as read, so readiness can see inconsistent paging).
23. A commit entry without `sha` or `parents[].sha` passes instead of giving `'malformed'`; `compareFilesFromResponse` returning null gives anything but `'malformed'`.
24. One failed page leaves partial files or commits in the result instead of `'unreadable'`.
25. A push between two page reads (the fake moves the branch after page 1) is hidden by the shell; the test pins that the pages are passed as read and that readiness then reports `patch-unavailable`.
26. `behind_by` is not passed as `baseBehindBy`, or a non-integer is passed as a number.

Shell, checks:
27. Check runs or the combined status are read by branch name; `checks.headSha` is not the SHA requested; `runs[].headSha` or `statusSha` is copied from the request instead of the response.
28. With more than 100 runs or contexts, only page 1 is read; a count short of `total_count`, differing `total_count` across pages, or the page cap does not set `complete: false`; a combined status page with a different `sha` is accepted.
29. Runs with the same name from different apps are collapsed into one.
30. Runs with the same app and name from different suites (`pr-evidence` twice, measured) are both passed; or the older one wins over the newer.
31. A required context bound to an app (classic `app_id`, ruleset `integration_id`) is judged on a same-named run from another app because that run comes first.
32. A malformed run or status entry is skipped instead of making `checks: null`.
33. Status contexts that differ only in case are kept as two; on equal `updated_at` the success is kept over the failure.
34. The own `pacman/merge-gate` status is dropped from `statuses` (readiness needs it for the `unstable` exemption) or not copied to `ownStatus`.
35. Required list: a failed branch read gives `[]` instead of null; `protected: false` gives null instead of `[]`; `protected: true` without `protection` gives `[]`; a rules 404, a failed rules page or the rules cap gives `[]`; rule types other than `required_status_checks` add names; the classic and ruleset lists are not unioned.

Shell, evidence presence and readiness change:
36. A link pinned at an earlier PR commit where the file did not exist yet (raw 404) counts as evidence.
37. Links that do not qualify (commit outside the PR, path not added or changed) are probed; probing goes on after a present file; more than 5 probes per evaluation.
38. A contents 404 gives null instead of false; a 5xx or timeout gives false instead of null; a 1,000-entry listing without the file gives false instead of null.
39. An entry with the right name but `type` dir, symlink or submodule counts as present.
40. A decoded link path with `..`, `%2e%2e`, `%2F`, `?`, `#`, a newline or NUL produces a request (carried item, comment 6314008085).
41. Readiness passes `evidence-link-missing` with qualifying links whose presence is false or null; readiness and the shell disagree on which links qualify (one helper serves both).

Status writer (S4b, `merge-gate-status.test.ts`):
42. A status is planned under policy `human`, in any environment.
43. A status is planned when `readiness.headSha` is null, when the checks were read at another SHA, or when the current own status is unreadable.
44. A status is planned when the current own status already has the same state and description; a different value written by someone else is not overwritten.
45. Wrong state mapping: success when not ready, `error` ever written, or `pending` with a human-class blocker.
46. A description over 140 code points, or one carrying blocker detail (author-controlled names), control or bidi characters.
47. A context other than the exact constant is written.
48. The writer retries or throws on a transport failure instead of returning it.

General:
49. Any rate-limited read lets the shell keep reading; `retryAt` ignores `retry-after`.
50. Reads run concurrently (the fake asserts at most one request in flight).
51. A new gate file fails the round 3 import test: an import of `lib/github.ts`, `globalThis.fetch`, `process.env`, or a class with a `constructor`.
52. A port that throws escapes `readGateGithubFacts`.
53. A forged transport returns a response for another resource; it is caught wherever the response names itself (PR `number` and base repo, compare commits' own head, run `head_sha`, status `sha`). A wholly fabricated consistent response cannot be caught in the gate (open question 1).

Ticket failure modes that S4 serves:
- `判定在推送之后才落库`: the compare reader is a separate export, `readCompareAt(port, baseSha, headSha)`, so S5a can compute the digest at a verdict's own head.
- `compare 文件列表被截断`: the shell never pages files, and passes `changed_files`. Readiness turns 300 files, or a mismatched count, into `compare-truncated`.

## 7. Files to touch

S4a (ordinary product source and tests, not ④, not on the AGENTS.md `/security-review` list):
- `apps/server/src/lib/github.ts`: raw transport, `githubCreateCommitStatus`, header write list.
- `apps/server/test/github-gate-transport.test.ts` (new).
- `apps/server/test/fixtures/github/` (new recorded bodies: PR with draft and body, branch with protection, rules, check runs with duplicate suites, combined status, contents listing, compare pages).
- `docs/verify/1404/` evidence (live shape captures for S4, red and green runs, gates).

S4b (D4 ④ unless noted; user merge):
- `apps/server/src/services/merge-gate/github-port.ts` (new, types only).
- `apps/server/src/services/merge-gate/github-facts.ts` (new).
- `apps/server/src/services/merge-gate/gate-status.ts` (new).
- `apps/server/src/services/merge-gate/evidence-link.ts`: `qualifyingEvidenceLinks`, path-safety pins.
- `apps/server/src/services/merge-gate/readiness.ts`: `GateInputs.evidence` and its rule.
- Not ④: `apps/server/test/merge-gate-github-facts.test.ts`, `merge-gate-status.test.ts`, `merge-gate-transport-fit.test.ts` (all new); `merge-gate-readiness.test.ts`, `merge-gate-evidence-link.test.ts` (updated); `apps/server/test/helpers/fake-github.ts` (new: commit graph, paged compare, runs and statuses by SHA, status POST); `docs/verify/1404/`.
- Only if needed: `packages/shared/src/records/merge-gate.ts`. The plan keeps the page caps and the 140 limit as local constants in the gate files, so this file and the shared snapshot are not touched. If they move here, they must be deep-frozen (round 3 freeze test).

`/security-review` is not required by the AGENTS.md list. Run it anyway on S4a: it adds a write that acts with the team's stored token.

No migration in S4 (4.6 needs no column). No `docs/spec/28` §8 edit unless the user wants the ledger row moved in this PR.

## 8. What waits for #1479, and the rebase

Waits for #1479:
- the final `GateInputs` shape (all of 4.3 steps 4 to 6 map to it);
- the in-gate SHA check;
- the import and freeze tests that S4b's new files must pass;
- the readiness edit in 4.5, which lands on #1479's `readiness.ts`.

S4a does not depend on #1479. It does conflict with P2 segment 2b in the `lib/github.ts` header and rate-limit helpers, so it rebases on whichever lands first.

Rebase procedure once #1479 merges:
1. `git -C /home/user/pacman/.claude/worktrees/p3c fetch origin`, then start S4b from `origin/main` (the lane rule: cut from `origin/main`).
2. `git diff 39a108e8 origin/main -- apps/server/src/services/merge-gate/readiness.ts packages/shared/src/records/merge-gate.ts apps/server/test/merge-gate-imports.test.ts`. Every change to the `GateInputs` contract comments maps to a row in section 4.3 and a failure mode in section 6. Update both before writing tests.
3. If P4-0 merged first, `baseBehindBy` goes into `GateInputs.pr` directly; otherwise it stays in `GateGithubFacts`.
4. If #1479's final round adds blocker codes for shell faults, section 4.4 follows them instead of the no-new-codes default.

## 9. Open questions (conservative choice in brackets)

1. **Trust in `lib/github.ts`.** Named transport functions in an auto-mergeable file can still change which endpoint and parameters the gate gets, or fabricate a consistent response. The gate catches responses that name another resource (failure mode 53), not a whole forgery. Options:
   - generic transport plus request builders in ④ (the pattern P4 open question 1 recommends for the merge writer);
   - `lib/github.ts` into ④ (#1462 item 7).
   [Named functions with every meaning-bearing parameter passed by the gate, as in section 4.1; follow whatever the user decides for P4 question 1; no autonomous merge before that decision.]
2. **Evidence presence changes readiness and `GateInputs`** (section 4.5), beyond the S4 row's wording. [Do it in S4b, since readiness hands it to S4.]
3. **Required checks are read in S4** (branch protection plus rulesets), also beyond the S4 row. `GateInputs.checks.required` carries names only, so app bindings are enforced through the shell's ordering and GitHub's `mergeable_state`. [Read them in S4b; propose `{context, appId}` in `GateInputs` as a later gate change, not here.]
4. **Status state mapping and description** (section 4.6). [success / pending / failure, never error; label plus code plus count; no detail, no `target_url`; 140 code points.]
5. **Split S4 into S4a (auto-mergeable transport) and S4b (④)**, and may S4a start before #1479 merges? [Split; start S4a only after #1479 merges, as instructed.]
6. **Carried parser items** (comment 6314008085): the path-safety pins are needed for the probes. The mid-line `<!--` inside an HTML block and adding `.svg`/`.xhtml` to the executable list are not. [Path safety in S4b; the other two as a small separate ④ PR, so S4b stays reviewable.]
7. **Deterministic shell faults** (#1479 Risk). [Stay transient with a note; no new blocker codes in S4.]
8. **Request budget** (section 4.7): the contract says the compare must not come from a URL-keyed cache. Is a memo keyed by the (base SHA, head SHA) pair, whose response cannot change, acceptable for S7's cadence control? [Not in S4; S4 always reads the compare; S7 decides cadence.]
