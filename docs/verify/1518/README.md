# 1518 Harbor scoring

Measured on omarchy with Harbor 0.24.0 (`uv tool run --from harbor==0.24.0`). Job directories stay in `/var/tmp/harbor-1518/jobs` and are not committed.

## Separate verifier

| Job | Agent | Reward | Verifier | Exception |
|---|---|---|---|---|
| `hidden-answer-oracle-5` | oracle | 1.0 | separate | none |
| `hidden-answer-tamper-2` | `tamper_agent:TamperAgent` | 0.0 | separate | none |
| `hello-file-oracle` | oracle | 1.0 | separate | none |

The tamper agent wrote `forged` to `/app/answer.txt`, wrote `1` to `/logs/verifier/reward.txt`, and replaced `/tests/test.sh` inside the agent container. The fresh verifier graded the collected artifact against `tests/expected.txt` and recorded 0.0.

`pnpm --filter @cairn/integration exec tsx eval/harbor/score.mts` on those two jobs reports pass@1 1 and 0, excludes no infrastructure trials, and returns `not_significant` because the adoption judge requires five pairs.

## Not measured

The configured Cairn server (`CAIRN_SERVER_URL` in `/var/tmp/harbor-1518/cairn.env`) refused connections (`curl` exit 7), so this run does not include a current-harness baseline, a five-round minimum detectable difference, or a Cairn-in-container smoke. Those numbers are not invented here.
