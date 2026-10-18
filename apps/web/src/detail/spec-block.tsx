// 任务详情描述区（#310, r9 §3.1）：用户新建任务时填写的 spec 文本 + 附
// 件 token 渲染。新建任务对话框把 spec textarea 内容（含附件 token）随
// POST /api/projects/{id}/todos 入 todo.spec，本组件据此渲染。
//
// #612 起本组件是「用户原话」的唯一展示面（daemon 把 title+spec 合成 prompt
// 记进会话，此前同一份文本又以首条用户气泡二次呈现——套娃；mapper 现按
// shared records/prompts 词表过滤该行）。渲染 = ChatMarkdown 单源（agent
// 回复、用户气泡、任务简报同一套块级语法：标题/列表/围栏/附件 token 行），
// 此前这里只有 \n\n 切段 + inline code chip，`#`/`-`/围栏全按字面裸排。
//
// dirty 钩：本票范围内 spec 详情面只读渲染（无编辑 UI）——#310 AC 只要求
// 「详情页可见」,编辑 + dirty 闸归 #318 后续编辑器票,届时复用本组件的受控
// spec 接口即可。
//
// #945（detail.css 清零）：简报卡皮肤迁 token utilities——配方 = composer
// 卡同族（1px --border-default 缝线 + --surface-secondary 底，线程列里用户
// 说话的两个面读作同一材质）；text-card-title/1.6 阅读档 + 68ch cap = #470 线程正文
// 纪律。fresh 态（任务简报独占中心列）经 `fresh` 入参并入 720px 居中轴
// （老 `.detail-fresh .spec-block` 上下文覆写规则的组件侧等价形）。

import { cn } from 'cn';
import { ChatMarkdown } from './chat-markdown.js';

interface SpecBlockProps {
  /** todo.spec 原文（含 `![name](attachment:key)` token 行）。 */
  spec: string;
  /** fresh 相位（详情中心列独占态）：720px 居中轴 + auto 侧 margin。 */
  fresh?: boolean;
}

export function SpecBlock({ spec, fresh = false }: SpecBlockProps) {
  return (
    <section
      className={cn(
        // #1054 清点：带框内容盒接 registry 圆角词汇 rounded-lg（#1072 同域
        // 先例：review-dialog notice box / BranchBox / READONLY_BOX 同档）。
        'spec-block mt-4 mx-4 rounded-lg border border-(--border) bg-(--secondary) px-4 py-3 text-card-title leading-[1.6] break-words text-(--foreground) [&>*]:max-w-[68ch]',
        fresh && 'mx-auto max-w-180',
      )}
    >
      <ChatMarkdown text={spec} />
    </section>
  );
}
