# Worker prompt observation

The prompt helper was observed with its source changes still uncommitted. The source SHA-256 in worker-overlap-runtime.json matches the delivered prompt module. The loaded package entry is resolved at runtime and checked against the Git root, avoiding an assumed workspace depth. The original depth assumption and actual ENOENT are preserved in observer-depth-red.log.

The observation confirms the overlap instructions are emitted and the task text keeps its classification. It does not test a live model, semantic duplicate detection, GitHub writes, chief dispatch, or deployment. worker-prompt-red.log records the missing instructions before implementation; worker-prompt-green.log covers 79 prompt/protocol cases afterward.

From the repository root, replay with:

```sh
pnpm --filter @cairn/integration exec tsx -e '
import { buildWorkBranchNote, appendWorkBranchNote, stripWorkBranchNote, classifyUserText } from "@cairn/shared";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, resolve, relative } from "node:path";
import { execFileSync } from "node:child_process";
const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const source = resolve(dirname(createRequire(resolve("package.json")).resolve("@cairn/shared")), "records/prompts.ts");
if (relative(root, source) !== "packages/shared/src/records/prompts.ts") throw new Error("Wrong workspace dependency");
const task = { title: "Task", spec: "Spec" };
const text = task.title + "\n\n" + task.spec;
const delivered = appendWorkBranchNote(text, "cairn/work");
const note = buildWorkBranchNote("cairn/work");
console.log(JSON.stringify({ sourceModule: relative(root, source), sourceSha256: createHash("sha256").update(readFileSync(source)).digest("hex"), sourceResolvedFromPackageEntry: true, classification: classifyUserText(delivered, task), baseTaskTextPreserved: stripWorkBranchNote(delivered) === text, englishOverlapSuffix: note.slice(note.indexOf("\n") + 1), scope: "Runtime prompt helper only; no live model or GitHub write" }, null, 2));
'
```
