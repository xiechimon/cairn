# 1957 mainline reachability for the verified bank

## Problem

#1957 shipped in #2120 and #2150. Re-running the real export on 2026-10-29
against the current `origin/main` found that the recorded "verified" cases from
#2150 cannot replay: 11 of the 12 candidates behind them are not ancestors of
`origin/main`.

    $ for s in $(jq -r '.[].followUpSha' docs/verify/1832/candidates.json); do
        git merge-base --is-ancestor $s origin/main && echo REACHABLE $s || echo UNREACHABLE $s
      done
    UNREACHABLE d1bd843080a5894421950f045df1d7b49feaced0
    ... 10 more UNREACHABLE ...
    REACHABLE 05d0dd12e3e9eab720bfd7c4afeb097ed4c0615e

Those commits live in side branches after the #2136 identity-safe mainline
recovery rewrote history. `expandSha` used `rev-parse --verify`, which resolves
any commit object present in the local object store, so both `export-cases` and
`validate-cases` accepted them.

Reproduced before the fix with a schema-valid case built entirely on the orphan
`f0835bbc4d9b2033a348f8c6ac90268e119e8a23` (the introducing/fixing SHA behind
several of #2150's 16 cases):

    $ node scripts/escape-trace.mjs validate-cases /tmp/1957-orphan-bank/cases
    {
      "ok": true,
      "caseCount": 1
    }

That violates the #1957 acceptance criterion "non-replayable histories cannot
silently enter the verified bank", and the same hole let the export write such a
case into `cases/`.

## Fix

`isAncestorOf` gates on `git merge-base --is-ancestor <sha> origin/main`.
`buildCase` refuses with `unreachable-from-mainline`, so export routes the trace
to `candidates.json` instead of the bank; `validateBankCase` fails the case.

## Red

`reachability-red.log`: `node --test scripts/escape-trace.test.mjs` with the
source reverted to `origin/main` (both new tests fail, 32 pass):

    ✖ export refuses a history unreachable from origin/main, keeping the case off the verified bank
    ✖ validate refuses a case whose commits are unreachable from origin/main
    ℹ pass 32
    ℹ fail 2

## Green

`reachability-green.log`: same command with the fix (`tests 34 / pass 34 / fail 0`).

The real orphan case is now rejected:

    $ node scripts/escape-trace.mjs validate-cases /tmp/1957-orphan-bank/cases
    orphan-probe.json: introducingSha is unreachable from origin/main
    orphan-probe.json: fixingSha is unreachable from origin/main
    orphan-probe.json: replay base is unreachable from origin/main

The real bank still validates, and the end-to-end loop still reports the one
reachable candidate explicitly instead of banking it:

    $ node scripts/escape-eval-loop.mjs --since 2026-10-15T00:00:00Z \
        --until 2026-10-29T00:00:00Z --out /tmp/1957-loop \
        --bank-out /tmp/1957-bank --allow-network
    candidates 1, resolved 0, exported 0, ineligible 1 (multiple-origin),
    validation { ok: true, caseCount: 0 }

## Gates

`pnpm lint` 0, `pnpm typecheck` 0, `node scripts/prepush.mjs` PASS (32 checks,
including `node --test scripts/escape-trace.test.mjs` and
`validate-cases integration/eval/review/cases`).
