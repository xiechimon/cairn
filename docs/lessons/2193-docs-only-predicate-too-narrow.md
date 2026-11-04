---
Category: The docs-only CI skip from #2173 treated every non-Markdown file under `docs/` as code, so lessons PRs (which always touch `docs/lessons/events.jsonl`) and PRs carrying evidence logs still ran the full e2e and vitest jobs
Source: #2193 (2026-10-30)
Level: 2
Safeguard: `hasCode` in `scripts/prepush.mjs` counts files under `docs/` as documentation unless they are executable sources (`.js`, `.mjs`, `.cjs`, `.ts`, `.mts`, `.cts`, `.sh`, `.py`), and every documentation path, Markdown or not, goes to `scripts/doc-reader-tests.mjs`, so a test that reads a changed data file still runs; `scripts/prepush.test.mjs` pins #2188's exact file list as no-code and the doc reader of `docs/verify/920/wire-new/manifest-new.json`; since 2026-10-30
Intercepts: 0
Recurrences: 0
Notes: Negative control: #2188 (54195adb0) changed five files under `docs/lessons/` and `docs/verify/2182/`; `hasCode` on origin/main returns true for that list and CI ran four e2e shards and both vitest jobs for 8 minutes, while this branch returns false (`docs/verify/2193/has-code-2188.log`). #2173 had made non-Markdown evidence count as code to fail closed on tests that read evidence; routing those paths through the doc-reader tests keeps that protection.
---
