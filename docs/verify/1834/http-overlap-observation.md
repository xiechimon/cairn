# Real HTTP overlap observation

The shared lookup and production HTTP reader were exercised against GitHub using the existing gh credential in process memory. The credential was neither printed nor written to the report. These runs do not exercise the server's team-connection path, a chief model turn, or any GitHub write.

The serial run in live-http-overlap-red.log aborts at 8,362 ms after 18 requests. The bounded file-read pool then completes all 25 requests in 6,473 ms in live-http-overlap-green.log. That later run occurs after #2073 merged and #2047 closed; its empty file-overlap list reflects the changed repository state. It is not evidence that the original two overlaps never existed. The earlier real CLI summary records those two open PRs at its own timestamp.

The eight-second abort budget, complete-page checks, output budgets and error behavior are unchanged. File reads use at most three workers. Results retain PR input order, a failure stops new queued reads, and outstanding reads settle before the operation throws. The deterministic controls fail before the pool and pass afterward. Network and repository state differ between live runs, so these observations do not establish a general latency guarantee or an isolated speedup ratio.

Run from the repository root with Node 24 and installed dependencies:

```sh
NODE_USE_ENV_PROXY=1 pnpm --filter @cairn/integration exec tsx -e '
import { execFileSync } from "node:child_process";
import { lookupOverlaps } from "@cairn/shared";
import { githubOverlapItems } from "../apps/server/src/lib/github-overlap.ts";
const started = Date.now();
const token = execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
const signal = AbortSignal.timeout(8000);
let requests = 0;
async function main() {
  try {
    const report = await lookupOverlaps({
      repo: "xiechimon/cairn",
      terms: ["contained push", "non-fast-forward"],
      paths: ["apps/daemon/src/git.ts"],
      request: (path) => {
        requests++;
        return githubOverlapItems(fetch, token, path, signal);
      },
    });
    console.log(JSON.stringify({ complete: true, requests, wallMs: Date.now() - started,
      compactBytes: Buffer.byteLength(JSON.stringify(report)), filePulls: report.filePulls.map(p => p.number) }));
  } catch (error) {
    console.log(JSON.stringify({ complete: false, requests, wallMs: Date.now() - started,
      error: error instanceof Error ? { name: error.name, message: error.message } : String(error) }));
    process.exitCode = 1;
  }
}
main();'
```

parallel-overlap-source-files.json records the tested source hashes. The real producer used the same command body with an absolute path to the current worktree's HTTP module and Node 24.14.0. The replay above names that module relative to the integration package, whose exec working directory is integration/.
