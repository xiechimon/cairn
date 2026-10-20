# 附件(composer + 新建任务,#310/#331)

用户在 composer 或新建任务对话框附加文件:点工具条「添加附件」钮(`button[aria-label="添加附件"]`,原生文件多选触发器)→ 选文件 → 上传 → 附件 token 注入文本(`![名](attachment:attachments/{teamId}/{id}.{ext})`)随消息/任务 spec 提交;执行面 agent 可读取附件内容。规格源:r9 §3.1/§4(todos.dev 实测 wire 三步)。

## Sub-features

- `attachment-button` composer / 新建任务工具条「添加附件」钮(`button[aria-label="添加附件"]` + Paperclip 图标)= 原生 `<input type=file multiple>` 触发器。
- `attachment-upload-wire` 选文件 → 三步上传(r9 §4):`POST /api/uploads/grant`(拿上传凭证)→ 独立 upload host(FormData PUT)→ 返回 attachment id。
- `attachment-token-inject` 上传成功后 token `![名](attachment:attachments/{teamId}/{id}.{ext})` 注入 composer draft / 新建任务 spec(受控 state,父组件 setDraft/setSpec)。
- `attachment-submit` token 随消息/任务 spec 提交,落 conversation message content / todo.spec。
- `attachment-executable` 执行面 agent 可读取附件(daemon 侧 attachment 工具进 worker 词表,remoteTools)。
- `attachment-dirty-gate` 附件 token 注入 spec 后由 spec 非空承载未保存闸 dirty 位(#318 闸,#310 接线)。

## Drive (vp.mjs)

- `vp.mjs drive attachments clipboard-paste`
- `vp.mjs drive attachments new-task-and-composer-upload`

前置（stack / daemon / stub-llm …）、状态与脚本参数：`vp.mjs list attachments`。`vp.mjs` = `node .claude/skills/verify-pacman/scripts/vp.mjs`。

## How to get to it (user POV)

- 详情页 composer 工具条「添加附件」钮(运行/确认面)。
- 新建任务对话框工具条「添加附件」钮(落 spec textarea)。

## Driving it with verify-pacman

Preconditions:

1. `launch.mjs` 起隔离栈,`doctor.mjs` 全 PASS。
2. 附件上传需 server 的 upload host 可达(grant → upload → token);live 面。
3. 执行面读取需 daemon + worker 步(attachment 工具在 remoteTools 词表)。

- **跑法。** `node <skill>/scripts/drive-attachments.mjs` 只跑新建任务对话框路径(自足,无需 daemon/seed);`node <skill>/scripts/drive-attachments.mjs <todoId>` 追加 composer 路径(todo 需处于 composer 可编辑相位,seed 走 `setup-review-seed.mjs`)。样本文件写在证据目录里随归档进 PR,便于对照原始字节。
- **剪贴板粘贴路(#729)。** `node <skill>/scripts/drive-paste.mjs <todoId>`(todoId = `setup-review-seed.mjs` 产出的 confirm 相位任务):canvas 生成 24×24 真 PNG → 合成 ClipboardEvent 粘进 detail composer(caret 行中,断行插入 + caret 落块后行首)→ Enter = revision 发送 → transcript 缩略 chip 像素加载;再走新建任务对话框粘贴 → 保存 → spec 卡片 chip;末了真键盘探针(clipboard-write 权限 + ClipboardItem + Meta+V/Ctrl+V,verdict 记 result.json 不硬断言)。14 checks:wire 捕获(grant 200 / upload 201 / revision 202)+ SQLite 两行(message/spec 两 scope,status=ready)+ 磁盘字节 === 样本 + 读回一致。证据先例 `docs/verify/729/`。注意:粘贴合成名 `pasted-image-<n>` 每 draft 递增——探针的路径 B 必须先于真键盘路跑,否则 counter 被顶号(设计行为,非回归)。
- **上传路径。** composer/新建任务 → 点 `button[aria-label="添加附件"]` → 文件选择(playwright `setInputFiles`)→ 等上传 → draft/spec 出现 `![名](attachment:...)` token。
- **真值。** `POST /api/uploads/grant` 返回上传 URL;upload host PUT 200;提交后 message content / todo.spec 含 attachment token;SQLite attachment 表有行(#310 migration 0008);磁盘 `<attachmentsDir>/<storageKey>` 字节等于上传样本;`GET /api/attachments/:id` 读回一致。**未覆盖**:daemon 执行面读附件(worker 步 attachment 工具)——需真 daemon + worker 步,脚本不驱动这一面。

## Gotchas

- 附件钮是**原生文件触发器**(`input[type=file]`),playwright 用 `setInputFiles` 而非 click;选中后 onAttachment(files) 委托父组件做 grant+upload+token 注入。
- 上传是三步异步(grant → 独立 host PUT → token),不是一步 POST;drive 要等 token 落 draft 再断言。
- composer 附件需 live editable 面(受控 draft,父持 state);fixture 静态 div 无附件 wire。
- token 格式 `![名](attachment:attachments/{teamId}/{id}.{ext})` 是 markdown 图片语法变体——执行面/渲染面按 attachment: 协议解析,非真 URL。
- **验证状态(2026-09-28)**:本功能由 #331 lane 在 worktree 内验证(integration attachments.test.ts 588 行 + lane verify run),证据随 worktree 删除未留主仓;主仓 live re-probe 待补(需 upload host + daemon worker 步完整编排)。user path 从合并代码核实。
