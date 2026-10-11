# skills 执行面注入(daemon)+ 路由可见面(web,#919)

daemon 每次创建 agent 会话前扫描 `PACMAN_SKILLS_DIR`(缺省 `~/.agents/skills`),把 `<available_skills>` catalog(name + description + location XML)经简报文件通道投递(#958 起不再进 systemPrompt);agent 按 description 匹配时用内建 `read` 工具经 location 绝对路径按需读 SKILL.md 全文。catalog 是索引不全文——token 预算与 skills 数量线性,与 skills 总长度无关(#371,spec 14)。团队库经 server 清单 + 按需拉分发(#920),白名单外技能两后端硬挡(#917)。

**web UI 面自 #918 起存在**(并行票先合,#919 的 seam 4 验收对象即它):活行披露面 `▶/✕ skill: <名>` 行(`data-testid="skill-line"`,仅 live 态——#873 披露面板 liveStep 在位才挂)+ 详情页持久汇总行(`data-testid="skills-summary"`,读/挡两列,从落库 toolcall 行派生)。分类单源 = shared/skill-facts(与 daemon 活行判定同函数)。验证 = integration 真栈(server + 真 daemon + stub LLM 捕获)+ `drive-919-skills-routing.mjs` live 探针(真模型行为腿 + stub deny 腿)+ fixture e2e `skills-routing.spec.ts`(持久面;活面归 #918 的 unit/live 探针)。

## Sub-features

- `skills-catalog-inject` catalog XML 经简报通道进 LLM 输入面;既有段(agent 职责/记忆)保留——追加非覆盖。
- `skills-read-through` catalog location = SKILL.md 绝对路径;agent `read` 该路径不被拒(连通性硬验收——catalog 不能是装饰品)。
- `skills-dir-env` `PACMAN_SKILLS_DIR` 覆写扫描根;缺省 `~/.agents/skills`;目录缺失/为空 = 空 catalog,非致命。
- `skills-cap` catalog 总数 > 50 截顶;单 description > 200 字符截断 + `…`;两者各落 cap 日志。
- `skills-log` `[skills] <type>: <msg>` 行族落 daemon.log(type ∈ loaded / collision / invalid-frontmatter / missing-skill-md / cap / invalid / catalog / deny / denied-read / team / team-manifest-empty / team-skills-failed / filtered)。
- `skills-facts-faces`(#918 落地,#919 seam 4 验收) 活行披露行(live 态)+ 持久汇总行(读/挡两列);fixture e2e 钉持久面与零事件对照。
- `skills-routing-behavior`(#919 主判据) 票面零技能词的真派发,lane 自己命中技能——产物 marker + transcript 读取行 + daemon.log 目录行 + 详情页汇总行截图四面取证。
- `skills-allowlist-split`(#1169) agent 技能两字段分家——`defaultSkill`(携带,单值,详情页概览 Select)+ `skillsAllowlist`(授权,null=不限制、[]=显式全拒,详情页权限 tab 勾选清单+两态互转开关);存量 `[]` 行迁移为 null(解除「新建 agent 出生即全拒」);deny 机制(#917)原样。验证 = `drive-1169-skills-split.mjs` live 探针(api 相位零 daemon 钉 REST 读写面/claim 载荷/清单 selection 三面 + behavior 相位真模型腿钉不限制 agent 读 SKILL.md 零 deny)+ 迁移回填 unit(agent-skills-split-backfill.test.ts)+ 详情页 e2e(agent-detail.spec.ts 两控件互不影响)。
- `skills-native-plugin`(#1171) claude 后端团队技能经 SDK `plugins` 选项(→ `--plugin-dir`)进 CLI 原生 Skill 发现面:落点 = daemon 缓存第三分区 `<teamSkillsCacheDir>/plugins/<key>/`(`.claude-plugin/plugin.json` name=`pacman-team-skills` + `skills/<dirName>` hardlink 装配,key = sha256(view digest + 排序 allowed dirNames));**任务 worktree 零写入**;allowed 集 = `collectTeamSkillEntries`(与 catalog/deny 同扫描源,只滤 `skillsAllowlist`,**不受 `injectedSkills` 收窄**——选择不越授权,#917 同律);版本闸 `MIN_CLAUDE_PLUGIN_VERSION=2.1.74`(#1050 探测单源,低于闸 = skipped 行 + catalog 兜底);deny 三条规则形不改(`Skill(name)` 经 alias 命中插件限定名);catalog XML 通道照常并存。技能名 = `pacman-team-skills:<name>` 限定形 + 非限定 alias;与 project/user 技能撞名 = 共存,非限定名归既有侧。验证 = `drive-1171-native-plugin.mjs`(wire 相位假 CLI 捕获 argv 零 LLM 32 checks + behavior 相位真模型腿 10 checks:transcript `Skill` 工具调用段行点名插件限定名)+ unit `skills-native-plugin.test.ts`(34 checks,失败方式 P1-P15)。

## How to get to it (user POV)

- 用户把 skills 放 `~/.agents/skills/<name>/SKILL.md`(frontmatter `name` + `description`;缺 name 回落目录名)→ daemon 起来后派任何任务 → agent 会话自动带 catalog,按需 read。
- 自托管:`PACMAN_SKILLS_DIR=/path/to/other` 启动 daemon,从那处加载。
- UI 可配性(account 页输入框)= 后票,当前无入口。

## Driving it with integration harness

Preconditions:

- worktree 已 `pnpm install`;integration 面无固定端口(全 ephemeral),与其它车道无端口冲突。

- **canonical 探针(真 daemon + 真 pi 会话 + stub LLM 捕获)。** Run `cd integration && pnpm exec vitest run test/skills-inject-e2e.test.ts`。链路:fixture skills 目录(单 skill 带正文 marker)→ `loadDaemonConfig({skillsDir})` → `runMachine` 真 daemon → seed 任务派工 → 断言三件套:① stub 捕获的 LLM 请求 messages 含 `<available_skills>` + `<name>demo-skill</name>` + location 绝对路径 + 既有职责文本(追加不覆盖);② stub 第一轮发 `read` toolCall 指向 SKILL.md → 工具结果(正文 marker)经 relay 落库 message 表(连通性实证);③ daemon.log 落 `[skills] loaded: 1 skills from` 行。
- **行为验收探针(#919:全库目录/远端分发/硬挡双向/空清单/原生面关断 before-after)。** Run `cd integration && pnpm exec vitest run test/skills-routing-e2e.test.ts`。拓扑:server skillsDir 种团队库 3 技能(alpha 带引用文件)+ daemon 本机库 2 技能(1 授权 1 白名单外)+ pi agentDir 种原生技能;两个 build——白名单全量跑(目录 entries=4、团队 marker 落库、denied-read 行、before 腿 `discoverNativeSkills` 探针对照)与空白名单跑(`team-manifest-empty` 显式行 + 会话照常)。
- **live 真模型行为腿(#919 主判据)。** `node .../scripts/drive-919-skills-routing.mjs --phase=behavior`(前置:launch.mjs 起栈 + 真 daemon 外部起,配方 = docs/verify/919/README.md)。票面零技能词 → claude-code runtime + glm-5.3(本机 claude 登录态)→ 产物 haiku.txt 带技能正文 marker + transcript Read 命中 + 详情页持久汇总行截图(#918 面)。`--phase=deny-ui` = 内嵌脚本 stub 腿:被拒 read 落汇总行挡下列 + LLM 输入面目录断言。
- **原生插件通道(#1171)。** `node .../scripts/drive-1171-native-plugin.mjs --phase=wire|behavior`(daemon 自 spawn 自回收,不需外部 daemon;wire 相位 `PACMAN_CLAUDE_BIN` 注入假 CLI 捕获 argv 零 LLM——四腿:交付面/版本闸/[] 空清单/null 全量;behavior 相位真模型腿:任务文本不点名技能 → transcript `Skill` 工具调用段行(`kind:'toolcall'`,ADR 0011 第五形,**不是**内容块 tool_use)点名 `pacman-team-skills:<name>` + marker 复述 + 预植仓技能逐字节保留)。配方与判读 = docs/verify/1171/README.md。
- **版本歪斜钉扎(#919 seam 6)。** Run `cd apps/daemon && pnpm exec vitest run test/skills-version-skew.test.ts`。冻结旧 schema(拷贝自 `b3072007^`)× 实机金样(docs/verify/920/wire-new/)双向拒绝 + 现行 schema 收金样;期望值全部独立来源。
- **单元面(五输入态 + cap 双闸 + 日志行族)。** Run `cd apps/daemon && pnpm exec vitest run test/skills-catalog.test.ts test/config-state.test.ts`。覆盖:目录不存在 / 空目录 / 无 SKILL.md / 正常 skill / frontmatter 缺 name 回落 / name 碰撞 winner 裁决 / 51 skills 截顶 / 250 字符 description 截断 / `PACMAN_SKILLS_DIR` 优先级(显式 > env > 默认)。

## Gotchas

- **read 工具无沙箱是 pi 事实**:pi 0.86 的 `read` 工具解析任意绝对路径(`resolveReadPathAsync`),daemon 侧不存在路径白名单——「白名单扩 skillsDir」不需要改码,连通性由 ② 的落库断言实证。别去找不存在的 allowlist 缝。
- **每次会话创建重扫**:catalog 无缓存无 watcher,daemon 不重启也会话会话之间生效;改 SKILL.md 后派新任务即可见。
- **开发机默认目录是真数据**:缺省 `~/.agents/skills` 在本机存在且 >50 skills——integration 其它用例(m3a/m4b)跑在默认 skillsDir 上会真注入 catalog(cap 截顶),containment 断言不受影响,但 daemon.log 会出现 `[skills] cap:` 行,不是 bug。
- **`disable-model-invocation: true` 的 skill 不入 catalog**(pi `formatSkillsForPrompt` 过滤)——只能 `/skill:` 明面触发,按需读通路对它不适用。
- machine-loop 测试注入 `opts.backend` 时不走 PiBackend → 无 skills 注入;要验注入必须走 `createPiBackend` 真路径(integration harness 即此形态)。
- **enroll 缺省 `enabledRuntimes:['pi']`,#682 起是 claim 真闸**(`dispatch-eligibility.ts` runtimeGatePasses):claude-code runtime agent 的步在只开 pi 的机器上**永远 pending 且 daemon 零日志**(2026-10-07 #919 行为腿实撞,三轮 600s 空等)。派 claude-code 活前先 `PATCH /api/machines/:id {"enabledRuntimes":["pi","claude-code"]}`(= machines 页 runtime 开关的 REST 面;drive-919 探针已内置)。
- **step 终态词表 = `done`/`failed`/`stopped`**(shared stepStatusSchema)——`success` 不在词表里;探针等终态别抄错(drive-919 首版抄了不存在的 'success' 空等 600s)。build 表没有 status 列,失败根因在 `build.errorMessage`。
