# Escape trace resolution verification

Resolve #1952 candidate JSON to introducing commits and merged PRs.

```sh
node --test scripts/escape-trace.test.mjs
node scripts/escape-trace.mjs candidates --since 2026-10-01T00:00:00Z --until 2026-10-15T00:00:00Z \
  | node scripts/escape-trace.mjs trace --respond-file /path/to/recorded.json
```

`red.log` is the suite failing on main before `resolveTraces` existed (missing export). `green.log` is 14 passing cases after implementation: #1884 wrong-attribution (`introduced by #100` vs trailing fixing `(#201)`), revert-body SHA resolution, `Fixes #N` issue-not-pr retention, parent blame with file/line evidence, multiple-origin blame, shallow unresolved reason, exactly-14-day window vs +1s outside-window, introducing merge before `--since`, resolved trace shape, and `candidates | trace` CLI wiring with a recorded responder.

Resolution order is revert body, then validated explicit references, then blame on the fix parent. Tests inject a recorded GitHub responder; the command performs no network writes. Candidate collection semantics from #1952 are unchanged. Review classification and weekly aggregation stay out of this ticket.

## quotePath blame fix (review-gate BLOCK)

`red-quotepath.log` is the suite on tip `f1d073d4` before header decoding: the #1884 explicit-reference case lacked file/line ranges, and quotePath-quoted `diff --git` headers left blame unresolved or collapsed mixed quoted/ordinary paths to a single origin.

`green-quotepath.log` is 17 passing cases after `parseDiffGitPaths` accepts C-quoted headers (`\t`, `\n`, `\\`, `\"`, octal) and revert/explicit-reference resolutions attach parent blame ranges as evidence. Also covers `unavailable-pr-metadata` when commit-to-PR lookup finds nothing.

## UTF-8 octal and unquoted space paths (tip-bound BLOCK on 93dce549)

`red-utf8-space.log` is the suite before decoding: `"\303\251.txt"` became `Ã©.txt`, and unquoted `a/space name.txt` split into `space`. `green-utf8-space.log` is the passing parseDiffGitPaths / blame cases after UTF-8 byte assembly of octal escapes and splitting unquoted headers on ` b/` / ` /dev/null`.

Open #2120 (reviewer-bank export) also edits `scripts/escape-trace.mjs` additively for export/validate; this change only fixes header path decoding shared by blame.

## Mixed quoted/unquoted rename headers (tip-bound BLOCK on 8276b10d)

`red-mixed-quote.log` is the suite on tip `8276b10d` before restore: `diff --git "a/tab\tname.txt" b/plain.txt` and the reverse both returned `null` because the revised parser required the second token to be quoted or `/dev/null` after a quoted first, and never looked for a quoted second after an unquoted first. `green-mixed-quote.log` is the passing parseDiffGitPaths case after each side is read independently (quoted with UTF-8 octal decode, or unquoted via ` b/` / ` /dev/null` / ` "` split). Prior UTF-8 octal and unquoted space coverage is unchanged.
