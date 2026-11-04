# Issue #1982 verification

The Python regression suite exercises the actual gate entry point with HTTP
responses fixed at 200. Its fixture matrix covers three embedding forms,
two path forms, and five query forms, including empty values and HTML entities.
Every fixture case requires `FAIL fixture:` and excludes embedding and HTTP
failure verdicts. Passing controls retain extensionless embedding forms and
complete URLs, ignore ordinary references, and exclude HTML comments.
Additional controls require embedding failures and HTTP 404 failures.

- `red.log`: original scanner fails the new regression suite.
- `green.log`: all four regression groups pass after the scanner change.
- `node --test scripts/prepush.test.mjs scripts/ci-job-structure-gate.test.mjs`: 24 tests pass.
- `pnpm lint`: passes.
- `flock /tmp/cairn-heavy.lock pnpm typecheck`: passes.
- `pnpm spec:parse` under the same exclusive lock: passes, 1301 web cases and 39 integration files collected.
- `node scripts/prepush-vitest.mjs` under the same exclusive lock: exits 0; no related Vitest files selected for these script changes.
- English-only, single-use-helper and comment-discipline gates: zero findings.
- CI job structure and lessons ledger gates: pass.

Open PR #1787 also changes `.github/workflows/ci.yml`; this change adds a
regression step without removing existing workflow lines. Archive provenance
is deliberately outside issue #1982. No application servers were started.
