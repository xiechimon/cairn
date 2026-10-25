import { AGENT_TODO_LINE_RE, AGENT_TODO_MARKER_STATES, type AgentTodoState } from '@cairn/shared';
import { useMemo } from 'react';
import { inlineSegments } from '../api/mappers.js';
import { Button } from '../components/ui/button.js';
import type { DocSegment } from '../fixtures/records.js';
import { Check } from '../icons/index.js';
import { ATTACHMENT_LINE } from '../overlay/attachment-paste.js';
import { Segments } from './segments.js';

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

const DEPTH_PX = 18;

function depthOf(indent: string): number {
  return Math.floor(indent.replace(/\t/g, '  ').length / 2);
}

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*(\S*)\s*$/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*)$/;
const ORDERED = /^(\s*)(\d+)[.)]\s+(.*)$/;
const BULLET = /^(\s*)[-*•]\s+(.*)$/;

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
      i += 1;
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

export function attachmentIdFromKey(key: string): string {
  const lastSlash = key.lastIndexOf('/');
  const tail = lastSlash >= 0 ? key.slice(lastSlash + 1) : key;
  const dot = tail.lastIndexOf('.');
  return dot > 0 ? tail.slice(0, dot) : tail;
}

export function isImageAttachmentKey(key: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(key);
}

export const SPEC_CHIP =
  'inline-flex max-w-full items-center rounded-[6px] border border-(--border) bg-(--muted) px-2 py-1 text-meta text-(--text-secondary) no-underline transition-[color,border-color] duration-(--dur-fast) ease-(--ease-standard) hover:border-(--input) hover:text-(--foreground)';
export const SPEC_CHIP_IMAGE = 'border-none bg-transparent p-0.5 hover:bg-transparent';
export const SPEC_CHIP_IMG = 'block max-h-40 max-w-full rounded-[4px]';

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

export function TaskCard({ items }: { items: TaskItem[] }) {
  return (
    <ul
      className="my-2 flex list-none flex-col gap-2 rounded-2xl border border-(--border) bg-(--card) px-4 py-3.5 shadow-sm"
      data-testid="md-tasks"
    >
      {items.map((item, i) => (
        <li
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

export function ChatMarkdown({ text }: { text: string }) {
  const blocks = useMemo(() => parseChatMarkdown(text), [text]);
  return (
    <>
      {blocks.map((block, i) => {
        switch (block.kind) {
          case 'head':
            return <HeadingTag key={i} level={block.level} segments={block.segments} />;
          case 'ordered':
            return (
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
        return null;
      })}
    </>
  );
}
