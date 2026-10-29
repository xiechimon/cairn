# chief-dispatch-real

Capability split for chief dispatch, built from real omarchy dispatch failures.

Raw exports, redacted cases, labels, and both halves live on omarchy under
`~/.local/share/cairn-eval/dispatch-real/`. Nothing per-case from production
enters this public repository.

The held-out half is sealed with `createKeyfileSecretBox` and keyfile
`~/.cairn/eval-heldout.key` (mode 600). Only the scheduled eval runner opens it,
into a temp directory removed on exit. The runner prints aggregate scores only.

Limitation: lanes on omarchy share one unix user, so "hidden from prompt editors"
is sealing plus "never print case text", not an OS boundary.

## Pipeline (omarchy)

```sh
ROOT=~/.local/share/cairn-eval/dispatch-real
mkdir -p "$ROOT"

pnpm exec tsx integration/eval/chief-dispatch-real/export.mts \
  --db ~/.cairn/server/server.db \
  --out "$ROOT/raw.json"

pnpm exec tsx integration/eval/chief-dispatch-real/redact-cli.mts \
  --in "$ROOT/raw.json" \
  --out "$ROOT/redacted.json"

# Two free-channel labelers from different vendors. Do not pass dispatchedTo.
CAIRN_LABELER_A_BASE_URL=... CAIRN_LABELER_A_API_KEY=... \
CAIRN_LABELER_B_BASE_URL=... CAIRN_LABELER_B_API_KEY=... \
pnpm exec tsx integration/eval/chief-dispatch-real/label-cli.mts \
  --in "$ROOT/redacted.json" \
  --out "$ROOT/labeled.json" \
  --vendor-a glm --vendor-b deepseek

pnpm exec tsx integration/eval/chief-dispatch-real/split-cli.mts \
  --in "$ROOT/labeled.json" \
  --out "$ROOT" \
  --keyfile ~/.cairn/eval-heldout.key
```

## Run halves

Visible half (prompt editors may read `cases.json`):

```sh
pnpm exec tsx integration/eval/chief-dispatch/run-eval.mts \
  --flow "$ROOT" \
  --variant baseline
```

Held-out half (opens sealed cases, runs `run-eval.mts`, prints scores only):

```sh
pnpm exec tsx integration/eval/chief-dispatch-real/run-heldout.mts \
  --sealed "$ROOT/heldout.sealed" \
  --keyfile ~/.cairn/eval-heldout.key
```

Record aggregate counts, agreement rate, and pass rates per half (with intervals)
in `.claude/hillclimb/chief-dispatch-real/metrics.md`. Never paste case text.

## Who may open the held-out half

Only the scheduled eval runner process. Prompt editors use the visible
`cases.json` only. The 64-case set under `.claude/hillclimb/chief-dispatch/`
remains the regression gate and is not modified by this pipeline.
