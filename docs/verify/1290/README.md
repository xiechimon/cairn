# #1290 verify evidence — claude binary probe well-known fallback + launchd PATH

The artifacts for each of the two problem faces:

## 1. The probe fallback (`probe-narrow-path.json`)

Reproduction command (a narrow PATH simulating the launchd environment, HOME kept to resolve `~/.local/bin`):

```sh
env -i HOME="$HOME" PATH=/usr/bin:/bin \
  /Users/xmon/.local/share/fnm/node-versions/v24.14.0/installation/bin/node \
  apps/daemon/node_modules/tsx/dist/cli.mjs /tmp/1290-probe-narrow-path.mts
```

Measured output, key points:

- `probeWithFallback`: under `PATH=/usr/bin:/bin` it probes `/opt/homebrew/bin/claude`
  (version 2.1.294), `source: "well-known"` — the fallback hits and names its source.
- `probePathOnlyControl` (`wellKnownDirs: []`, i.e. the pure-PATH behavior before the change):
  `null` under the same narrow PATH — exactly the `not found` launchd reported in the issue.
- `probe-narrow-path-old-code.json`: the same command running origin/main's
  `claude-code-bin.ts` (the old version extracted via git show) returns
  `null` under the narrow PATH — the direct artifact that the old code inevitably lost a homebrew-installed claude in the launchd environment.

## 2. The launchd template (`plist-render-lint.log`)

Using install.sh's sed rendering pipeline to render `com.xiechimon.pacman-daemon.plist.template`
into a copy under /tmp, the rendered PATH string contains `/opt/homebrew/bin:/usr/local/bin`
(after @NODE_DIR@), and `plutil -lint` passes.

Unit-test face: `apps/daemon/test/claude-code-bin.test.ts` failure modes 10-13
(empty PATH + a well-known stub → probed and the source named; PATH present → the fallback is not taken;
all empty → null; no execute bit → skipped; an absolute-path command does not go through the fallback).
