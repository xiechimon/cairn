# Harness Page Benchmark (E2)

Compare page generation quality across harnesses while holding everything else constant: model, prompt, time and token budget. Harnesses: pacman, Claude Code CLI, bare pi loop. The bare pi loop arm isolates whether gains come from the harness or from spending more tokens.

This eval is the baseline-comparison layer of the #1510 evaluation loop. Only the harness changes; the model is never fine-tuned.

## Status

Skeleton only. Question bank and scoring rubric are defined here. Model selection and the formal comparison runs are blocked on #1511-#1514 landing and on ian confirming the model tiers.

## Tiers

- Weak: glm-5.3-flash or deepseek-v4.1-flash (1M context).
- Strong: glm-5.3 (1M context).
- MiniMax M3 is excluded.

## Run plan

1. Write question bank + scoring rubric (this directory).
2. Validate question difficulty and scoring with one bare pi loop run on the weak tier.
3. After #1511-#1514 land, run pacman and Claude Code CLI formally and compare against the pre-development baseline.

Scoring layer 3 (human spot check) is carried by a Langfuse annotation queue, not by a custom UI. Machine judging and statistics are implemented here.
