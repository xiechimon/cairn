// Block-markdown renderer for chat text (issue #469; #612 起同时服务用户
// 话语与任务简报——描述区 SpecBlock 与用户气泡的 markdown 槽都渲染到这里，
// 全站「用户/agent 的块级文本」一套解析器，不再各写一套).
//
// Why a web-side lite parser instead of reusing the doc pane's DocBlock
// pipeline (`mapPlanDoc`): DocBlock is the plan.md display contract, frozen
// off the r3 §3.3 "四段卡软结构" captures — it only models head/bullet/para
// and deliberately does not force structure. Chat replies need a richer
// block grammar (ordered lists, nesting, fenced code) that DocBlock has no
// slots for; widening that shared type would force the pixel-frozen doc pane
// renderer to carry kinds plan.md never produces. So chat gets its own
// line-based parser here, reusing `inlineSegments` for the inline layer —
// the `.chat-code` chip and mention accent stay byte-identical to the rest
// of the transcript. Parsing runs at render time off the raw `markdown`
// string (the spec-block.tsx precedent), so the fixture surface exercises
// the same parse+render path as the live mapper.
//
// 附件 token（#310/#612）：![name](attachment:key) 独占一行 = attachment
// 块（两个写入端——详情页 composer 与新建任务对话框——都按「每个 token 占
// 独立行」拼接，web api/attachments.ts 契约）。行中内联的 token 不在块语法
// 内（保持字面文本，与 agent 回复同律）。

import { AGENT_TODO_LINE_RE, AGENT_TODO_MARKER_STATES, type AgentTodoState } from '@pacman/shared';
import { useMemo } from 'react';
import { inlineSegments } from '../api/mappers.js';
import { Button } from '../components/ui/button.js';
import type { DocSegment } from '../fixtures/records.js';
import { Check } from '../icons/index.js';
import { ATTACHMENT_LINE } from '../overlay/attachment-paste.js';
import { Segments } from './segments.js';

/** One block of a parsed chat reply. Inline content rides `segments`
 *  (shared with the doc pane / spec block); fenced code keeps its raw text
 *  (no inline parsing inside a code block); attachment blocks keep the
 *  token's name + storage key (#612). */
export type ChatBlock =
  | { kind: 'para'; segments: DocSegment[] }
  | { kind: 'head'; level: number; segments: DocSegment[] }
  | { kind: 'ordered'; depth: number; ordinal: number; segments: DocSegment[] }
  | { kind: 'bullet'; depth: number; segments: DocSegment[] }
  | { kind: 'tasks'; items: TaskItem[] }
  | { kind: 'code'; lang?: string; text: string }
  | { kind: 'attachment'; name: string; key: string };

export type TaskState = AgentTodoState;
export type TaskItem = { state: TaskState; segments: DocSegment[] };

/** Indent width per nesting level (px). Two source spaces = one level. */
const DEPTH_PX = 18;

function depthOf(indent: string): number {
  return Math.floor(indent.replace(/\t/g, '  ').length / 2);
}

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*(\S*)\s*$/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*)$/;
const ORDERED = /^(\s*)(\d+)[.)]\s+(.*)$/;
const BULLET = /^(\s*)[-*•]\s+(.*)$/;
/** Whole-line attachment token: single-sourced in overlay/attachment-paste.ts
 *  since #757 (composer strip parses the same shape the renderer chips). */

/** Line-based block parser: headings, ordered/unordered lists (nesting by
 *  leading indent), fenced code, and soft-wrapped paragraphs. Inline code /
 *  mentions inside non-code blocks go through `inlineSegments`. */
export function parseChatMarkdown(text: string): ChatBlock[] {
  const lines = text.split('\n');
  const blocks: ChatBlock[] = [];
  let para: string[] = [];
  const flushPara = () => {
    if (para.length > 0) {
      blocks.push({ kind: 'para', segments: inlineSegments(para.join(' ')) });
      para = [];
    }
  };

  let i = 0;
  while (i < lines.length) {
    const raw = lines[i] ?? '';
    const trimmed = raw.trim();

    // fenced code — collect verbatim until the matching close fence
    const fence = FENCE.exec(raw);
    if (fence !== null) {
      flushPara();
      const marker = fence[1] ?? '```';
      const lang = fence[2] !== undefined && fence[2] !== '' ? fence[2] : undefined;
      const buf: string[] = [];
      i += 1;
      const close = new RegExp(`^ {0,3}${marker[0] === '`' ? '`{3,}' : '~{3,}'}\\s*$`);
      while (i < lines.length && !close.test(lines[i] ?? '')) {
        buf.push(lines[i] ?? '');
        i += 1;
      }
      i += 1; // step over the closing fence (or past EOF)
      blocks.push({ kind: 'code', ...(lang !== undefined ? { lang } : {}), text: buf.join('\n') });
      continue;
    }

    if (trimmed === '') {
      flushPara();
      i += 1;
      continue;
    }

    const attachment = ATTACHMENT_LINE.exec(raw);
    if (attachment !== null) {
      flushPara();
      blocks.push({
        kind: 'attachment',
        name: attachment[1] ?? '',
        key: attachment[2] ?? '',
      });
      i += 1;
      continue;
    }

    const head = HEADING.exec(raw);
    if (head !== null) {
      flushPara();
      blocks.push({
        kind: 'head',
        level: (head[1] ?? '#').length,
        segments: inlineSegments((head[2] ?? '').trim()),
      });
      i += 1;
      continue;
    }

    const ordered = ORDERED.exec(raw);
    if (ordered !== null) {
      flushPara();
      blocks.push({
        kind: 'ordered',
        depth: depthOf(ordered[1] ?? ''),
        ordinal: Number(ordered[2]),
        segments: inlineSegments((ordered[3] ?? '').trim()),
      });
      i += 1;
      continue;
    }

    const task = AGENT_TODO_LINE_RE.exec(raw);
    if (task !== null) {
      flushPara();
      const item: TaskItem = {
        state: AGENT_TODO_MARKER_STATES[task[1] ?? ' '] ?? 'todo',
        segments: inlineSegments((task[2] ?? '').trim()),
      };
      const last = blocks[blocks.length - 1];
      if (last?.kind === 'tasks') last.items.push(item);
      else blocks.push({ kind: 'tasks', items: [item] });
      i += 1;
      continue;
    }

    const bullet = BULLET.exec(raw);
    if (bullet !== null) {
      flushPara();
      blocks.push({
        kind: 'bullet',
        depth: depthOf(bullet[1] ?? ''),
        segments: inlineSegments((bullet[2] ?? '').trim()),
      });
      i += 1;
      continue;
    }

    para.push(trimmed);
    i += 1;
  }
  flushPara();
  return blocks;
}

// ATX headings are real <h1>…<h6> elements on the six type keys
// (DESIGN.md 六档字号): 18 / 16 / 14, then 13.5 for 4–6. Each key carries its
// own line height.
const HEAD_SIZE: Record<number, string> = {
  1: 'text-page',
  2: 'text-heading',
  3: 'text-card-title',
  4: 'text-ui',
  5: 'text-ui',
  6: 'text-ui',
};

function HeadingTag({ level, segments }: { level: number; segments: DocSegment[] }) {
  const clamped = Math.min(6, Math.max(1, level));
  const Tag = `h${clamped}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
  return (
    <Tag
      className={`chat-md-head chat-md-head--${clamped} mt-3 mb-1 font-semibold text-(--foreground) first:mt-0 ${HEAD_SIZE[clamped] ?? 'text-ui'}`}
    >
      <Segments segments={segments} codeClassName="chat-code" />
    </Tag>
  );
}

/** key teamId/id.ext → id：取末段去扩展名，兼容无扩展名情形
 *  （spec-block.tsx #310 原 helper，随附件块迁到渲染单源，#612）。
 *  #1009 B 起导出：composer strip（overlay/attachment-strip）自算服务端 URL，
 *  key→id 映射单源在此，禁止第二份实现。 */
export function attachmentIdFromKey(key: string): string {
  const lastSlash = key.lastIndexOf('/');
  const tail = lastSlash >= 0 ? key.slice(lastSlash + 1) : key;
  const dot = tail.lastIndexOf('.');
  return dot > 0 ? tail.slice(0, dot) : tail;
}

/** 扩展名白名单判图片（#310 契约：缩略/预览形 vs 文件名链接形的分界）。
 *  单源在此，transcript chip 与 composer strip 共用。 */
export function isImageAttachmentKey(key: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(key);
}

// #945（detail.css 清零）：附件 chip 皮肤迁 utilities。形 = taskline 序号
// chip 同族（code-bg 底 + --border-default 缝线 + 次级字色；原 chat-taskline-seq
// 别名零引用，已随 #1036 终摘），文件名是阅读// 文本给 12px 一档；图片 chip 2px 内衬 + 4px 内圆角（同心圆角：外 6 = 内 4
// + 内衬 2），缩略高度 cap 160px ≈ 6 行正文。hover 只动 color/border-color
// 两属性、150ms 标准档（motion registry #73）。spec-chip 皮肤正本 = 本文件
// SPEC_CHIP utility 常量（attachment-strip.css 已随 #948 退役；
// spec-chip--preview 别名零引用，同批终摘）。
export const SPEC_CHIP =
  'inline-flex max-w-full items-center rounded-[6px] border border-(--border) bg-(--muted) px-2 py-1 text-meta text-(--text-secondary) no-underline transition-[color,border-color] duration-(--dur-fast) ease-(--ease-standard) hover:border-(--input) hover:text-(--foreground)';
export const SPEC_CHIP_IMAGE = 'border-none bg-transparent p-0.5 hover:bg-transparent';
export const SPEC_CHIP_IMG = 'block max-h-40 max-w-full rounded-[4px]';

/** 附件 chip（#310 契约 / #612 起有样式）：image/* → 内联缩略 <img>（src 直
 *  指 GET /api/attachments/{id}），其它类型 → 文件名链接新标签打开
 *  （content-type 由浏览器原生处理）。
 *  #757 onPreview：composer strip 面传入后 image chip 改走 Button 件（同类名，
 *  点开预览浮层而非新标签；#945 裸钮收编——ghost 底座 + 七通道中和钉回
 *  老 chip 形）；不传 = transcript 旧链形，字节不变。 */
/** 长路径截断（composer/附件两 strip 共用）：label 收进内 span，省略号不断 chip 框。 */
export const COMPOSER_CHIP_LABEL = 'block min-w-0 max-w-65 truncate';

export function AttachmentChip({
  name,
  attachmentKey,
  onPreview,
}: {
  name: string;
  attachmentKey: string;
  onPreview?: (name: string, src: string) => void;
}) {
  const href = `/api/attachments/${encodeURIComponent(attachmentIdFromKey(attachmentKey))}`;
  const isImage = isImageAttachmentKey(attachmentKey);
  if (isImage && onPreview !== undefined) {
    return (
      // #945×#948 汇流：preview 卡收编 Button 件（#851 裸控件账，本票），
      // 皮肤 = SPEC_CHIP utilities（detail.css 退役）；#948 的 appearance
      // 归零由 TW preflight 对 button 元素的复位承接，无需显式 utility。
      <Button
        variant="ghost"
        className={`spec-chip spec-chip--image ${SPEC_CHIP} ${SPEC_CHIP_IMAGE} h-auto cursor-pointer rounded-[6px] whitespace-normal font-normal active:not-aria-[haspopup]:translate-y-0 [&_svg:not([class*='size-'])]:size-auto`}
        title={name}
        onClick={() => onPreview(name, href)}
      >
        <img src={href} alt={name} className={`spec-chip-img ${SPEC_CHIP_IMG}`} />
      </Button>
    );
  }
  if (isImage) {
    return (
      <a
        className={`spec-chip spec-chip--image ${SPEC_CHIP} ${SPEC_CHIP_IMAGE}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        title={name}
      >
        <img src={href} alt={name} className={`spec-chip-img ${SPEC_CHIP_IMG}`} />
      </a>
    );
  }
  return (
    <a
      className={`spec-chip ${SPEC_CHIP}`}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={name}
    >
      {name}
    </a>
  );
}

const TASK_ICON_BOX = 'mt-0.5 flex size-4 flex-none items-center justify-center rounded-full';

function TaskIcon({ state }: { state: TaskState }) {
  if (state === 'done') {
    return (
      <span className={`${TASK_ICON_BOX} bg-(--text-tertiary) text-(--card)`}>
        <Check width={10} height={10} />
      </span>
    );
  }
  if (state === 'doing') {
    return (
      <span
        className={`${TASK_ICON_BOX} animate-spin border-[1.5px] border-(--border) border-t-(--text-secondary) motion-reduce:animate-none`}
      />
    );
  }
  return (
    <span className={`${TASK_ICON_BOX} border-[1.5px] border-dashed border-(--text-tertiary)`} />
  );
}

/** 待办卡（借鉴 Claude Desktop 的 To Do）：`- [ ]` 待做 = 虚线圈，`- [~]` 进行中 =
 *  转圈，`- [x]` 完成 = 勾 + 划线淡化；连续任务行合成一张圆角卡。 */
export function TaskCard({ items }: { items: TaskItem[] }) {
  return (
    <ul
      className="my-2 flex list-none flex-col gap-2 rounded-2xl border border-(--border) bg-(--card) px-4 py-3.5 shadow-sm"
      data-testid="md-tasks"
    >
      {items.map((item, i) => (
        <li
          // task order is stable; items carry no ids
          key={i}
          className="flex items-start gap-3 text-ui"
          data-testid="md-task"
          data-state={item.state}
        >
          <TaskIcon state={item.state} />
          <span
            className={`min-w-0 ${
              item.state === 'done' ? 'text-(--text-tertiary) line-through' : 'text-(--foreground)'
            }`}
          >
            <Segments segments={item.segments} codeClassName="chat-code" />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Renders an agent reply's block markdown. Inline code chips reuse the
 *  transcript's `.chat-code` class so the chip family stays consistent. */
export function ChatMarkdown({ text }: { text: string }) {
  const blocks = useMemo(() => parseChatMarkdown(text), [text]);
  return (
    <>
      {blocks.map((block, i) => {
        switch (block.kind) {
          case 'head':
            return (
              // block order is stable; blocks carry no ids
              <HeadingTag key={i} level={block.level} segments={block.segments} />
            );
          case 'ordered':
            return (
              // 列表行 = 悬挂 marker 列 + 内容；嵌套缩进走 inline
              // margin-left（DEPTH_PX）。baseline 对齐（#814 返工）：序号跟
              // 内容首行走，即使那行带更高的 inline 盒（code chip）。行距
              // 2px、首块归零（老 :first-child 规则的渲染序等价形）。
              <div
                key={i}
                className={`chat-md-item chat-md-item--ordered flex items-baseline gap-2 ${
                  i === 0 ? 'mt-0' : 'mt-0.5'
                }`}
                data-testid="md-item-ordered"
                data-depth={block.depth}
                style={{ marginLeft: block.depth * DEPTH_PX }}
              >
                <span
                  className="chat-md-ordinal min-w-[3ch] flex-none text-right text-(--text-tertiary) tabular-nums"
                  data-testid="md-ordinal"
                >
                  {block.ordinal}.
                </span>
                <span className="chat-md-content min-w-0">
                  <Segments segments={block.segments} codeClassName="chat-code" />
                </span>
              </div>
            );
          case 'bullet':
            return (
              <div
                key={i}
                className={`chat-md-item chat-md-item--bullet flex items-baseline gap-2 ${
                  i === 0 ? 'mt-0' : 'mt-0.5'
                }`}
                data-testid="md-item-bullet"
                data-depth={block.depth}
                style={{ marginLeft: block.depth * DEPTH_PX }}
              >
                <span className="min-w-3.5 flex-none text-left text-(--text-tertiary) tabular-nums">
                  •
                </span>
                <span className="chat-md-content min-w-0">
                  <Segments segments={block.segments} codeClassName="chat-code" />
                </span>
              </div>
            );
          case 'tasks':
            return <TaskCard key={i} items={block.items} />;
          case 'code':
            return (
              // 围栏块 = .chat-code 的块级孪生：mono、正常对比度、自带底 +
              // 缝线，短行折行不横滚、长块 320px 封顶内滚。
              <pre
                key={i}
                className="chat-md-code my-2 max-h-80 overflow-auto rounded-(--cds-radius-xl) border border-(--border) bg-(--muted) px-2.5 py-2 font-mono text-caption break-words whitespace-pre-wrap text-(--foreground) [word-break:break-word]"
                data-lang={block.lang ?? ''}
                data-testid="md-code"
              >
                {block.text}
              </pre>
            );
          case 'attachment':
            return (
              <div key={i} className="chat-md-attachment my-2">
                <AttachmentChip name={block.name} attachmentKey={block.key} />
              </div>
            );
          case 'para':
            return (
              <p key={i} className="chat-para m-0">
                <Segments segments={block.segments} codeClassName="chat-code" />
              </p>
            );
        }
        // ChatBlock is a closed union — every kind returns above; this is the
        // unreachable fallback biome's useIterableCallbackReturn wants.
        return null;
      })}
    </>
  );
}
