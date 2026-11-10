# Thread-tag UI retirement proof

Base: main db61ebe0a8a9e10f9badc52d55ca1057df703dab, after #3782. The [brief](../../design/thread-tag-ui-retirement-3481.md) records the current source audit, approved removal scope and opened settings references.

## Red-first and regressions

Before removal, two source-contract tests failed on the settings tab and category query/mutation exports. Four browser cases failed because the retired tab still existed. The independent GitHub-label preservation source contract already passed.

After removal, ten targeted Vitest cases across four contracts pass. The changed-only selection runs the three newly affected source contracts; the disk-loaded mapper/files/history contracts were also run explicitly. Scoped affected browser tests pass 40 cases across five specs: the new retirement matrix, project identity, repository settings, memory and GitHub issue picker. The latter is fixture/stub evidence for chips/import UI, not a real GitHub request.

## Isolated live stack

The real server entry point and Vite ran on independent ports with a fresh isolated data root, authentication off and the in-server Coordinator disabled. No fixture scenario, production data, GitHub connection or provider was used. Main was captured before production edits; both processes were stopped, changed code was applied, and a fresh stack was captured afterward. Both owned processes were stopped after each run.

| Observation | Before | After |
|---|---|---|
| Category destination | One tab | No tab |
| Remaining settings destinations | Basic, Repository and Memory | Same three destinations |
| Persistent rename | Saved through UI and survives reload | Saved through UI and survives reload |
| Category HTTP requests | Zero while visiting settings | Zero while visiting settings |
| Document horizontal overflow | Zero at 1440/390, light/dark | Zero at 1440/390, light/dark |
| Ordinary thread | Derived title, complete spec and todo phase preserved | Same assertions pass |

[Before observations](tags-ui-live-before/result.json) and [after observations](tags-ui-live-after/result.json) contain no instance identifiers. Screenshots and reference pairs are on asset commit 64dfa61d820310826d9a9d4d8b7aae6bb15ab3fb, under `docs/verify/3481/tags-ui-live-before`, `tags-ui-live-after` and `tags-ui-reference-comparison`.

All four reference pairs were inspected. Settings composition is unchanged apart from removing the dead destination. Phone form controls remain wider/cramped compared with the reference, already present in the main capture; zero document scrolling is not a claim that every existing phone control is well laid out. Dark comparisons use the light reference for composition only, not color matching.

## Limits and rollback

No new error/loading/offline/long-content/pending-question state is introduced or claimed verified. Existing settings error and memory behavior has separate browser regressions. This does not retire backend routes, persisted categories, wire fields, agent tools, generic fixtures or active registry/spec entries; those remain subsequent work for #3481. GitHub label chips and status tags are unchanged. Feature-map generation produces no changes.

Rollback is a code revert; no persisted state, server schema, dependency or machine/MCP protocol changes. No full local e2e suite or real-provider/GitHub behavior is claimed.
