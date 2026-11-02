Model anthropic/claude-haiku-5-5; spend 1.008 USD (all arms, including summaries).

| Arm | Live turns | Prompt tokens per turn (mean) | Cache-read share, all requests | Cache-read share, first request of turn | TTFT p50 / p90 ms | Summaries (paid) | Summary over an unchanged range | Recall with search_history | Recall without | Cost USD |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| a0-resume-pi-default | 19 | 566697 | 99.9% | 99.9% | 1353 / 3087 | 0 | 0 | yes (no tools) | yes (no tools) | 0.736 |
| a1-resume-tuned-compaction | 19 | 114424 | 97.9% | 95.9% | 965 / 5290 | 1 | 0 | yes (no tools) | yes (no tools) | 0.128 |
| b1-fresh-retrieval | 19 | 116113 | 82.0% | 54.9% | 3392 / 4393 | 0 | 0 | yes (read_history) | no (no tools) | 0.086 |
| b2-fresh-retrieval-aligned8 | 19 | 103682 | 89.4% | 75.9% | 3484 / 4632 | 0 | 0 | yes (read_history) | no (no tools) | 0.057 |
