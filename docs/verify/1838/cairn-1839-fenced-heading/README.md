# Fenced section-heading control

A feature plan containing its only Prior art heading inside a backtick-fenced example received score 1. The new regression first failed with expected 0 and received 1 (`red.log`). Section discovery now ignores headings inside those examples. The same four related suites pass 73 tests (`green.log`), and lint, typecheck and spec parsing pass.

The earlier `cairn-1839-review-evidence` archive records the preceding 72-case candidate and its complete prepush. A fresh normal push hook must validate the final candidate. Home-directory prefixes in these logs are normalized to `<home>`.
