# Overlap desktop release builds — plan, 2026-11-28

## User scenario

Someone who installed Cairn today gets fixes sooner through the same update button and downloads, with no new account, payment or keys. Failed or stale releases leave the last verified update available. Updates may arrive more often, version numbers may skip, and fast ZIP compression may modestly increase the download size. Before: 44 landings, p50 32m/p90 41m (owner's Nov 28 sample). [Run 46122720864](https://github.com/xiechimon/cairn/actions/runs/46122720864) waited 5m15s to start, then took ~20m to publish; the ARM64 verifiers already ran independently. See [run breakdown and prior art](../research/desktop-release-speed-2026-11-28.md).

## Scope

1. `.github/workflows/desktop-release.yml`: remove the whole-workflow lock. Serialize `decide` in `desktop-release-reserve` (`queue: max`, never cancel active); keep the three wakes, the newest-eligible scan and same-SHA CI evidence. The trusted workflow checkout reserves the first free version as a new draft before building. Independent builds can overlap; an active reservation suppresses duplicate work for its SHA only. Do not cancel an older viable build when a descendant starts: frequent landings would continually discard work before it can publish. GitHub runner limits still apply; log runner wait and count completed/superseded packages before considering additional admission policy.
2. Shorten the measured packaging bottleneck without removing checks: use the pinned builder's ZIP Deflate level 1 on both macOS jobs, not store mode. Same signed app, symlinks, formats, filenames and digest mechanism. No change to Windows/Linux packaging or Actions artifact compression. The 07:46 build spent 3m10s from starting ZIP creation to starting its block map on ARM64; the latency and size gains/trade-offs must be measured, not assumed. No install checks move to source-only CI.
3. Keep post-install migration parallel on the same signed ARM64 ZIP and record the stable tag it tested. After all packages, smoke, journeys, migration and `live-verify` pass, `desktop-release-finalize.yml` holds the old `desktop-release` group across admission, conditional migration replay, and trusted `publish` (`queue: max`, never cancel active). Admit only a newer version of a strict descendant of the highest stable tag, still on main and with green exact-SHA CI. If the stable tag changed, call the same `desktop-release-migration.yml` against the newly observed tag before publishing. Otherwise reuse the passing migration result. The isolated migration job never sees release App secrets; only `publish`, in the `desktop-release` environment, gets those secrets, checks out `github.sha`, uploads to the numeric reservation ID and rechecks the guards before the final flip. Never adopt a tag, resume partial assets, or delete a tag or release.
4. Update living operator docs and retire the whole-workflow lock wording. Drain/cancel older workflow revisions at rollout and never rerun them; the reused finalization group also fences any surviving old release writer. Compare real `main` pushes to `published_at` for shipped-source landings (and only use CI creation as a labelled proxy if necessary). Record landing/CI/release SHA, both run IDs, runner waits, overlap, duration, ZIP sizes and manifests for two consecutive qualifying production landings after this change. Targets: p50 ≤15m/p90 ≤20m. Two samples are acceptance, not a reliable long-term percentile; report any miss as incomplete and identify its measured bottleneck.

## States, readers and writers

- **Free → reserved:** under the allocation lock, `release-decide.mjs` sees published releases, tags and drafts. Only a green, changed, uncovered SHA gets a new empty draft. Its body carries a hidden owner marker binding workflow run ID and trusted revision. Owner statuses other than `completed` suppress duplicate work, including queued/waiting; bad or unavailable status fails closed. Stopped/failed owners and drafts created before a job crash still occupy the version but don't block a fresh trigger after completion. Drafts can accumulate; `repo-hygiene` reports them and only operators may delete drafts manually.
- **Reserved → verified → published or abandoned:** first attempts only; workflow reruns do not publish or reserve again, use a fresh wake/dispatch. Parent jobs read the SHA/version; migration also reads the prior published tag. Finalizer reads reservation owner/revision/tag/SHA and empty assets; an edit, missing baseline, missing ID, or stale version fails before publication. After uploading, it re-reads stable baseline/ancestry, tag availability, reserved draft and exact-SHA CI (CI last), then PATCHes only `draft: false`, `make_latest: true`. Publish is the only tag-creating transition. A failed upload/read leaves the draft. First-party writers are serialized; the existing seconds-wide race with external API writers after the last read remains.

## Edge cases

| Edge case | What the user sees | Proving test | Slice/Status |
|---|---|---|---|
| Manual/scheduled duplicate, queued/waiting owner, owner API failure, orphan or reservation failure, rerun | `decide reserves only an eligible unowned SHA`: no duplicate draft/build; no update from a skipped/error attempt; fresh wake after failed owner can reserve again. | `scripts/ops/release-gate.test.mjs` | this change |
| Descendant arrives during an older build; finalizers arrive in reverse order or wait on the lock; late-green older SHA gets a higher version | `builds overlap; only finalization queues`: no wake can evict a pending publish; `publication advances the stable SHA as well as the version`: never roll back. Scheduler timing is also checked on real runs, not inferred from YAML. | `scripts/ops/release-gate.test.mjs`, `scripts/desktop-release.test.mjs` | this change |
| Migration baseline unchanged/advanced/missing, third-party change during upload; red package/verify | `replay migration only on a changed baseline` and `publish refuses a moved migration baseline`: all checks block release; the common path does not put migration behind the other builds. | `scripts/ops/release-gate.test.mjs`, `scripts/desktop-release.test.mjs` | this change |
| Reservation marker edited, occupied tag, partial upload, moved main, CI rerun or failed REST read | `publish uses only its empty reserved draft and flips it by numeric ID`: existing inventory and tag safety checks remain; no update or deletion when evidence moves. Retarget the existing REST stub tests to that transition. | `scripts/desktop-release.test.mjs` | this change |
| ZIP archive compressor changes | `macOS release jobs use fast Deflate`: packaged checks still run against the same ZIP the updater gets; measure size separately in production. | `scripts/desktop-release.test.mjs` | this change |

## Out of scope

- No changes to merge-queue/CI reuse, secrets or signing policy, updater format, platform support, verification coverage, or production user data.

## Review

- Verdict: PASS
- Plan-SHA256: 92d6077fe329a82335bdc3a1a13c86d556784fa2349080f3995a4e5dd2d2fda1
- Author-Model: openai-codex/gpt-6.2-sol
- Reviewer: independent Pi plan review, 2026-11-28
- Reviewer-Model: anthropic/claude-sonnet-5-5
- Findings: 11 initial findings, all confirmed fixed in the hash-only follow-up.
