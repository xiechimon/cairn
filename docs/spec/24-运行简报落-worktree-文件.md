# 24 · 运行简报落 worktree 文件（推翻 17·A9）

> 范围：把每一步的 agent 简报从 systemPrompt 通道搬到任务 worktree 的上下文文件，靠 CLI 的原生记忆机制加载。回答三问：A9 当初为什么否掉它、那两条理由今天是否还成立；照 Multica 做到什么程度；换过去之后新增哪些失败面、各自护栏在哪。
>
> References: spec 17 (origin of A9, marked superseded here), spec 14 (skills execution surface; directory scan rules unchanged), Multica source (`execenv/runtime_config.go`, `runtime_config_sections.go`, `repocache/cache.go`, `local_worktree.go`), issues #958 and #917.

## Problem Statement

`docs/spec/17-双运行时执行面.md:58` 的 **A9** 定了两件事：简报（skills catalog）追加进 systemPrompt；**不采** Multica 的 workdir CLAUDE.md 写入法，理由是「会污染 worktree git status，pacman worktree 纪律不容」。同处把「原生 `.claude/skills` 发现」推给了后续票。

A9 的两条前提今天都不成立：

1. **「要写文件才能让引擎看见」不是新增能力，是既有行为。** pi 的 `resource-loader.js:33` 候选表 `["AGENTS.override.md","AGENTS.md","AGENTS.MD","CLAUDE.md","CLAUDE.MD"]` 同目录 first-wins，`loadProjectContextFiles` 从 cwd 逐级上溯收集；`systemPromptOverride` **只替换 customPrompt 段**，不抑制这条加载（`resource-loader.js:383`）。claude-code SDK 的 `settingSources` 缺省即「全部加载」（`sdk.d.ts:2141-2151`，其中 `'project'` 是 CLAUDE.md 的承重档）。也就是说**用户仓库自带的 CLAUDE.md 今天就在被读**，pacman 只是从不写自己那份。
2. **git 洁净有解。** Multica 在 linked worktree 下用不了 `.git/info/exclude`——git 把 `info/exclude` 解析到 common dir（`man gitrepository-layout`：`$GIT_COMMON_DIR/info` 优先），而它 `local_directory` 模式的 common dir 是**用户**仓库（`local_worktree.go:484-492` 原文承认这点），故它改用「提交前擦除」。pacman 的 common dir 是 `<workspacesRoot>/<projectId>/repo/.git`——**pacman 自己的镜像 clone**，与用户仓库无关。

另一条 A9 没算到的账：简报留在 systemPrompt 里时，**它是每轮重算的**（`composeChiefSystemPrompt` 由 `buildChiefClaim` 每次 claim 调用），其中 `machines` 清单含随 presence 心跳翻转的 `online` 字段。Multica 为同一个坑单独立过案（MUL-5377：per-run 值写进简报文件「broke prompt-cache prefix stability on every resume」，已改走每轮用户消息）。

## Solution

| ID | 决策 | 落地形态 |
|---|---|---|
| **B1** | 简报落工作区上下文文件，systemPrompt 通道对这类后端清空 | `AgentBackend.brief?: BriefChannel`（可选能力位）。在位 = 落盘 + 清空；缺席 = 保留 inline systemPrompt（未来第三后端的逃生口，Multica 的 prompt-only mode 同律） |
| **B2** | 落点按引擎**自己的发现序**判定，不按后端名硬编码文件名 | `resolveBriefTarget(entries, backendId, {caseInsensitiveFs})`（packages/shared/brief-file.ts）。大小写敏感度是**参数**：`existsSync('CLAUDE.md')` 在盘上是 `CLAUDE.MD` 时 darwin 为真、linux 为假，判定与写入必须同源 |
| **B3** | 标记块三态写入 + 逐字节擦除 | `<!-- BEGIN PACMAN-RUNTIME (auto-managed; do not edit) -->` / `<!-- END PACMAN-RUNTIME -->`；托管分隔符 `\n\n` **算托管区的一部分**，故擦除能逐字节回滚（无论用户文件以 0/1/2 个换行或 CRLF 结尾），它同时是「我们创建的 vs 追加进用户文件的」判别位 |
| **B4** | 擦除覆盖**每一个写后出口**，擦除失败即挡住提交 | 三处显式调用（openSession 抛错 / 流抛错 / 循环后一次）+ 写失败 fail-closed；擦除失败置旗标 → `commitAll`/`push` 全跳过、步收 failed、transcript 落 system 行 |
| **B5** | 纵深防御：`commitAll` 认**标记内容**剔文件 | `git grep --cached -l -F <标记>` 只扫五个候选名，命中即 `git reset --` 该路径 + workspace 日志 |
| **B6** | 对账扫**全后端候选并集**，落点判定只认本后端 | 同一 worktree 会被不同后端的步复用；pi 步留下的 `AGENTS.md` 若不在 claude-code 步里清掉，会残到那一步的 `git add -A` |
| **B7** | 内容切分：per-run 值不进 systemPrompt | 已随 `#959` 落地：`machines` 清单（含 `online`）移出 chief 提示词；按消息生成的技能路由节从 systemPrompt 挪到每轮 instruction。回归钉：路由命中与不命中必须产出**逐字节相同**的 systemPrompt |

### 五道硬闸（缺任一条即不可发车）

1. **擦除覆盖**：`commitAll` 是裸 `git add -A`（`workspace.ts:116` → `git.ts:199`，无 pathspec）。**污染是延迟发生的**——本步失败跳过本步提交，文件留在 worktree，而下一次复用同一 worktree 的步（典型是合并轮，走 continue、**不触发** 返工回退）会把它一起提交并推送。三条具体漏点：`openSession` 抛错、事件流抛错、stopped-without-discard；SIGKILL 进程内不可覆盖，靠 B6 的对账 + `new`-action 的回退兜。
2. **落点判定**：pi 同目录 first-wins，写错文件 = 简报**完全不被读**（全搬之后没有回退通道 = 静默零指令步），或**遮蔽用户自己的 CLAUDE.md**。写失败即 `failStep`，绝不降级成「无简报运行」。
3. **缓存前缀**：见 B7。
4. **agent 中途动承载文件**：标记完好 → 正常 splice（块外编辑逐字节保留）；**标记被破坏 → 不重写文件**，改为排除该文件提交 + `git checkout` 回 HEAD + transcript 点名被牺牲的编辑。步照落，损失有界可见（备选是整步失败，但那会让文档类任务经常性翻车）。
5. **通道漂移**：简报改骑原生发现通道后，**任何触碰原生发现的选项都成了简报的存活依赖**——claude-code 的 `settingSources` 若被设成 `[]` 或不含 `'project'`、pi 若被加 `noContextFiles` / `agentsFilesOverride`，简报**零报错地消失**。故 #917 的口径 3（显式声明 `settingSources`）是本改动的**前置**而非可选项。

### 写入与擦除的时序

写入落在 `runner.ts` 的返工回退**之后**、heartbeat 之前，且提到 compat 回落的 pass 循环**之外**（第二轮看同一份盘上文件）。擦除在主出口（定时器已清、终态错误已归并）**之后**、`stopped` 分支与两处 rewind **之前**、`commitAll` 之前——与 Multica 的 LIFO「cleanup 先于 Finalize 的 add -A」同构。

## 对 Multica 的取舍清单

**采：**

| 机制 | Multica 证据 | 为何采 |
|---|---|---|
| 标记块三态写入 | `runtime_config.go:247-275` | 保留用户既有内容 + 幂等替换 + 给擦除留精确切除点。它的前身（无条件 `os.WriteFile`）**截断过用户的 CLAUDE.md**（MUL-2753），三态是那次事故的产物 |
| 擦除先于提交，擦除失败即中止提交 | `daemon.go:8321-8361` | 「擦不干净就别提交」比「提交了带污染的树」可回滚 |
| per-run 值不进简报文件 | `runtime_config_sections.go:1059-1063`（MUL-5377） | 简报文件的全部价值在「逐字节稳定的缓存前缀」；掺一个随消息变的值就把这个价值清零 |
| 落点按 provider 分表 | `runtime_config.go:197-223` | 采其**形**（按引擎给不同文件名），不采其**量**（25 个 provider 的枚举表——pacman 只有两个后端，且都在 `@pacman/shared` 的候选表里） |

**不采：**

| 机制 | 为何不采 |
|---|---|
| 用 `.git/info/exclude` 隐身 | Multica 自己写的是 per-worktree gitdir，而 **git 根本不读那个文件**（linked worktree 解析到 common dir）——`repocache/cache.go:2183` 那份是死代码，其回归测试只断言文件内容、从没断言 git 认它。pacman 侧即便写到自己的 common dir 也不该采：**按文件名**排除会把 agent 合法产出的 `CLAUDE.md` 从 `git add -A` 里静默吞掉（隐形丢活），且挡不住「追加进用户已跟踪 CLAUDE.md」那种跟踪态修改。见 B5 的按内容替代 |
| `providerNeedsInlineSystemPrompt` 那类清单 | 它列的是「CLI 不读上下文文件」的四个 runtime（openclaw/kimi/traecli/qwenpaw）。pacman 两个后端都原生读，清单为空——留能力位 `brief?` 作逃生口即可，不预先枚举 |
| 云端 scratch workdir 免擦除那条分支 | pacman 的 worktree 就是交接物本身（分支被推、被合），没有「GC 整目录」的等价物 |

## 已知残差（如实登记，不假装覆盖）

- **agent 在 bash 里自己 `git add -A && git commit`** 把标记块写进历史：**预防做不到**——标记在 daemon 任何闸生效之前就已进提交，B5 的提交闸只管得住 daemon 自己那一次。检测已接线：推送后对 conv 分支 `git grep` 五个候选名找标记，命中落 `[step]` 日志 + transcript system 行点名文件与分支（**是检测不是阻断**，支路失败不打断收尾）。真正进了分支历史的标记**只能靠人合并前处置**，这一层只保证它可见。
- **journal 恢复的步**用**陈旧的 claim 快照**重写简报（`machine-loop.ts:277-283`）：可接受，但恢复轮的简报内容不等于当前团队状态。
- **catalog 扫描从「每 pass 一次」变成「每步一次」**：compat 回落的第二轮不再重扫（`pi.ts` 的"每次会话创建扫描一次"语义变了）。
- **简报文件在步运行期间对 `git status` 可见**（未跟踪、未 ignore）：这是选「擦除」而非「exclude」的必然代价，Multica 同样如此。
- **pi 自身就会注入一份 `<available_skills>` 段**（resource loader 的 skills 配置面），与 pacman 那份并存。本册**不消除**它——那是 #917 的收口范围，属重复清单 + 授权面只挡得住一份的老问题。

## 与 #917 的关系

#917（技能可见面收归 pacman）四条口径里，**两条是本改动的落地前提**：口径 3（显式声明 `settingSources: ['user','project','local']`——`'project'` 是简报的承重档）与口径 4（白名单从提示级改硬挡）。另两条被本册**作废**：口径 1（pacman 目录注入成唯一来源）与口径 2（关掉 Claude Code 原生 Skill 面）——本改动恰恰要依赖原生上下文文件通道。