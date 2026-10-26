# PR #1876 CI diagnosis

Measured on 2026-10-26: the failing `check` is inherited from main. The checked-in model roster contains 157 vendors, while deriving the roster from the installed `@earendil-works/pi-ai@1.4.0` catalogs produces 162. No product code or dependency changes were made during this diagnosis.

## Upstream evidence

- PR head: `e73435bdba66af9ea3a00ceda1f499e6cb2ff248` (`lane/1757`).
- Local `origin/main` and GitHub main both resolve to `0117480ad956c1b0bc6b1f5cef149fdd11a9802f`, the direct parent of the PR head. The branch already includes latest main; no rebase or conflict resolution is needed. `docs/lessons.md` is unchanged, preserving every row.
- [PR CI run](https://github.com/xiechimon/cairn/actions/runs/40368719843) fails `merge-gate-model-roster.test.ts` with 162 derived vendors versus 157 checked-in vendors.
- [Main CI run](https://github.com/xiechimon/cairn/actions/runs/40351380688) fails the same test with the same counts at main's exact SHA.
- PR `pr-evidence` and all four E2E shards passed.

## Local reproduction

The existing regression test was run unchanged, before any repository edits:

```sh
flock /tmp/cairn-heavy.lock bash -o pipefail -c 'pnpm exec vitest run apps/server/test/merge-gate-model-roster.test.ts 2>&1 | tee /tmp/cairn-1757-roster.log'
```

Measured result: exit 1, one failed test and one passed test. The snapshot assertion reports exactly the CI mismatch: 162 versus 157 vendors. See [branch output](ci-roster-branch.log).

For an isolated main comparison, these four files were read with `git show origin/main:<path>` into `/tmp/cairn-1757-main-repro`, preserving their relative paths:

- `apps/server/test/merge-gate-model-roster.test.ts`
- `apps/server/src/services/merge-gate/model-identity.ts`
- `apps/server/src/services/merge-gate/model-roster.ts`
- `apps/server/src/services/merge-gate/model-roster-data.ts`

All four files are byte-for-byte identical to this branch. The temporary directory uses symlinks to this worktree's root and daemon `node_modules` directories, so both runs consume the same installed catalogs. Its `vitest.config.mjs` contains:

```js
export default { test: { include: ['apps/server/test/merge-gate-model-roster.test.ts'] } };
```

```sh
flock /tmp/cairn-heavy.lock bash -o pipefail -c 'pnpm exec vitest run --root /tmp/cairn-1757-main-repro --config /tmp/cairn-1757-main-repro/vitest.config.mjs 2>&1 | tee /tmp/cairn-1757-main-roster.log'
```

Measured result: exit 1, the same snapshot mismatch and one passing alias test. See [main output](ci-roster-main.log). This is a focused main-source reproduction, not a full main suite run.

## Cause and scope

Measured: the derived roster adds entries including `claude-haiku-5-5`, `codestral-2508`, and `gemini-4-argon`, and omits checked-in entries including `gpt-5.2-chat-latest` and `gpt-5.3-chat-latest`. The roster source, snapshot, test, and lockfile have no branch diff against main.

Inference: this is a deterministic inherited catalog/snapshot mismatch, not an issue-intake regression or an intermittent test failure. The observations do not establish why the snapshot was originally generated from different catalog contents. Updating the shared snapshot belongs to the upstream failure, outside this branch-specific repair.

No code changes were necessary. No tests were weakened or skipped, and no known-red exclusion was added for this failure. Full lint, typecheck, and E2E were not rerun for these evidence-only additions. No Git index, commit, remote ref, or PR body was modified; the requested commit message is supplied in `COMMIT_MSG.txt` for the external commit step.

## Root cause completed (round 2, 2026-10-26)

This closes the open question at the end of the previous section. The branch head is now `afd8bbc7` (the round 1 diagnosis commit); its `check` stays red on the same inherited assertion, which is expected until the upstream snapshot refresh lands.

### The checked-in snapshot is the pi-ai 1.0.4 roster

`npm pack @earendil-works/pi-ai@1.0.4` (tarball from registry.npmjs.org) was extracted to a temp dir, and `deriveModelRoster` ran over its `dist/providers/data` exactly as the test does over the installed package. Result: 157 vendors, zero added, zero missing, zero vendor-value changes, aliases equal — the checked-in `MODEL_VENDORS` / `MODEL_ALIASES` in full. Artifact: [roster-drift-npm-pi-ai-1.0.4.json](roster-drift-npm-pi-ai-1.0.4.json).

The same derivation over the installed `@earendil-works/pi-ai@1.4.0` (the version the lockfile has pinned since `241205d7`) returns 162 vendors: 13 added (`claude-haiku-5-5`, `codestral-2508`, `gemini-4-argon`, `gemini-pro-latest`, `glm-5-2`, `labs-leanstral-1-5-1`, `minimax-m3.1-flash`, `ministral-14b-2512`, `ministral-3b-2512`, `ministral-8b-2512`, `mistral-large-4`, `muse-wonder-1.0`, `voxtral-small-2507`), 8 dropped (`gpt-5.2-chat-latest`, `gpt-5.3-chat-latest`, `mimo-v2.5`, `mimo-v2.5-pro`, `mimo-v2.5-pro-ultraspeed`, `open-mistral-7b`, `open-mixtral-8x22b`, `open-mixtral-8x7b`), no vendor value changed, aliases equal. Artifact: [roster-drift-installed-pi-ai-1.4.0.json](roster-drift-installed-pi-ai-1.4.0.json).

### How main went red

All times are 2026-10-26, -0700.

- 05:32 `241205d7` ("daemon(1808): upgrade pi from 1.0.4 to 1.4.0") moves the lockfile to `@earendil-works/pi-ai@1.4.0`.
- 08:38 `0117480a` squash-merges #1818, the PR that introduced `model-roster-data.ts` and the snapshot test. #1818's green CI head `ad97a60d` still pinned `pi-ai@1.0.4` (verified with `git show ad97a60d:pnpm-lock.yaml`), and its roster files are byte-identical to what landed (verified with `git diff ad97a60d 0117480a -- apps/server/src/services/merge-gate apps/server/test/merge-gate-model-roster.test.ts`, empty). Its green CI therefore proves the snapshot matched the 1.0.4 catalogs — the same equality measured above.
- `241205d7` is an ancestor of `0117480a`, so the squash combined #1818's 1.0.4-derived snapshot with main's 1.4.0 lockfile. Main's own `check` went red at the merged SHA (run 40351380688); main's parent `10a26f29` was green.

The mismatch was born inside that squash merge on main, after #1818's CI had passed: the PR's base moved under it when #1808's pi upgrade landed between the CI run and the merge. It is deterministic — the same 162/157 counts locally, in main CI, and in this PR's CI — not a flake.

### Where the fix belongs

Issue #1855 owns the snapshot refresh: PR #1861 ("server(1855): refresh the model roster snapshot from pi 1.4.0 catalogs") is open, mergeable, and green on `check`. PR #1880, the same lane, records the roster test in `scripts/prepush-known-red.json` on its own branch, whose changed set selects that test locally. This branch's changed set does not select it (verified: the roster sources are untouched here), so no exclusion is added, unchanged from round 1. When #1861 merges, this branch rebases onto a green main and the inherited failure disappears. PR #1880 appends its roster entry in the same region of `prepush-known-red.json` this branch edits, so a merge-order conflict there resolves to the union: their roster entry kept, this branch's stale token-auth entry removed.

### Stale known-red entry removed, with a gate

Round 1 added `apps/server/test/token-auth.test.ts` to `scripts/prepush-known-red.json` with the reason "an empty CAIRN_TOKEN falls back to the home token file". Measured on this branch, whose base includes `260b8a4c` (#1822, which stubs that test's home to an empty temp dir):

- Clean shell (`CAIRN_TOKEN` unset, `~/.cairn/token` present): 34/34 pass. Artifact: [token-auth-clean-shell.log](token-auth-clean-shell.log).
- Shell exporting `CAIRN_TOKEN=some-local-token`: only the env-mapping test fails (33 pass) — a different mechanism from the recorded reason, and a self-inflicted shell condition, not a machine property. Artifact: [token-auth-with-cairn-token-env.log](token-auth-with-cairn-token-env.log).

CI's `check` job never consults the known-red file: it runs `VITEST_PROJECT_SET=light pnpm test` directly, and `prepush --ci` omits `scripts/prepush-vitest.mjs`. The entry only affected local prepush, where it would mask a token-auth regression behind a mechanism main had already fixed. The entry is removed. Making the test hermetic against a shell-exported `CAIRN_TOKEN` (stubbing the token env after `vi.unstubAllEnvs()`) is left to open PR #1821, which already edits that test.

To keep stale entries from landing again, `scripts/prepush-vitest.mjs` now fails local prepush with `stale known-red entry` when a listed file passes in the same run. The negative control is this round's real mistake encoded in `scripts/prepush.test.mjs`: `token-auth.test.ts` listed as known red while its result is `passed` — red before the implementation, green after.
