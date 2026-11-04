# bench

Public benchmarks: runs Cairn on SWE-bench Verified and Terminal-Bench through Harbor and writes a pass-rate report.

- Run a suite: `python -m bench.run --suite swe-bench-verified`
- Write the report: `python -m bench.report results/latest.jsonl`
