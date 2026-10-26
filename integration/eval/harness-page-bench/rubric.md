# Scoring rubric

Three layers. Layer 1 and 3 are implemented by scripts in this directory. Layer 2 is blind pairwise comparison by a strong model.

## Layer 1: machine judge (per run)

Pass/fail checks:

- Build: the page builds or opens without a build error.
- Console: no console errors during a scripted interaction.
- Playwright: screenshots captured at desktop and mobile widths.
- Requirements: each question's requirement checklist asserted individually (boolean per requirement).

Score = (number of passing requirements) / (total requirements). Build failure = 0.

## Layer 2: blind pairwise

Screenshots are shuffled and compared by a strong model. For each pair (A, B) the model returns a winner and a short reason. Each pair is judged in both orders (A vs B, B vs A) to cancel position bias. Ties allowed.

## Layer 3: human spot check

Carried by a Langfuse annotation queue. Not implemented here. Model-judge and human agreement is analyzed in Langfuse.

## Cost reporting

For each run record wall time, input tokens, output tokens, cache read/write, and retry count. Report quality per cost unit.

## Aggregation

Per question, per harness: mean quality score, pass rate, mean cost. Across questions: overall mean and a per-question win matrix.
