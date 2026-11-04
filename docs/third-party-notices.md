# Third-party notices

Cairn is licensed under the Apache License, Version 2.0 (see `LICENSE`).

This product includes software derived from Rakazo, Apache License 2.0:
the desktop command guard in apps/daemon/src/computer/guard*.ts and its tests are ported from
packages/adapters/src/desktop-command-guard.ts, desktop-guard-heredoc.ts, desktop-guard-quoted.ts and
desktop-guard-words.ts; the host computer's command deadlines and environment allowlist follow
host-computer-protocol.ts and sandbox-command-environment.ts.

The shell tokenizer in apps/daemon/src/computer/guard-shell-parse.ts is a TypeScript port of the parse
function of shell-quote (https://github.com/ljharb/shell-quote), MIT License, Copyright (c) 2013 James Halliday.
