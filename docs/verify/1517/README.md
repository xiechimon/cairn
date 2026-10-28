# Issue 1517 verification

This is an incomplete delivery. No accepted Harbor benchmark tasks are claimed.

- Scanned 972 merged PRs; 53 passed the static selection rules. Full audit:
  `integration/eval/harbor/bench-v0.json`.
- Test-first failures: `red-python.log`, `red-manifest.log`, `red-controls.log`,
  `red-command-array.log`, and `red-internal-link.log`.
- Python: 11 passed (`green-python.log`), including actual regression assertion
  failure without the product patch and success with it in fresh directories.
- Related Vitest: 5 passed (`green-manifest.log`). The manifest test validates
  explicitly incomplete status; it does not certify a completed 30-task set.
- `pnpm lint`, `flock /tmp/cairn-heavy.lock pnpm typecheck`, `pnpm spec:parse`,
  and `flock /tmp/cairn-heavy.lock node scripts/prepush-vitest.mjs` passed.
  See `lint.log`, `typecheck.log`, `spec-parse.log`, and `prepush-vitest.log`.
- English-only, single-use-helper, and comment-discipline gates each reported 0.
  The new benchmark document also passed the explicit English-only text check.
- The PR 1990 Harbor oracle/nop pair failed in Docker build setup. Its zero CLI
  exit codes are not evidence of test success; both classifications are
  infrastructure failures (`harbor-controls.log` and `1990-*-infrastructure.log`).
- Independent labeler dispatch failed before a model ran (`labeler-route.log`).
- A retry with isolated Docker configuration was canceled while waiting for the
  shared heavy lock, before Harbor started. No retry acceptance is claimed.
- The final open-PR file intersection was empty. No existing tracked file was
  changed; recently merged additions and other lanes' changes were preserved.
- Docker reported no running container matching this task's unique name. No
  development server, Vite preview, or Playwright server was started.

Git staging and committing were skipped under the user's explicit read-only Git
sandbox instruction. `COMMIT_MSG.txt` contains the requested full commit message.
No push was attempted.
