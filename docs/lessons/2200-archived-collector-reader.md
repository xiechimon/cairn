# Archived checks can keep retired state active

After removing the lessons event stream, prepush selected `docs/verify/2136/review-check.test.mjs` because it reads a changed document. Its collector assertion still opened the removed event file and failed.

The archive remains unchanged. Its automatic selection is excluded in `scripts/prepush-known-red.json`, while the current commit-author recovery tests remain active. `scripts/doc-reader-tests.test.mjs` now checks both sides: the collector archive is excluded and the current identity safeguards are selected. The new expectation failed before the configuration change and passed afterward.
