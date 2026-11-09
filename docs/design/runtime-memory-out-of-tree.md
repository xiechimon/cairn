# Runtime guidance without workspace writes (#3599)

## 1. Scope

Keep worker runtime instructions, team memory and skill catalogs in the existing SessionOpts.systemPrompt channel. Read repository guidance without modifying it. This repairs the existing delivery and no-op behavior; it introduces no persisted state, protocol or concurrency mechanism.

## 2. Paths and states

| Path | Expected behavior | Failure |
| --- | --- | --- |
| New and resumed Pi sessions | Compose the runtime prompt in memory; let the SDK load repository context | Prompt composition errors fail the step before opening the session |
| New and resumed Claude sessions | Append the runtime prompt through the SDK; include AGENTS.md only when native CLAUDE.md is absent | Repository read errors fail before session open |
| ACP sessions, including Gemini new/load/resume | Prefix runtime guidance to each delivered user prompt through the existing ACP bridge; never submit a guidance-only turn | Existing session error handling |
| Session completion, open failure, stream failure and stop | Leave repository files unchanged; no brief cleanup | Existing session outcome handling |
| Commit after setup/resume | Exclude fingerprint-matching setup drift, then check the staged diff | Empty index returns committed=false; real Git errors propagate |
| Worker changes after setup | Stage and commit worker changes, preserving hook failures | Existing commit errors remain failures |
| Setup/resume and any pnpm invocation | Disable automatic package manager management before command dispatch | Frozen installs still reject incompatible dependency locks |

## 3. Single path

Delete runtime block writing, reconciliation and cleanup. Keep the existing backend brief composer as a pure in-memory composer; pass its result through systemPrompt. Pi retains the SDK base prompt and repository-context loading through appendSystemPromptOverride. The existing runtime envelope is retained in memory so prompt identity extraction stops before SDK-added context. Claude retains native CLAUDE.md loading and the existing AGENTS.md fallback, now read-only. Historical marker detection remains an independent leak diagnostic.

## 4. Lockfile cause

The installed pnpm launcher resolves packageManager before dispatching commands, including --version. That bootstrap persists package-manager dependencies in pnpm-lock.yaml before frozen install handling. Set pmOnFail: ignore in workspace configuration to turn off automatic package manager resolution and persistence. Use the machine-provisioned pnpm; packageManager continues to document the intended version. Do not restore or hide rewritten locks after installation.

## 5. Evidence and decisions

| Decision | Reason | Reversal |
| --- | --- | --- |
| Use existing systemPrompt bridges | Runtime memory never needs a tracked file | Revert the PR |
| Disable automatic pnpm version management | Bootstrap writes occur before frozen install dispatch | Revert pmOnFail policy |
| Check the staged diff before commit | An empty worker step must not execute commit hooks | Revert the preflight |


Red tests exercise a real Git status during session opening, an empty worker step with a rejecting commit hook, and a real offline pnpm install with an unchanged manifest and byte-identical lockfile assertion. Retain worker edits and real hook failures as controls. Run targeted Vitest with four workers, lint, typecheck, spec:parse and prepush. The codebase regression tests are the recurrence safeguard. Rollback is reverting this change; no migration is needed.

## 6. Delivery

Issue: #3599. PR: [#3615](https://github.com/xiechimon/cairn/pull/3615). Implementation uses the current Codex session; review uses the repository's Codex cloud review bound to the PR head. pnpm-workspace.yaml is protected: keep coordinator-hold on the PR and report it. No runtime memory, internal addresses or live identifiers may enter public evidence.
