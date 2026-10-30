# #2193 evidence

- `has-code-2188.log`: `hasCode` on the exact file list of #2188 (54195adb0). origin/main returns `true` (CI ran e2e and vitest for 8 minutes); this branch returns `false`.
- `prepush-test-red-assertions.log`: the new `scripts/prepush.test.mjs` cases against the origin/main classifier: 5 assertion failures (non-Markdown evidence, the #2188 list, evidence routing to doc-reader tests and e2e, the doc-reader selection, the silent-revert step).
- `prepush-test-red.log`: the final test file against origin/main `scripts/prepush.mjs`: the import of `workflowTestSteps` fails.
- `prepush-test-green.log`: 50 of 50 pass on this branch.
- `heavy-slot-lock-dir.log`: with `TMPDIR=/private/tmp/sandbox-override`, the origin/main formula puts the slot locks in a private directory; `slotLockDir` returns the shared one that other lanes use.
- `heavy-slots-test-green.log`: 25 of 25 pass, including the overridden-TMPDIR case and the fixture-repo prepush cases.
