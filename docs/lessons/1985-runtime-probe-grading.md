---
Category: Optional Node CPU probes caused a local check to fail boundary grading
Source: Issue #1985 (2026-10-27)
Level: 2
Safeguard: A compiled C classification harness checks exact probe paths, locale directory prefixes and neighboring forbidden paths; prefix lengths come from strlen rather than duplicated numeric constants. Real subprocess positive controls run under Vitest wherever Linux x86_64 with gcc and ldd is present, runtime denials are separated from task violations, and grading fails closed on every other platform
Intercepts: 2
Recurrences: 2
Notes: classification-red.log reproduces the coreutils locale-prefix mismatch against HEAD before the fix: the prefix compare used a duplicated length of 30 for a 29-byte literal, so every denial under /usr/share/coreutils/locales/ was graded as a task violation on the CI runner even though the same path was classified correctly in reasoning. Deriving the length with strlen removes the duplicated constant. prepush-runtime-red.log records denied CPU probes that did not appear in the focused run; those exact probes remain denied and are separately recorded. The exact-path probe list still missed Ubuntu runtime reads (coreutils locale data, /proc/version_signature, socket capability denials), red on CI; classification by syscall and path prefix (socket, io_uring, /proc/, /sys/, locale data) replaced the exact paths, with a real-process probe control added
---
