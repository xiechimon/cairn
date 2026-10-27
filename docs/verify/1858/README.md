# Chief-dispatch recovery and reporting acceptance

The original PR head is `d84fef50cd4facba2ed254f57107d226f8ab33e5`. Its prior PASS did not cover the remaining truncated-row inflation, policy binding, or the owner's zero-pass oracle addition. The repair imports the original diff with a squash operation into a fresh main-based delivery, so unrelated historical commit prose cannot become the default merge message.

## Negative and positive controls

`acceptance-red.log` records nine failures and three passes before implementation. Those controls exercise the generated HTML and both real harness-path consumers. They reject truncated or missing-grade coverage, unknown repetition identities, missing suspect-task handling, and missing policy bindings. `mixed-repetition-red.log` records a later failure when valid and unknown repetitions were mixed. `acceptance-green.log` records the initial 109 passing cases across five relevant suites. Independent review then found that error-only variants were omitted. `error-only-red.log` records both reproductions before the fix; `error-only-green.log` records 111 passing cases across the same five suites afterward. Assertions, the 80% coverage floor, and the existing regression threshold remain intact.

`scoredValue` is shared by means and coverage. A family containing an unknown repetition identity cannot establish a complete grid. Suspect decision tasks have zero passing observed trials across at least three distinct repetitions. The report invokes the actual reference, empty-turn, and wrong-agent controls from `oracle-check.mts`; an unverified suspect withholds the headline. A passing oracle does not replace the model's zero grade. Variants with recorded errors remain visible even without any result rows. Their observed case IDs also appear in the case table; coverage and suspect-task checks still apply. Empty, unstarted variant directories remain excluded.

The retry implementation, its imported budget, coverage, oracle checker, and report builder enter both the shared harness binding and the saved path declaration. The saved `harness_sha` stays unchanged, so future runs need fresh approval instead of inheriting a fabricated approval for the new code.

## Real runtime, local provider stub

The canonical registered entry runs under an available heavy slot:

```sh
TMPDIR=/private/tmp VERIFY_EVIDENCE_DIR=/tmp/chief-retry-proof node scripts/heavy-slots.mjs run -- node .claude/skills/verify-cairn/scripts/vp.mjs drive chief-dispatch-recovery
```

`probe-registry-red.log` and `probe-entry-red.log` record the missing registration before its fix. `probe-registry-green.log` validates the indexed case; `probe-entry-green.log` and `registered-retry-proof.json` record a successful execution through the canonical entry. The existing reach check remains unchanged.

`retry-runtime-proof.json` and `retry-runtime.log` record the real server, daemon, and eval CLI. A local provider returns HTTP 400 once and HTTP 200 next. The CLI finishes with one successful result, `infra_retries=1`, and `decision_ok=1`. The fixture performs no real-model call. It does not establish paid-provider reliability or a fresh model-quality baseline.

## Pinned historical report

```sh
python3 docs/verify/1858/replay-history.py --source 3e29c5631885f6d8ba4d049b0e2333bed353c8a2 --out /tmp/chief-historical-proof
```

The script loads cases, metric configuration, results, and errors from one commit. It validates the documented 64-case, 176-result, 16-error batch and the `decision_ok` configuration before running either executable. `history-source-red.log` records the actual wrong-batch rejection. `history-source-green.log`, `history-manifest.json`, and `historical-report.html` record the successful complete replay. The output includes `s 7/18`, `s01 0/3` with its oracle verified, and a withheld headline. Oracle controls pass 64/64 reference cases, reject all 64 empty-turn controls, and reject all 44 wrong-agent controls.

The current main and original PR head contain a later 30-result, 46-error batch. Initial ad-hoc replay attempts wrongly assumed the old batch and omitted its metric configuration. The structured replay entry now rejects those inputs before execution; all committed evidence identifies its actual source. This historical report is a replay of recorded results, not a current-model score.

## Attribution and limits

`original-roster-attribution.txt` preserves the original legacy lesson row. The eval PR has no roster-data change, and the underlying catalog mismatch is already documented in `docs/lessons/1774-model-roster-data-generated-from-the-lane-s-own-install.md`. The delivery preserves main's per-file lessons and records only errors actually addressed here.

The historical s-family records establish failed-step and missing-usage shapes. Their original database and detailed provider errors are unavailable. The postmortem records that limitation and links the related product retry and reliability work; it does not claim a recovered historical provider error. The runner's gate-facing `--write-verify` format and raw score behavior remain unchanged, as disclosed in the issue's prior review. No fresh paid-model baseline or change to scoring thresholds is claimed.
