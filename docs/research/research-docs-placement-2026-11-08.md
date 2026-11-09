# Where research notes, designs and evidence should live

Publication note: restored historical research, with private details redacted. Evidence labels describe the original research session; recommendations are not implementation approval or current policy.

Date: 2026-11-08. Status: archived research snapshot. Question: does keeping research notes and evidence screenshots inside the public `xiechimon/cairn` repo cause problems, and where should they live?

Labels: **measured** = measured or read first-hand in this session; **inferred** = derived from measured, re-checkable; **unverified** = everything else. Measurements are on `origin/main` at `1f0b42d3a` on the server host unless stated. `MB` is 10^6 bytes.

## 1. Measurements

### 1.1 What is in `docs/` today

| Path | Size | Files | Images (size) | Label |
|---|---|---|---|---|
| whole tree | 310.9 MB | 10,473 | | measured (`git ls-tree -r -l`) |
| `docs/` | 267.4 MB (255 MiB), 86% of the tree | | | measured |
| `docs/verify` | 225.1 MB | 5,557 | 2,119 (193.0 MB): 2,067 png, 37 jpg, 9 gif, 2 webm | measured |
| `docs/research` | 36.2 MB | 552 | 479 (34.4 MB); 61 `.md` = 1.8 MB | measured |
| `docs/design` | 4.0 MB | 45 | 42 (4.0 MB) | measured |
| all other `docs/*` (spec, lessons, ops, feature-map...) | about 2 MB | | 2 (`docs/assets`, 0.5 MB) | measured |

`docs/verify` is not only evidence: it holds 143 code files (driver `.mjs`/`.ts`, 1.08 MB), and `.claude/skills/verify-cairn/vp-registry.json` points at 38 paths inside it (measured). It also holds 852 json, 918 txt, 1,027 log and 409 md files (measured).

### 1.2 Growth and history

- Raw bytes added under `docs/` per ISO week on main (first-parent): W37 0.6, W38 10.2, W39 28.6, W40 91.1, W41 119.2, W42 67.3, W43 51.9, W44 47.0, W45 (this week, partial) 90.3 MB. 506 MB in 9 weeks; about 78 MB/week since W40. W45 alone: verify 54.0, research 29.4, design 5.5 (measured, `git log --raw` + `cat-file`).
- `docs/verify` is still being committed by feature PRs this week (#3181, #3339, #3359, #3341, #3342, #3326, #3317), although [`pr-cairn`](https://github.com/xiechimon/cairn/blob/1f0b42d3a0c8d35c1bb05fd0b8012e6a4dd6b6d2/.claude/skills/pr-cairn/SKILL.md) routes PR images to `pr-assets/<n>` and [`verify-cairn`](https://github.com/xiechimon/cairn/blob/1f0b42d3a0c8d35c1bb05fd0b8012e6a4dd6b6d2/.claude/skills/verify-cairn/SKILL.md) calls archiving optional (measured). Nothing enforces the rule (inferred).
- History reachable from main: 439 MB on disk; of it, `docs/verify` blobs 310.7 MB and `docs/research` 61.9 MB, against 39 MB for all of `apps/` (measured). The weekly prune ([`scripts/evidence-prune.mjs`](https://github.com/xiechimon/cairn/blob/1f0b42d3a0c8d35c1bb05fd0b8012e6a4dd6b6d2/scripts/evidence-prune.mjs), 14-day default, ledger `docs/verify/pruned.json` with 257 entries) removes files from the tree only; every pruned byte stays in the pack (measured code; inferred effect).
- `pr-assets/*`: 139 live branches on GitHub (3 are `screens-*` from [`pr-screens.yml`](https://github.com/xiechimon/cairn/blob/1f0b42d3a0c8d35c1bb05fd0b8012e6a4dd6b6d2/.github/workflows/pr-screens.yml), deleted on PR close). 128 of 139 are branched from main, not orphans, and carry 277 MB on disk (330 MB raw, 2,308 blobs) that main does not reach (measured). All refs together: 847 MB; local pack 887 MiB; GitHub reports `size` 691,879 KB (measured `gh api repos/xiechimon/cairn`).

### 1.3 Clone cost (one run each, the server host to github.com)

| Command | Time | `.git` | Working tree | Label |
|---|---|---|---|---|
| `git clone` (all heads, so every `pr-assets/*`) | 36.8 s | 704 MB | 321 MB | measured |
| `--single-branch` | 28.4 s | 422 MB | 321 MB | measured |
| `--depth=1 --single-branch` | 19.4 s | 215 MB | 321 MB | measured |
| `--filter=blob:none` | 15.0 s | 222 MB | 321 MB | measured |
| `--filter=blob:none --sparse`, excluding `docs/{verify,research,design}` | 4.6 s | 24 MB | 54 MB | measured |

A blobless clone still downloads every HEAD blob at checkout, so it stays at 222 MB until the binaries leave the tip (inferred from the table; mechanism per [git partial-clone](https://git-scm.com/docs/partial-clone), measured read).

### 1.4 CI

- `ci.yml` has 12 `actions/checkout` steps, 7 with `fetch-depth: 0`; 13 other workflows also use `fetch-depth: 0` (measured). With `fetch-depth <= 0`, `actions/checkout` at the pinned `fbc6f39` fetches `+refs/heads/*:refs/remotes/origin/*` plus tags ([`git-source-provider.ts`](https://github.com/actions/checkout/blob/fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09/src/git-source-provider.ts), [`ref-helper.ts`](https://github.com/actions/checkout/blob/fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09/src/ref-helper.ts) `getRefSpecForAllHistory`, measured). So every full-depth job also downloads all 139 `pr-assets` branches (inferred).
- Over the last 3 green CI runs: about 19 checkouts per run; full-depth jobs average 7.3 to 10.0 s, shallow jobs 3.5 to 4.0 s; about 125 s of checkout per run (measured, `gh api .../jobs` step timings). CI cost is real but small; it is not the main problem (inferred).

### 1.5 Local disk on the server host

[Redacted: private measurements.]

### 1.6 What agents actually read

- `CLAUDE.md`, `AGENTS.md`, every `SKILL.md`, `.claude/workflows` and `docs/README.md` reference 74 distinct `docs/` paths: 60 in `docs/verify` (driver scripts and their READMEs), 4 spec, 3 ops, 2 design, 1 research (measured grep).
- The feature registry in open PR [#3447](https://github.com/xiechimon/cairn/pull/3447) (`ops/feature-registry`) links 81 `docs/research` notes, 28 `docs/design` and 31 `docs/spec` paths; every link is a `.md` file, none is an image, and its `--check` fails when "a linked path does not exist" (measured, `feature-map.json` and `generate-feature-map.mjs` on that branch).
- Of the 61 research notes on main, 18 are referenced from anywhere outside `docs/research` and `docs/verify` (measured).

### 1.7 Search noise

In this worktree, `docs/{verify,research,design}` hold 3,452 of 6,670 ripgrep-visible text files and 33.8 of 65.9 MB of text (51%) (measured). Share of matching lines that come from those directories: `settings` 62%, `merge gate` 47%, `compaction` 42% (measured `rg -c -i`). Claude Code's Grep and Codex both search through ripgrep-style file walks, so roughly half of what an agent's code search returns on product words is evidence and old notes, not code (inferred; tool internals not re-read here, so the tool claim is unverified).

### 1.8 Public exposure (filenames and text only; images were not OCR'd)

| Finding | Count | Label |
|---|---|---|
| `<HOME>` in evidence text | 645 occurrences, 206 files | measured |
| `<HOME>` | 35 files | measured |
| Personal mailbox addresses (gmail / qq) | 2 files: `docs/research/mergify-merge-queue-spike.md`, `docs/verify/1744/thinking-budget/squash-message.txt` | measured |
| Private-range and CGNAT (tailnet-style) IPs | about 29 files, e.g. `docs/research/remote-access-tsnet.md`, `docs/verify/1170/*` | measured |
| Token-shaped strings | 40 files; all sampled are fixtures (`[REDACTED fixture]`, `[REDACTED fixture]`) | measured |
| Third-party UI captures by filename | t3code 85, Amp 28, Claude 19, Cursor 8 | measured |

Sampled captures show the owner's own claude.ai conversation and model selection ([`M20-claudeai-500px-reply.jpg`](https://github.com/xiechimon/cairn/blob/1f0b42d3a0c8d35c1bb05fd0b8012e6a4dd6b6d2/docs/research/ui-ux-audit-2026-11-06/M20-claudeai-500px-reply.jpg)) and his Cursor workspace with partial redaction (`R10-cursor-agents-home.jpg`) (measured). The project rules forbid committing "internal addresses, personal information" ([`CLAUDE.md`](https://github.com/xiechimon/cairn/blob/1f0b42d3a0c8d35c1bb05fd0b8012e6a4dd6b6d2/CLAUDE.md)); the rows above break that rule in letter (inferred). GitHub's [Acceptable Use Policies](https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies) §3 bar content that infringes copyright or exposes third-party personal data (measured read). Whether comparison screenshots of other products are fair use, and whether Cursor/Amp terms restrict publishing them, was not checked against their terms and is not legal advice (unverified: low risk for comparison use, but the downside lands on a public repo forever).

### 1.9 Review noise

Since 2026-10-25, 238 main commits touched evidence directories and added 1,284 images; 10 of them added more than 25 images, which is GitHub's cap on renderable files per diff ([repository limits](https://docs.github.com/en/repositories/creating-and-managing-repositories/repository-limits), measured read; counts measured). `scripts/pr-size.mjs` already excludes `docs/verify/` from size, so reviewers and Codex cloud review still receive the files but the size gate ignores them (measured line 18; effect inferred).

## 2. Prior art

| Source | How it keeps design and research docs | Trade-offs | Link | Label |
|---|---|---|---|---|
| Rust RFCs | Separate repo `rust-lang/rfcs`, one `text/NNNN-*.md` per accepted RFC; 13 MB vs 1 GB for `rust-lang/rust` | Code repo stays lean; RFC text decoupled from implementation | [rust-lang/rfcs](https://github.com/rust-lang/rfcs) | measured (README, `gh api` size) |
| Kubernetes KEPs | Separate repo `kubernetes/enhancements`, a directory per KEP with `README.md` + `kep.yaml` carrying `status: provisional\|implementable\|implemented\|deferred\|rejected\|withdrawn\|replaced` | Status field makes stale docs machine-visible; 62 MB vs 1.5 GB for `kubernetes/kubernetes` | [keps/NNNN-kep-template](https://github.com/kubernetes/enhancements/tree/master/keps/NNNN-kep-template) | measured |
| React RFCs | Separate repo `reactjs/rfcs`, text only, 227 KB | Minimal; no assets | [reactjs/rfcs](https://github.com/reactjs/rfcs) | measured |
| Python PEPs | Separate repo `python/peps`; auxiliary files (diagrams) allowed as `pep-XXXX-Y.ext` or a `pep-XXXX/` folder next to the PEP; status header (Draft, Final, Superseded...) | Assets live with the text but in the docs repo, not CPython | [PEP 1](https://peps.python.org/pep-0001/#auxiliary-files) | measured |
| Go proposals | Separate repo `golang/proposal` (8 MB) | Same pattern | [golang/proposal](https://github.com/golang/proposal) | measured (size only) |
| Next.js (Vercel) | Docs text in-repo (`docs/*.mdx`); zero image files under `docs/`; `<Image srcLight="/docs/light/...">` resolves on nextjs.org, not in the repo | Text next to code for contributors, binaries hosted elsewhere | [layouts-and-pages.mdx](https://github.com/vercel/next.js/blob/canary/docs/01-app/01-getting-started/03-layouts-and-pages.mdx) | measured (tree, file); hosting location inferred |
| OpenAI Codex | In-repo `docs/*.md` user docs, 6 images in the whole tree, no design notes or evidence | Public repo carries product docs only | [openai/codex docs](https://github.com/openai/codex/tree/main/docs) | measured |
| Anthropic `claude-code` | Public repo has CHANGELOG, plugins, examples, one `demo.gif`; no design or research docs | Internal design material is not in the public repo | [anthropics/claude-code](https://github.com/anthropics/claude-code) | measured (top level); "kept internally" unverified |
| Linear | No public primary source on where internal specs live (linear.app/now covers method, not storage) | | [linear.app/now](https://linear.app/now) | blocked: no primary source |
| Git LFS | Pointers in git, objects in LFS storage; GitHub Free/Pro: 10 GiB storage + 10 GiB bandwidth per month, billed beyond; storage counts all objects ever uploaded | Keeps clones small, but public bandwidth on a public repo is metered, and LFS does not change what is public | [Git LFS billing](https://docs.github.com/en/billing/concepts/product-billing/git-lfs) | measured read |
| GitHub user attachments | Drag-and-drop into PR/issue; 10 MB per image; in public repos "accessed without authentication" | Zero repo cost; no documented upload API, so agents cannot use it | [Attaching files](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files) | measured read; "no API" unverified |
| Orphan / side branches in the same repo (cairn `pr-assets`) | Image commits on `refs/heads/pr-assets/*`, linked by SHA-pinned raw URLs | Default `git clone` and `fetch-depth: 0` download them (§1.2, §1.4); cairn's are mostly not orphans, so they also pin old main history | §1.2 | measured |
| GitHub size guidance | Repos "ideally less than 1 GB"; single object recommended max 1 MB; history rewrite via `git filter-repo` breaks closed-PR diffs, needs every clone re-cloned, and GitHub Support removes cached PR refs only for sensitive data | | [About large files](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github), [Removing sensitive data](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository) | measured read |

Pattern: every large project keeps the proposal text in one place with a status field, and keeps binaries out of the code repo. The text either lives in a docs repo (Rust, Kubernetes, Python, Go) or next to the code with assets hosted elsewhere (Next.js). Nobody in the sample keeps hundreds of MB of evidence screenshots in the code repo (inferred from the table).

## 3. Problems, ranked for cairn

[Redacted: private measurements.]
2. **Public exposure** (high, irreversible): local username, home and tailnet addresses, personal mailboxes and captures of the owner's own claude.ai and Cursor sessions are public, and git history keeps them after deletion (§1.8). measured findings, inferred severity.
3. **Search noise and sediment** (medium): half of searchable text is evidence; old research notes sit beside current ones with no status, and only 18 of 61 notes are cited anywhere (§1.6, §1.7). inferred.
4. **Growth** (medium): about 78 MB/week, mostly `docs/verify`, despite a skill rule against it; at that rate main history passes GitHub's 1 GB guidance in roughly 7 weeks (439 MB now) (inferred, linear extrapolation is unverified).
5. **CI** (low): about 125 s of checkout per run, partly from fetching all `pr-assets` heads (§1.4). measured.
6. **Review noise** (low): image-heavy commits exceed GitHub's 25-renderable-file cap (§1.9). measured.

## 4. Recommendation: one layout

Rule: **the public code repo holds text; binaries live in an evidence repo; anything showing a third-party product or the owner's accounts lives in a private repo.**

| Content | Home | How it is linked |
|---|---|---|
| Research notes, specs, design docs, ops docs (`.md`, `.mmd`) | `xiechimon/cairn` `docs/research`, `docs/spec`, `docs/design`, `docs/ops` (unchanged paths) | Relative repo paths, as the registry uses today |
| Images, video, logs and JSON of cairn's own product: PR proof, verify evidence, design mockups, cairn screenshots in research | New public repo `xiechimon/cairn-evidence`, path `<kind>/<id>/<file>` (`pr/<n>/`, `verify/<ticket>/`, `research/<note-slug>/`, `design/<slug>/`) | SHA-pinned `raw.githubusercontent.com/xiechimon/cairn-evidence/<sha>/...` URLs |
| Captures of other products (claude.ai, Cursor, Amp, t3code, Linear) and anything showing the owner's accounts | New private repo `xiechimon/cairn-research-private`, same path scheme | The note states in text what the capture shows (that sentence is the public evidence) and cites `private:research/<slug>/<file>@<sha>` |
| Verify drivers (`docs/verify/**/*.mjs`, `*.ts`) | `.claude/skills/verify-cairn/drivers/<feature>/` | `vp-registry.json` paths updated |

Why this one: it is the Next.js split (text with code, binaries elsewhere) plus the KEP/PEP status field, and it keeps every link the registry checks inside the code repo, so `generate-feature-map.mjs --check` keeps working unchanged: it only resolves `.md` paths (§1.6, inferred). PR images still render for everyone because `cairn-evidence` is public; images in a private repo would not render in public PR bodies (unverified, consistent with raw URLs needing auth for private repos). A separate repo, unlike LFS, costs no bandwidth quota and does not keep the binaries in `cairn`'s clone (inferred from §2).

### 4.1 Migration of the existing 255 MiB

1. Land after #3447, so the old generator's dependency on `docs/verify/<n>/` directory names is gone (measured: the main-branch generator builds rows from those names).
2. Create both repos (cairnwright app installed on both). Copy `docs/verify`, the binaries of `docs/research` and `docs/design` into `cairn-evidence` with the scheme above; route third-party and account captures (filename match plus a manual pass over the 479 research images) to the private repo. Scrub local home paths, mailboxes and private IPs in the copied text on the way.
3. One PR in `cairn`: delete the moved files, move the drivers, rewrite the 21 in-repo raw links and every relative image link in notes to the new SHA-pinned URLs (scripted), and remove the 2 mailboxes and the private IPs from text that stays.
4. Retarget writers: `vp.mjs archive`, the `pr-cairn` screenshot section and `pr-screens.yml` push to `cairn-evidence` (needs the cairnwright app token, since `GITHUB_TOKEN` cannot write to another repo; that touches workflow credentials, so route to the owner). Retire `evidence-prune.mjs` and `pruned.json`.
5. Old `pr-assets/*` branches: repoint each to `refs/archive/pr-assets/<n>` and delete the head. The refs API accepts any ref that starts with `refs` and has two slashes ([Git refs API](https://docs.github.com/en/rest/git/refs), measured read), clones and `fetch-depth: 0` only fetch `refs/heads/*` and tags (§1.4), and the commits stay referenced so old PR image links keep resolving (inferred; spike one branch first and check a raw URL before doing all 139).

Result after steps 1 to 5: tip `docs/` drops from 267 MB to about 4 MB, a default clone drops from 1 GB to about 440 MB of history plus a small tree, and a blobless clone drops to well under 100 MB (inferred from §1.2 and §1.3). Each worktree loses about 200 MB on its next rebase (inferred).

### 4.2 History rewrite: not now

[Redacted: private measurements.]

### 4.3 Gates that keep it from regressing

| Gate | Where | Fails when |
|---|---|---|
| `scripts/docs-budget.mjs` | `pnpm prepush` and the CI `gates` job | Any tracked file under `docs/` is not `.md`/`.mmd`/`.json`/small `.svg`, outside the `docs/assets/` allowlist; `docs/` total exceeds 6 MB; any blob added by the PR anywhere in the repo exceeds 1 MB (GitHub's recommended max object size) |
| Repository ruleset "Restrict creations" on `refs/heads/pr-assets/**` | GitHub settings (the owner) | Anyone creates a new `pr-assets` branch ([available rules](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets#restrict-creations), measured read) |
| Privacy scan in `cairn-evidence` CI | that repo | Text matches `/Users/<name>`, `/home/<name>`, personal mail domains, RFC 1918 or 100.64/10 addresses, or token formats; a filename names a third-party product (those go to the private repo) |
| `generate-feature-map.mjs --check` (extended) | existing `gates` job | A linked research or design note has `Status: superseded`, or contains a relative image link instead of a SHA-pinned evidence URL |
| Note header lint | same script | A new `docs/research/*.md` lacks `Date:` and `Status: current\|superseded by <path>` (the KEP/PEP status field) |

Open item for the owner: creating the two repos, the ruleset, and the cairnwright token for `pr-screens.yml` are account and credential changes; the code PR (steps 3 and gates) can be dispatched without him.
