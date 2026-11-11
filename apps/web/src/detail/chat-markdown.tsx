import { cn } from 'cn';
import {
  createContext,
  Fragment,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { IconTooltip } from '../components/icon-tooltip.js';
import { Button } from '../components/ui/button.js';
import { Checkbox } from '../components/ui/checkbox.js';
import { DIALOG_PRIMARY_BUTTON, DialogShell } from '../components/ui/dialog-shell.js';
import type { DocSegment } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { Check, ChiefExpand, Copy } from '../icons/index.js';
import {
  type ChatBlock,
  type ChatBubbleGroup,
  chatBubbleGroups,
  type ListItem,
  parseChatMarkdown,
  type TableAlign,
  type TaskItem,
  type TaskState,
} from '../lib/markdown.js';
import { AttachmentPreview } from '../overlay/attachment-preview.js';
import {
  AttachmentChip,
  AttachmentPreviewHandler,
  attachmentIdFromKey,
  COMPOSER_CHIP_LABEL,
} from './attachment-chip.js';
import { type CodeToken, highlightCode } from './code-highlight.js';
import { Segments } from './segments.js';

export { attachmentIdFromKey, COMPOSER_CHIP_LABEL };

const HEAD_SIZE: Record<number, string> = {
  1: 'text-md-h1',
  2: 'text-heading',
  3: 'text-card-title',
};

function HeadingTag({ level, segments }: { level: number; segments: DocSegment[] }) {
  const clamped = Math.min(6, Math.max(1, level));
  const Tag = `h${clamped}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
  return (
    <Tag
      className={`chat-md-head chat-md-head--${clamped} m-0 font-semibold text-(--foreground) ${HEAD_SIZE[clamped] ?? 'text-ui'}`}
    >
      <Segments segments={segments} codeClassName="chat-code" />
    </Tag>
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
      className="flex list-none flex-col gap-2 rounded-2xl border border-(--border) bg-(--card) px-4 py-3.5 font-sans font-normal shadow-sm"
      data-testid="md-tasks"
    >
      {items.map((item, i) => (
        <li key={i} className="flex flex-col text-ui" data-testid="md-task" data-state={item.state}>
          <div className="flex items-start gap-3">
            <TaskIcon state={item.state} />
            <span
              className={`min-w-0 ${
                item.state === 'done'
                  ? 'text-(--text-tertiary) line-through'
                  : 'text-(--foreground)'
              }`}
            >
              <Segments segments={item.segments} codeClassName="chat-code" />
            </span>
          </div>
          {item.blocks.length > 0 && (
            <div className="mt-1 min-w-0 pl-7 text-(--foreground)" data-testid="md-task-children">
              <MarkdownBlocks blocks={item.blocks} depth={1} flow="list" />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

const TABLE_ALIGN_CLS: Record<Exclude<TableAlign, null>, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
};

function cellAlignClass(align: TableAlign | undefined): string {
  return align != null ? TABLE_ALIGN_CLS[align] : 'text-left';
}

function MarkdownTable({ block }: { block: Extract<ChatBlock, { kind: 'table' }> }) {
  return (
    <div
      className="w-fit max-w-full overflow-x-auto rounded-(--radius-control) border border-border bg-background"
      data-testid="md-table"
    >
      <table className="border-collapse text-ui text-(--foreground)">
        <thead className="bg-secondary">
          <tr className="border-b border-border">
            {block.header.map((cell, ci) => (
              <th
                key={ci}
                className={`px-3 py-1.5 font-semibold whitespace-nowrap ${cellAlignClass(block.align[ci])}`}
              >
                <Segments segments={cell} codeClassName="chat-code" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, ri) => (
            <tr key={ri} className="border-b border-border last:border-b-0">
              {row.map((cell, ci) => (
                <td key={ci} className={`px-3 py-1.5 ${cellAlignClass(block.align[ci])}`}>
                  <Segments segments={cell} codeClassName="chat-code" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const BULLET_STYLES = ['list-disc', 'list-[circle]', 'list-[square]'] as const;
const ORDINAL_STYLES = ['list-decimal', 'list-[lower-alpha]', 'list-[lower-roman]'] as const;

const ListRun = createContext<{ ordered: boolean; run: number } | null>(null);

function listStyle(ordered: boolean, depth: number): string {
  const styles = ordered ? ORDINAL_STYLES : BULLET_STYLES;
  return styles[Math.min(depth, styles.length - 1)] ?? styles[0];
}

function TaskBox({ checked }: { checked: boolean }) {
  return (
    <Checkbox
      checked={checked}
      readOnly
      disabled
      className="mt-0.5 size-4 cursor-default rounded-full border-[1.5px] border-dashed border-(--text-tertiary) bg-transparent data-checked:border-solid data-checked:border-(--text-tertiary) data-checked:bg-(--text-tertiary) data-checked:text-(--card) dark:bg-transparent dark:data-checked:border-(--text-tertiary) dark:data-checked:bg-(--text-tertiary) data-disabled:opacity-100 [&_svg]:size-2.5!"
      data-testid="md-checkbox"
    />
  );
}

function MarkdownList({
  block,
  depth,
}: {
  block: Extract<ChatBlock, { kind: 'list' }>;
  depth: number;
}) {
  const Tag = block.ordered ? 'ol' : 'ul';
  const parent = useContext(ListRun);
  const run = parent !== null && parent.ordered === block.ordered ? parent.run + 1 : 0;
  const taskList = block.items.every((item) => item.checked !== null);
  return (
    <Tag
      className={cn('m-0', taskList ? 'list-none ps-2' : `ps-9 ${listStyle(block.ordered, run)}`)}
      data-testid={block.ordered ? 'md-list-ordered' : taskList ? 'md-list-task' : 'md-list-bullet'}
      {...(block.ordered && block.start !== 1 ? { start: block.start } : {})}
    >
      <ListRun.Provider value={{ ordered: block.ordered, run }}>
        {block.items.map((item, i) => (
          <MarkdownListItem
            key={i}
            item={item}
            ordered={block.ordered}
            depth={depth}
            value={block.start + i}
          />
        ))}
      </ListRun.Provider>
    </Tag>
  );
}

function MarkdownListItem({
  item,
  ordered,
  depth,
  value,
}: {
  item: ListItem;
  ordered: boolean;
  depth: number;
  value: number;
}) {
  const body = <MarkdownBlocks blocks={item.blocks} depth={depth + 1} flow="list" />;
  return (
    <li
      className={cn(
        'chat-md-item marker:text-(--foreground)',
        ordered ? 'chat-md-item--ordered' : 'chat-md-item--bullet',
        item.checked !== null && 'flex items-start gap-3',
        item.checked === true && 'text-(--text-tertiary) line-through',
      )}
      data-testid={
        item.checked !== null ? 'md-item-task' : ordered ? 'md-item-ordered' : 'md-item-bullet'
      }
      data-depth={depth}
      {...(ordered ? { value } : {})}
    >
      {item.checked !== null ? (
        <>
          <TaskBox checked={item.checked} />
          <div className="min-w-0">{body}</div>
        </>
      ) : (
        body
      )}
    </li>
  );
}

function AttachmentBlock({ name, attachmentKey }: { name: string; attachmentKey: string }) {
  const onPreview = useContext(AttachmentPreviewHandler);
  return (
    <div className="chat-md-attachment">
      <AttachmentChip
        name={name}
        attachmentKey={attachmentKey}
        {...(onPreview !== undefined ? { onPreview } : {})}
      />
    </div>
  );
}

type Flow = 'prose' | 'bubble' | 'list';

const FLOW_GAP: Record<Flow, string> = {
  prose: 'mt-prose-flow',
  bubble: 'mt-1',
  list: 'mt-0.5',
};

function MarkdownBlock({ block, depth }: { block: ChatBlock; depth: number }) {
  switch (block.kind) {
    case 'head':
      return <HeadingTag level={block.level} segments={block.segments} />;
    case 'tasks':
      return <TaskCard items={block.items} />;
    case 'code':
      return (
        <CodeBlock {...(block.lang !== undefined ? { lang: block.lang } : {})} text={block.text} />
      );
    case 'attachment':
      return <AttachmentBlock name={block.name} attachmentKey={block.key} />;
    case 'table':
      return <MarkdownTable block={block} />;
    case 'list':
      return <MarkdownList block={block} depth={depth} />;
    case 'quote':
      return (
        <blockquote
          className="m-0 ms-2 border-s-3 border-border ps-3.5 text-(--text-secondary)"
          data-testid="md-quote"
        >
          <MarkdownBlocks blocks={block.blocks} depth={depth} flow="bubble" />
        </blockquote>
      );
    case 'rule':
      return <hr className="m-0 w-full border-0 border-t border-border" />;
    case 'para':
      return (
        <p className="chat-para m-0">
          <Segments segments={block.segments} codeClassName="chat-code" />
        </p>
      );
  }
}

function MarkdownBlocks({
  blocks,
  depth,
  flow,
}: {
  blocks: ChatBlock[];
  depth: number;
  flow: Flow;
}) {
  return blocks.map((block, i) => (
    <div key={i} className={cn('chat-md-block', i > 0 && FLOW_GAP[flow])} data-kind={block.kind}>
      <MarkdownBlock block={block} depth={depth} />
    </div>
  ));
}

const COPIED_MS = 1500;

function capitalize(lang: string): string {
  return lang.charAt(0).toUpperCase() + lang.slice(1);
}

function useCodeTokens(text: string, lang: string | undefined): CodeToken[][] | null {
  const [highlighted, setHighlighted] = useState<{
    text: string;
    lang: string;
    lines: CodeToken[][];
  } | null>(null);
  useEffect(() => {
    if (lang === undefined) return;
    let live = true;
    void highlightCode(text, lang).then((lines) => {
      if (live && lines !== null) setHighlighted({ text, lang, lines });
    });
    return () => {
      live = false;
    };
  }, [text, lang]);
  return highlighted !== null && highlighted.text === text && highlighted.lang === lang
    ? highlighted.lines
    : null;
}

function CodeLines({ lines, text }: { lines: CodeToken[][] | null; text: string }) {
  if (lines === null) return text;
  return lines.map((line, row) => (
    <Fragment key={row}>
      {row > 0 && '\n'}
      {line.map((token, col) =>
        token.color === undefined ? (
          token.content
        ) : (
          <span key={col} style={{ color: token.color }}>
            {token.content}
          </span>
        ),
      )}
    </Fragment>
  ));
}

const CODE_BTN_CLS =
  "size-8 flex-none cursor-pointer rounded-(--radius-control) text-content-tertiary transition-none hover:bg-(--menu-hover) hover:text-foreground dark:hover:bg-(--menu-hover) [&_svg:not([class*='size-'])]:size-auto";

function useCopied(text: string) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const copy = () => {
    void navigator.clipboard.writeText(text).then(() => setCopied(true));
  };
  return { copied, copy };
}

function CopyCodeButton({
  text,
  className,
  testId,
}: {
  text: string;
  className?: string;
  testId: string;
}) {
  const { t } = useI18n();
  const { copied, copy } = useCopied(text);
  return (
    <IconTooltip
      label={t('复制')}
      trigger={
        <Button
          variant="ghost"
          size="icon"
          className={cn(CODE_BTN_CLS, className)}
          data-testid={testId}
          onClick={copy}
        />
      }
    >
      {copied ? <Check width={22} height={22} /> : <Copy width={22} height={22} />}
    </IconTooltip>
  );
}

function CodeBlock({ lang, text }: { lang?: string; text: string }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const lines = useCodeTokens(text, lang);
  const title = lang === undefined ? t('代码') : t('{lang} 代码', { lang: capitalize(lang) });
  return (
    <div
      className="w-fit min-w-48 max-w-full rounded-(--radius-code) border border-border bg-background"
      data-testid="md-code-block"
    >
      <div className="flex h-10 items-center gap-0 border-b border-border pr-1.5 pl-5">
        <span
          className="min-w-0 flex-1 truncate font-sans text-code-lang text-content-tertiary"
          data-testid="md-code-lang"
        >
          {lang}
        </span>
        <IconTooltip
          label={t('展开')}
          trigger={
            <Button
              variant="ghost"
              size="icon"
              className={CODE_BTN_CLS}
              data-testid="md-code-expand"
              onClick={() => setExpanded(true)}
            />
          }
        >
          <ChiefExpand width={22} height={22} />
        </IconTooltip>
        <CopyCodeButton text={text} testId="md-code-copy" />
      </div>
      <div className="overflow-x-auto overscroll-x-contain">
        <pre
          className="chat-md-code m-0 px-5 py-3 font-prose-mono text-code whitespace-pre text-(--foreground)"
          data-lang={lang ?? ''}
          data-testid="md-code"
        >
          <CodeLines lines={lines} text={text} />
        </pre>
      </div>
      <DialogShell
        open={expanded}
        onClose={() => setExpanded(false)}
        title={title}
        width="min(100% - 2rem, var(--dialog-w-xl))"
        footer={
          <Button
            variant="secondary"
            className={DIALOG_PRIMARY_BUTTON}
            data-testid="md-code-done"
            onClick={() => setExpanded(false)}
          >
            {t('完成')}
          </Button>
        }
      >
        <div
          className="relative rounded-(--cds-radius-xl) border border-border bg-secondary"
          data-testid="md-code-dialog-body"
        >
          <CopyCodeButton
            text={text}
            testId="md-code-dialog-copy"
            className="absolute top-2 right-2 z-10"
          />
          <div className="overflow-x-auto overscroll-x-contain">
            <pre className="m-0 px-5 py-3 font-prose-mono text-code whitespace-pre text-(--foreground)">
              <CodeLines lines={lines} text={text} />
            </pre>
          </div>
        </div>
      </DialogShell>
    </div>
  );
}

export const REPLY_BUBBLE_CLS =
  'w-fit max-w-[min(100%,var(--container-reply-bubble))] rounded-(--radius-reply) bg-(--reply-bubble-fill) px-3.5 py-1.75';

function ReplyGroup({
  group,
  tools,
  highlighted,
}: {
  group: ChatBubbleGroup;
  tools: ReactNode;
  highlighted: boolean;
}) {
  return (
    <div
      className="group/reply-block relative w-fit max-w-full"
      data-slot="reply-block"
      data-bubble={group.bubble ? 'true' : 'false'}
    >
      {group.bubble ? (
        <div
          className={cn(REPLY_BUBBLE_CLS, 'data-reply-highlight:bg-(--reply-bubble-highlight)')}
          data-slot="reply-bubble"
          data-testid="chief-reply-bubble"
          {...(highlighted ? { 'data-reply-highlight': '' } : {})}
        >
          <MarkdownBlocks blocks={group.blocks} depth={0} flow="bubble" />
        </div>
      ) : (
        <MarkdownBlocks blocks={group.blocks} depth={0} flow="bubble" />
      )}
      {tools}
    </div>
  );
}

export function ChatMarkdown({
  text,
  bubbles = false,
  bubbleTools,
  highlight,
}: {
  text: string;
  bubbles?: boolean;
  bubbleTools?: (group: ChatBubbleGroup, index: number) => ReactNode;
  highlight?: (group: ChatBubbleGroup) => boolean;
}) {
  const groups = useMemo(() => (bubbles ? chatBubbleGroups(text) : null), [bubbles, text]);
  const blocks = useMemo(() => (bubbles ? null : parseChatMarkdown(text)), [bubbles, text]);
  const [preview, setPreview] = useState<{ name: string; src: string } | null>(null);
  return (
    <AttachmentPreviewHandler.Provider value={(name, src) => setPreview({ name, src })}>
      {groups !== null ? (
        <div className="flex flex-col items-start gap-1" data-slot="reply-blocks">
          {groups.map((group, i) => (
            <ReplyGroup
              key={i}
              group={group}
              tools={bubbleTools?.(group, i)}
              highlighted={highlight?.(group) === true}
            />
          ))}
        </div>
      ) : (
        <MarkdownBlocks blocks={blocks ?? []} depth={0} flow="prose" />
      )}
      {preview !== null && (
        <AttachmentPreview name={preview.name} src={preview.src} onClose={() => setPreview(null)} />
      )}
    </AttachmentPreviewHandler.Provider>
  );
}
