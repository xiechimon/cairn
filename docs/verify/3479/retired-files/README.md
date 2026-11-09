# Retired project file-page verification

The file page and its exclusive APIs were removed in #3479. These recipes preserve historical behavior, not current acceptance instructions. Their old commands must not be run against the current application.

- [Local files recipe](project-files-local.md); inert probe: `docs/verify/1030/drive-1030-local-files.mjs.txt`.
- [Folder navigation recipe](project-files-drill.md); inert probe: `docs/verify/1097/drive-1097-folder-drill.mjs.txt`.
- [Retired history verification](../retired-history/README.md).

Current coverage is in `apps/server/test/git-hosting.test.ts`, `apps/server/test/project-local.test.ts`, `apps/server/test/chief-docs.test.ts` and `apps/web/e2e/project-commit-detail.spec.ts`. Recursive file mentions, Coordinator document reads, branch settings and thread diffs remain supported.
