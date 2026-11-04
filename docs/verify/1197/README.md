# #1197 plan diff line counts

Live stack: `VERIFY_PORT` 8791, `VERIFY_WEB_PORT` 5273, `PACMAN_HOME` `.claude/verify-run/home`. No daemon, no LLM.

One card, two plan.md versions. v1 contains a `---` separator. v2 replaces that line with `++x`. Everything else is unchanged.

`GET /api/documents/pln1197v2/diff` on the running server. The hunk is the same before and after:

```
----
+++x
\ No newline at end of file
```

`----` is the deleted separator (`-` plus `---`). `+++x` is the added line (`+` plus `++x`). The no-newline marker stays uncounted.

| surface | before | after |
|---|---|---|
| API `additions` / `deletions` | 0 / 0 | 1 / 1 |
| doc pane header | `· 1 个文件改动 +0` | `· 1 个文件改动 +1 −1` |
| file row | `plan.md +0` | `plan.md +1 −1` |

Files: `before-api.json`, `before-diff-pane.png`, `before-ui-counts.txt`, `after-api.json`, `after-diff-pane.png`, `after-ui-counts.txt`.

Unit repro, same inputs, before the fix:

```
FAIL  test/documents.test.ts > computeUnifiedDiff line counts > counts a deleted --- separator and an added ++x line
AssertionError: expected +0 to be 1
```

After the fix the same file passes, and `pnpm --filter @xiechimon/pacman test` is 102 files, 1088 tests passed.
