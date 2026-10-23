# 技能页(本地目录现扫面)

用户在 server 机器的技能目录(验证栈 = `<RUN_DIR>/home/skills`,launch 已按 `CAIRN_SKILLS_DIR` 隔离)里放一个含 `SKILL.md` 的子目录,刷新 cairn 技能页(`/app/resources/skills`)就能看到它——数据源仍是目录现扫,但新建/编辑已恢复界面入口(XMON-114,spec 13 回摆:topbar「新建」与空态主钮开 SkillDialog,行点击开编辑);导入路由仍不存在。技能行可授予 Agent(`agent.skills[]` 存 skill id);删目录即删技能,页面无删除面。规格源:spec 13 资源面本地化(#367)+ XMON-114 写面回摆。

## Sub-features

- `live-scan` 技能列表 = 每次 `GET /api/skills?teamId=` 现扫目录(无缓存不入库):放目录→刷新即现,删目录→刷新即消。
- `identity` 行身份 id = `SKILL.md` frontmatter `name`,无 frontmatter/无 name 回落目录名(2026-09-29 合同修订,对齐 spec 14);`name`/`description` 同取 frontmatter,缺省回落目录名/null。
- `write-entries` 新建入口在位(XMON-114 恢复,skills-page.spec.ts 钉计数 1):topbar「新建」= role=button 文案「新建」exact(CSS 载体 `[data-testid="resource-new"]`)、空态主钮「新建技能」开 SkillDialog;无导入路由(`/app/resources/skills/import` 重定向回 `/app`);空态文案指路技能目录(`~/.agents/skills` 缺省显示)+ 界面新建双入口。
- `agent-grant` Agent 行 `skills[]` 只认现扫已知 id:携带已删目录的旧 id 静默滤除,不报错。

## How to get to it (user POV)

- 侧栏「资源 → 技能」→ `/app/resources/skills`。
- 空态:scratch 技能目录为空时列表页即空态(文案含目录路径)。
- API 直证:`GET <api>/api/skills?teamId=<teamId>`。
- 驱动:注册表里没有本 feature 的 case,`vp.mjs list` 不列它;按下面的配方手工驱动。

## Driving it with playwright

Preconditions: `launch.mjs` 起栈(scratch 技能目录为空);从 `ports.json` 读 `skillsDir`/`serverPort`;teamId 经 `GET /api/teams` 取。

- 放一个技能目录 → 刷新技能页出现该行:
  `mkdir -p <skillsDir>/deploy && printf -- '---\nname: deployer\ndescription: 部署流程手册\n---\n# deploy\n' > <skillsDir>/deploy/SKILL.md`
  → 浏览器 reload `/app/resources/skills` → `[data-testid="resource-row"]` 计数 1,行文本含 `deployer`(frontmatter name 优先于目录名 deploy)与描述。
- API 真值第二只眼:
  `curl -s <api>/api/skills?teamId=<teamId>` → `[{id:"deployer",name:"deployer",description:"部署流程手册",teamId:<teamId>}]`。
- 删目录 → 刷新即消:
  `rm -rf <skillsDir>/deploy` → reload → `[data-testid="resource-row"]` 计数 0,空态 `[data-testid="resource-empty"]` 可见且文案含 `~/.agents/skills` 字样之外的**实际配置目录不显示**(空态 {dir} = 缺省常量显示位,见 Gotchas)。
- 写面/导入面钉扎:
  `/app/resources/skills` 上「新建」入口计数 1(role=button 文案「新建」exact / `[data-testid="resource-new"]`;XMON-114 恢复——旧「无新建钮,计数 0」口径作废);goto `/app/resources/skills/import` → URL 落 `/app`。
- 无 frontmatter 回落:
  `mkdir -p <skillsDir>/plain && echo '# plain' > <skillsDir>/plain/SKILL.md` → 行 id/name = `plain`,描述空。
- agent-grant 容忍(可选,API 面):
  `POST /api/teams/<teamId>/agents {displayName:"x",skills:["deployer","ghost"]}` → `GET agents/<id>` 的 `skills` = `["deployer"]`(ghost 静默滤除)。

## Gotchas

- **空态文案显示的是缺省路径常量 `~/.agents/skills`,不是 server 实际配置目录**——验证栈的 scratch 目录经 `CAIRN_SKILLS_DIR` 覆写,空态仍显示缺省值(web 侧 {dir} = shared SKILLS_DIR_DEFAULT 单源;env 覆写只在 server 生效)。别把这判成 bug,证据里注明即可。
- 大写敏感:`skill.md`(小写)不算技能(canon 名 `SKILL.md` 精确匹配,大小写不敏感文件系统上也强制精确)。
- 只扫一级子目录:`<skillsDir>/a/b/SKILL.md` 的 b 不会被发现;a 自带 SKILL.md 才收录 a。
- 符号链接目录收录且 realpath 去重(同一真实目录两个入口只出一条);双目录 frontmatter 声明同 name = 目录名字典序先者胜。
- 技能页排序钮/搜索行是纯前端面(fixture 与 live 同构),与数据源无关。
- 验证完把 scratch 技能目录清回空集再验空态(目录残留 = 空态永不出)。
- **#944 载体迁移**:类名钩 → 语义/data-* 载体(`.res-rowcard` → `[data-testid="resource-row"]`、`.res-empty` → `[data-testid="resource-empty"]`、`.res-new` → role=button「新建」/ `[data-testid="resource-new"]`;断言语义不变)。同票修正已知漂移:本页旧口径「无新建钮(计数 0)」自 XMON-114 恢复新建入口起作废,现钉计数 1(skills-page.spec.ts 同钉)。
