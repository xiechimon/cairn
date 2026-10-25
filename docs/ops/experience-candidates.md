# 跨任务经验沉淀：traj:reflect 与 traj:curate（#1577）

照 ACE（Agentic Context Engineering，https://arxiv.org/abs/2510.04618）的三角色拆：生成者是正常跑构建的 agent；反思者读轨迹包（#1511 / #1514 `pnpm traj:export` 的产物）找可复用的经验；整理者把经验按条目确定性合并、去重，再决定落到哪里。

两条命令都是开发者侧的离线工具，不进 server 运行路径。路径参数在 `apps/server` 目录下解析（`pnpm --filter` 的工作目录），传绝对路径最稳。

## 1. 反思：`pnpm traj:reflect`

```sh
CAIRN_REFLECTOR_BASE_URL=https://<openai 兼容端点>/v1 \
CAIRN_REFLECTOR_API_KEY=<key> \
pnpm traj:reflect --in /abs/packs.jsonl --out /abs/candidates.jsonl --model <低成本模型 id>
```

- 端点是 OpenAI 兼容的 `POST <base>/chat/completions`，`response_format: json_object`，`temperature: 0`，与 `traj:label`（#1606）同一形态，换成 `CAIRN_REFLECTOR_*` 两个变量。
- 只反思两类构建，其余记 `not_eligible`，不调模型：
  - 失败后转绿：`judgments.ciFixRounds > 0` 且 `outcome.merged === true`，且没有 7 天内回滚或被后续 PR 修正；
  - 被人打回过：`judgments.plan` 有 `revision`，或 `judgments.diff` 有 `revision` / `restart`。
- 模型回复必须是 `{"candidates": [...]}`。任一条 kind 不在词表、`skill` 类缺技能名或技能名不是安全目录名、证据为空、证据指向轨迹里不存在的步或消息，整次运行失败，不写输出。
- 从 GitHub issue 导入的任务（`sourceRef` 形如 `github:owner/repo#N`），送给模型的 spec 包在 #1406 的围栏里；产出里带围栏首行、或逐字抄了 spec 里任一条不短于 20 个字符的行，丢弃并计入 `rejected`。
- 输出文件已存在则拒绝，不覆盖。

stdout：`reflected=<n> not_eligible=<n> candidates=<n> rejected=<n> out=<path>`

### candidates.jsonl 每行（`experienceCandidateSchema`，`packages/shared/src/experience-candidate.ts`）

| 字段 | 说明 |
|---|---|
| `kind` | `memory` / `skill` / `guard` |
| `title`、`content` | 条目标题与正文 |
| `skill` | `skill` 类为技能目录名，其余为 `null` |
| `evidence` | `[{stepId, messageIndex}]`，指向轨迹包 `process.steps[].transcript[]` |
| `buildId`、`agentId` | 来源构建与执行它的 agent |
| `buildSucceeded` | 该构建是否合并且未被回滚或后续修正 |
| `reflector`、`reflectedAt` | 反思模型 id 与时间（毫秒） |

票面的 `project` 不写在这里：整理步按 `buildId` 从库里查 todo 的团队与项目。

## 2. 整理：`pnpm traj:curate`

```sh
pnpm traj:curate --in /abs/candidates.jsonl [--out-dir <dir>]
pnpm traj:curate --confirm <candidateId> [--force]
pnpm traj:curate --dismiss <candidateId>
```

读写本机库（`CAIRN_HOME` 下的 `server/server.db`，与 server 同库）。`--out-dir` 默认 `<CAIRN_HOME>/server/experience-candidates/`。

去重：标题与正文同时满足 #1574 的相似判定（`services/memory.ts` 的 `overlaps`），且 agent、团队、项目相同，视为同一条，只合并证据与构建列表。

按 kind 分流：

- `memory`：同 agent、同项目或全局的正式记忆里已有同正文，跳过（`memory_known`）。否则写入 `memory_candidate` 表，状态 `pending`，`conflictIds` 记下与之相似的正式记忆。待确认条目不进 `agent_memory`，所以不会注入任何步。
- `guard`：写入 `<out-dir>/guard-candidates.jsonl`，交给 #1535 转成防护候选。本票不实现 #1535。
- `skill`：生成对 `<技能根>/<skill>/SKILL.md` 的统一 diff 补丁草稿（技能不存在时为新建文件的补丁），补丁在 `<out-dir>/skill-drafts/<id>.patch`，索引在 `<out-dir>/skill-drafts.jsonl`。不改技能文件本身。

转正（只对 `memory`）：

- 至少有 2 条不同构建的证据（`PROMOTION_MIN_BUILDS`）；
- 并且满足其一：人跑 `--confirm`；或同一条在新的构建里再次出现，且那次构建成功。
- 转正走 #1574 的 `saveMemoryEntry`：命中相似记忆时不新建，把候选写回 `conflictIds`，保持 `pending`；人确认时可加 `--force` 照样新增。转正后状态 `promoted`，`memoryId` 指向新记忆，`sourceBuildId` 为最后一条证据所在构建。
- `--dismiss` 后状态 `dismissed`；之后再出现的同一条只合并证据，不再转正。
- 带 #1406 围栏首行的条目整理时再拦一次（`rejected`）；`buildId` 在库里查不到的计入 `build_missing`。

stdout：`memory_pending memory_merged memory_known memory_promoted guard_new guard_merged skill_new skill_merged rejected build_missing out_dir`

### memory_candidate 表

`id, agentId, teamId, projectId, title, content, status(pending|promoted|dismissed), buildIds(json), evidence(json [{buildId, stepId, messageIndex}]), conflictIds(json), memoryId, createdAt, updatedAt`。内部表，不出 wire（`INTERNAL_ONLY_TABLES`）。迁移 `apps/server/drizzle/0052_memory_candidate.sql`。

### guard-candidates.jsonl 每行（`guardCandidateSchema`）

```json
{
  "id": "<记录 id>",
  "teamId": "<团队>",
  "project": "<项目 id>",
  "agentId": "<agent id>",
  "title": "...",
  "content": "...",
  "buildIds": ["<构建 id>", "..."],
  "evidence": [{ "buildId": "...", "stepId": "...", "messageIndex": 0 }],
  "createdAt": 0,
  "updatedAt": 0
}
```

每次整理整份重写（先写同目录的 `.tmp` 文件，再改名覆盖），同一条跨次运行只合并 `buildIds` 与 `evidence`。

### skill-drafts.jsonl 每行（`skillDraftSchema`）

guard 行的全部字段，加 `skill`（技能目录名）与 `patch`（相对 `<out-dir>` 的补丁路径）。补丁按草稿生成时的 SKILL.md 计算，人工审阅后用 `git apply` 或 `patch -p1` 在技能根下应用。
