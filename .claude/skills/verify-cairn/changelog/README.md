# changelog — 每票一文件

verify-pacman 的变更记录。原形态是 SKILL.md 与 features/README.md 顶部的「Last updated:」单行链:每条车道往链首塞一条记录,两条车道同挂必撞同一个 hunk(#1039 起退役)。现形态:

- **车道记新条目 = 新建一个文件**,文件名 `<YYYY-MM-DD>-<票号或短slug>.md`(如 `2026-10-08-1025.md`、`2026-09-29-spec12-batch.md`);不改 SKILL.md / features/README.md 的指针行,也不编辑别的条目文件——两条车道同时记录,git 不应看见同一个 hunk。
- 条目内容自由行文,说清:该票给 skill 加/改了什么(定制 probe、门控、纪律节)、feature map 面变化、实测坑、证据目录(`docs/verify/<票号>/`)。同一票补记 = 编辑自己的文件。
- 顺序与准确时间以 `git log --oneline -- .claude/skills/verify-pacman/` 为准;文件名日期是挂条目当天,仅作浏览排序。

## 迁移文件里的段落标记

2026-10-08 的存量文件是从两条旧链逐条搬来的:`## skill` 段 = 原 SKILL.md 链条目、`## feature map` 段 = 原 features/README.md 链条目,文字逐字保留(守恒校验:docs/verify/1039/)。新条目不需要这些段落标记,直接自由行文。

## 在飞分支的合流配方

本目录落地前切的分支,若还带着对旧单行链的 prepend 编辑:合并 main 后把你的条目文字搬进新文件 `changelog/<日期>-<票号>.md`,放弃对旧链行的编辑,再 commit——不要再往单行链上解冲突。

## 维护

map 与 skill 的整体维护轮走 `/maintain-verification-skill`。
