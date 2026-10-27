# Cross-task experience distillation: traj:reflect and traj:curate (#1577)

Following ACE (Agentic Context Engineering, https://arxiv.org/abs/2510.04618) and its three-role split: the producer is the agent running builds normally; the reflector reads trajectory packs (the output of `pnpm traj:export` from #1511 / #1514) to find reusable experience; the curator deterministically merges and dedupes experience entries and then decides where each lands.

Both commands are developer-side offline tools and do not enter the server runtime path. Path parameters resolve under the `apps/server` directory (the working directory of `pnpm --filter`); passing absolute paths is the most reliable.

## 1. Reflect: `pnpm traj:reflect`

```sh
CAIRN_REFLECTOR_BASE_URL=https://<openai-compatible-endpoint>/v1 \
CAIRN_REFLECTOR_API_KEY=<key> \
pnpm traj:reflect --in /abs/packs.jsonl --out /abs/candidates.jsonl --model <low-cost-model-id>
```

- The endpoint is an OpenAI-compatible `POST <base>/chat/completions` with `response_format: json_object` and `temperature: 0` — the same shape as `traj:label` (#1606), swapped to the two `CAIRN_REFLECTOR_*` variables.
- Only two kinds of builds are reflected; everything else is recorded as `not_eligible` without calling the model:
  - failed-then-green: `judgments.ciFixRounds > 0` and `outcome.merged === true`, with no rollback within 7 days and no later fix by a subsequent PR;
  - rejected by a human: `judgments.plan` has a `revision`, or `judgments.diff` has a `revision` / `restart`.
- The model reply must be `{"candidates": [...]}`. If any entry's kind is not in the vocabulary, a `skill` entry misses the skill name or the skill name is not a safe directory name, the evidence is empty, or the evidence points at a step or message that does not exist in the trajectory, the whole run fails and writes no output.
- For tasks imported from GitHub issues (`sourceRef` shaped like `github:owner/repo#N`), the spec pack sent to the model sits inside the #1406 fence; any output that carries the fence's first line, or verbatim copies any line from the spec that is not shorter than 20 characters, is dropped and counted into `rejected`.
- If the output file already exists, the run refuses rather than overwriting.

stdout: `reflected=<n> not_eligible=<n> candidates=<n> rejected=<n> out=<path>`

### Each line of candidates.jsonl (`experienceCandidateSchema`, `packages/shared/src/experience-candidate.ts`)

| Field | Description |
|---|---|
| `kind` | `memory` / `skill` / `guard` |
| `title`, `content` | The entry's title and body |
| `skill` | The skill directory name for the `skill` kind, `null` otherwise |
| `evidence` | `[{stepId, messageIndex}]`, pointing into the pack's `process.steps[].transcript[]` |
| `buildId`, `agentId` | The source build and the agent that ran it |
| `buildSucceeded` | Whether that build merged and was not rolled back or later fixed |
| `reflector`, `reflectedAt` | The reflecting model id and the time (milliseconds) |

The candidate's `project` is not written here: the curation step looks up the todo's team and project from the database by `buildId`.

## 2. Curate: `pnpm traj:curate`

```sh
pnpm traj:curate --in /abs/candidates.jsonl [--out-dir <dir>]
pnpm traj:curate --confirm <candidateId> [--force]
pnpm traj:curate --dismiss <candidateId>
```

Reads and writes the local database (`server/server.db` under `CAIRN_HOME`, the same database as the server). `--out-dir` defaults to `<CAIRN_HOME>/server/experience-candidates/`.

Dedup: when the title and body both satisfy #1574's similarity judgment (`overlaps` in `services/memory.ts`), and the agent, team, and project are the same, the entries are treated as one — only the evidence and the build list are merged.

Routing by kind:

- `memory`: if formal memory of the same agent and the same project (or global) already holds the same body, skip it (`memory_known`). Otherwise write into the `memory_candidate` table with status `pending`, and `conflictIds` records the formal memories similar to it. Pending entries do not enter `agent_memory`, so they are not injected into any step.
- `guard`: write into `<out-dir>/guard-candidates.jsonl`, to be converted into protection candidates by #1535. This ticket does not implement #1535.
- `skill`: generate a unified-diff patch draft for `<skill-root>/<skill>/SKILL.md` (a new-file patch when the skill does not exist); the patch lands at `<out-dir>/skill-drafts/<id>.patch` and the index at `<out-dir>/skill-drafts.jsonl`. The skill file itself is not modified.

Promotion (memory only):

- At least 2 pieces of evidence from different builds (`PROMOTION_MIN_BUILDS`);
- and one of: a human runs `--confirm`; or the same entry appears again in a new build, and that build succeeded.
- Promotion goes through #1574's `saveMemoryEntry`: when a similar memory hits, no new entry is created — the candidate is written back into `conflictIds` and stays `pending`; a human confirmation may add `--force` to create the entry anyway. After promotion the status is `promoted`, `memoryId` points at the new memory, and `sourceBuildId` is the build holding the last piece of evidence.
- After `--dismiss` the status is `dismissed`; the same entry appearing later only merges evidence and is never promoted again.
- Entries carrying the #1406 fence's first line are intercepted once more at curation time (`rejected`); entries whose `buildId` cannot be found in the database count into `build_missing`.

stdout: `memory_pending memory_merged memory_known memory_promoted guard_new guard_merged skill_new skill_merged rejected build_missing out_dir`

### The memory_candidate table

`id, agentId, teamId, projectId, title, content, status(pending|promoted|dismissed), buildIds(json), evidence(json [{buildId, stepId, messageIndex}]), conflictIds(json), memoryId, createdAt, updatedAt`. Internal table, not exposed on the wire (`INTERNAL_ONLY_TABLES`). Migration `apps/server/drizzle/0052_memory_candidate.sql`.

### Each line of guard-candidates.jsonl (`guardCandidateSchema`)

```json
{
  "id": "<record id>",
  "teamId": "<team>",
  "project": "<project id>",
  "agentId": "<agent id>",
  "title": "...",
  "content": "...",
  "buildIds": ["<build id>", "..."],
  "evidence": [{ "buildId": "...", "stepId": "...", "messageIndex": 0 }],
  "createdAt": 0,
  "updatedAt": 0
}
```

The whole file is rewritten on each curation run (write a `.tmp` file in the same directory first, then rename over it); the same entry only merges `buildIds` and `evidence` across runs.

### Each line of skill-drafts.jsonl (`skillDraftSchema`)

All fields of a guard row, plus `skill` (the skill directory name) and `patch` (the patch path relative to `<out-dir>`). The patch is computed against the SKILL.md as of draft generation; a human reviews it and then applies it under the skill root with `git apply` or `patch -p1`.
