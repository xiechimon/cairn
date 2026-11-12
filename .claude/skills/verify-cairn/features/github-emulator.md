# GitHub emulator evidence

Exercise GitHub-facing features without GitHub credentials. This case runs the PrWatch service against a stateful local emulate.dev process and records real HTTP traffic and SQLite transitions. GitHub remains an emulated boundary in the PR card.

## Sub-features

- API base: `CAIRN_GITHUB_API_BASE_URL` changes server GitHub REST/GraphQL helpers, feedback reads, branch reads and autonomy requests. Unset or empty retains `https://api.github.com`. HTTP(S), optional path prefix and trailing slash are supported; URL credentials, queries and fragments are rejected.
- Create a PR and two completed checks, sweep the real poller, and assert one SQLite `thread_pr` row with one passed and one failed check.
- Feedback: create a changes-requested review and read it through `githubPrFeedback`. PrWatch itself uses local `gate_verdict` rows for review verdicts; this case preserves that contract.
- Merge: call Cairn's SHA-bound squash helper, sweep to `merged`, and verify subsequent sweeps stop reading. A missing PR leaves the recorded row intact.
- Picker: read the seeded repository through `githubUserRepos`.

## How to get to it (user POV)

For backend evidence, run the registered case below. For a separate verify-cairn web stack, start the emulator in a terminal first:

```sh
printf '%s\n' '{"github":{"users":[{"login":"octo"}],"repos":[{"owner":"octo","name":"demo"}]}}' > /tmp/cairn-github-seed.json
npx --yes --ignore-scripts emulate@0.13.0 start --service github --host 127.0.0.1 --port 4001 --seed /tmp/cairn-github-seed.json
```

Check the port is free first; choose another if occupied. Start an isolated stack with `CAIRN_GITHUB_API_BASE_URL=http://127.0.0.1:4001 node .claude/skills/verify-cairn/scripts/vp.mjs launch`. Use only a disposable GitHub connection containing `emulate-local-token` in that scratch DB. Never reuse a real token. Use the GitHub REST endpoints to inspect state; the built-in GitHub service in 0.13.0 has no inspector route. Stop this foreground emulator with Ctrl-C after stack cleanup.

## Driving it with verify-cairn

Preconditions: Node 24, npx, installed workspace dependencies and Playwright Chromium. No running verify stack is needed; the case owns its emulator process and in-memory SQLite database. The first npx run downloads a pinned package outside the repository with scripts disabled; subsequent offline runs need a warm npm cache. No manifest or lockfile changes.

```sh
cairn-heavy node .claude/skills/verify-cairn/scripts/vp.mjs drive github-emulator pr-watch
cairn-heavy pnpm exec vitest run integration/test/github-emulator.test.ts
```

The driver selects an available loopback port, seeds a disposable user/repository, creates branch/PR/checks/review through HTTP, runs Cairn's helpers and poller, and asserts persisted fields. It fails on startup, wire or state mismatch, and tears down only its own process group. It writes `result.json` (requests, bodies, statuses, responses and open/merged DB rows), `emulate.txt` and `github-requests.png` and `emulate-docs.png` into `VERIFY_EVIDENCE_DIR` supplied by vp. The screenshot comes from Swagger UI 5.34.1 executing a real check-runs request, with the request URL and response visible. The driver downloads Swagger UI assets from unpkg and captures the official docs; the integration test needs neither browser nor those network requests. Inspect `result.json` alongside it; the backend case does not establish the web UI journey.

Failure-mode tests cover production defaults, override path handling, invalid configuration and pagination origin confinement in `apps/server/test/github-api-base.test.ts`. The integration case covers poll persistence, mixed CI outcomes, review feedback, merge reconciliation, terminal polling and missing-PR preservation.

PR coverage lines:

```text
Live: Cairn PrWatch and GitHub helpers over loopback HTTP; migrated SQLite DB.
Mocked: GitHub emulator (emulate.dev), version 0.13.0.
Not covered: real GitHub, OAuth authorization/token exchange, daemon git/gh calls, skill-import raw downloads, browser PR journey, E2B, Langfuse.
```

## Gotchas

- The override is process-wide and for API traffic only. OAuth authorize/token URLs, public GitHub links, daemon probes and skill-import raw downloads retain their separate configuration/behavior. This case does not call them.
- Do not configure an emulator URL on production or put real credentials into a local emulator. Restart a launched verify stack after changing the environment.
- The integration test starts npx itself; CI must allow the initial package download or prewarm `npm_config_cache=/tmp/cairn-emulate-npm-cache npm exec --yes --ignore-scripts --package emulate@0.13.0 -- emulate --version` before disabling networking. Running API traffic is loopback-only, enforced by the case's transport assertion.
- Emulator fidelity has limits. This example does not prove real GitHub permissions, OAuth, branch protection or production merge policy. E2B then Langfuse remain follow-ups under #3137.

Sources checked 2026-11-06: [CLI and seed options](https://emulate.dev/docs), [GitHub endpoint coverage](https://emulate.dev/docs/github), [published package 0.13.0](https://www.npmjs.com/package/emulate/v/0.13.0), and the downloaded package's CLI/types/source. These support using the external CLI rather than adding a repository dependency.
