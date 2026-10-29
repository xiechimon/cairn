# Review remediation (tip after aa6daea3)

Independent review BLOCK on tip `aa6daea3`. Items:

1. Fixed: `run-heldout.mts` invokes an evaluator (default: `run-eval.mts`), derives
   Wilson aggregates from `results.jsonl`, removed `--scores`. Test injects a
   fake evaluator and checks scores come from its results; stdout has no prompts.
2. Pending product-owner: omarchy production run has real cost. Metrics file and
   PR Risk/Acceptance state this honestly; no invented pass rates.
3. Fixed: labelers receive agent/project descriptions; never `dispatchedTo`.
4. Fixed: redaction covers `/srv` (and peers), single-label hosts, standalone
   private repos, Chinese personal names; synthetic test added.
5. Fixed: export uses latest user message at or before first chief-build time;
   drops cases with no recoverable trigger. Unit tests added.
