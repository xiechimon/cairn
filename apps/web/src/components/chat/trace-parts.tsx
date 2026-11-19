import { cn } from 'cn';
import { ChevronRight } from 'lucide-react';
import { type ComponentProps, type ReactNode, useEffect, useState } from 'react';
import type { TFunc } from '../../i18n/translate.js';
import { Button } from '../ui/button.js';

export interface TraceCounts {
  setup: number;
  think: number;
  read: number;
  search: number;
  run: number;
  edit: number;
  push: number;
  tool: number;
  failed: number;
}

export const EMPTY_TRACE_COUNTS: TraceCounts = {
  setup: 0,
  think: 0,
  read: 0,
  search: 0,
  run: 0,
  edit: 0,
  push: 0,
  tool: 0,
  failed: 0,
};

const SUMMARY_BTN =
  "chat-interaction -ml-3 h-7 min-h-0 w-fit max-w-full cursor-pointer justify-start gap-2 rounded-(--radius-control) border-0 bg-transparent px-3 py-0 text-left text-ui leading-5 font-normal text-(--text-secondary) hover:bg-transparent hover:text-(--foreground) dark:hover:bg-transparent dark:hover:text-(--foreground) aria-expanded:bg-transparent aria-expanded:text-(--text-secondary) aria-expanded:hover:bg-transparent aria-expanded:hover:text-(--foreground) dark:aria-expanded:hover:bg-transparent [&_svg:not([class*='size-'])]:size-auto";

const ROW_BTN =
  "chat-interaction flex h-9 min-h-9 w-full min-w-0 cursor-pointer justify-start gap-1.5 rounded-(--cds-radius-xs) border-0 bg-transparent px-3 text-left font-normal text-(--text-tertiary) hover:bg-(--menu-hover) hover:text-(--text-tertiary) aria-expanded:bg-transparent aria-expanded:text-(--text-tertiary) dark:hover:bg-(--menu-hover) [&_svg:not([class*='size-'])]:size-auto";

export const RUNNING_VERB =
  'data-running:[&_[data-trace-verb]]:shimmer motion-reduce:data-running:[&_[data-trace-verb]]:shimmer-none';

const SUMMARY_PARTS = {
  past: {
    setup: '准备了工作区',
    think: '思考 {n} 次',
    read: '读了 {n} 个文件',
    search: '搜索 {n} 次',
    run: '跑了 {n} 条命令',
    edit: '改了 {n} 个文件',
    push: '推送 {n} 次',
    tool: '调用 {n} 个工具',
  },
  present: {
    setup: '正在准备工作区',
    think: '正在思考',
    read: '正在读 {n} 个文件',
    search: '正在搜索 {n} 次',
    run: '正在跑 {n} 条命令',
    edit: '正在改 {n} 个文件',
    push: '正在推送',
    tool: '正在调用 {n} 个工具',
  },
} as const;

const SUMMARY_KINDS = ['setup', 'think', 'read', 'search', 'run', 'edit', 'push', 'tool'] as const;

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

export function traceSummary(
  t: TFunc,
  counts: TraceCounts,
  running: boolean,
): { text: string; failed: string | null } {
  const table = running ? SUMMARY_PARTS.present : SUMMARY_PARTS.past;
  const parts = SUMMARY_KINDS.filter((kind) => counts[kind] > 0).map((kind, index) => {
    const part = t(table[kind], { n: counts[kind] });
    return index === 0 ? part : lowerFirst(part);
  });
  return {
    text: parts.join(t('，')),
    failed: counts.failed > 0 ? t('（{n} 个失败）', { n: counts.failed }) : null,
  };
}

export function TraceChevron({ open }: { open: boolean }) {
  return (
    <ChevronRight
      aria-hidden="true"
      data-trace-triangle={open ? 'open' : 'closed'}
      className={cn('size-4 flex-none text-(--text-tertiary)', open && 'rotate-90')}
    />
  );
}

export function TraceGroupSummary({
  summary,
  failed,
  elapsed,
  open,
  summaryTitle,
  running = false,
  className,
  ...props
}: Omit<ComponentProps<typeof Button>, 'children'> & {
  summary: ReactNode;
  failed?: string | null;
  elapsed?: string;
  summaryTitle?: string;
  open: boolean;
  running?: boolean;
}) {
  const state = running ? 'running' : failed != null ? 'failed' : 'done';
  return (
    <Button
      variant="ghost"
      aria-expanded={open}
      data-trace-state={state}
      className={cn(SUMMARY_BTN, className)}
      {...props}
    >
      {running && (
        <span className="inline-flex h-5 flex-none items-center gap-1" data-trace-live="">
          {[0, 1, 2].map((n) => (
            <span
              key={n}
              aria-hidden="true"
              style={{ animationDelay: `${n * 0.15}s` }}
              className="typing-dot block size-1.5 rounded-full bg-(--text-tertiary)"
            />
          ))}
        </span>
      )}
      <span className="min-w-0 truncate" data-trace-summary="" title={summaryTitle}>
        <span
          key={running ? summaryTitle : undefined}
          className={cn(running && 'text-swap shimmer motion-reduce:shimmer-none')}
        >
          {summary}
        </span>
      </span>
      {failed != null && (
        <span className="-ml-1 flex-none text-destructive" data-trace-failed="">
          {failed}
        </span>
      )}
      {elapsed !== undefined && elapsed !== '' && (
        <span
          className="flex-none text-meta tabular-nums text-(--text-tertiary)"
          data-slot="trace-elapsed"
        >
          {elapsed}
        </span>
      )}
      <TraceChevron open={open} />
    </Button>
  );
}

const TRACE_COLLAPSE_MS = 200;

export function TraceCollapse({ open, children }: { open: boolean; children: ReactNode }) {
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  useEffect(() => {
    if (open) return;
    const id = setTimeout(() => setMounted(false), TRACE_COLLAPSE_MS);
    return () => clearTimeout(id);
  }, [open]);
  return (
    <div
      data-trace-collapse={open ? 'open' : 'closed'}
      inert={!open}
      className={cn(
        'grid transition-[grid-template-rows,opacity] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none',
        open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
      )}
    >
      <div className="min-h-0 overflow-hidden">{mounted && children}</div>
    </div>
  );
}

export function TraceCard({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-trace-card=""
      className={cn(
        'mt-0.5 min-w-0 divide-y divide-(--border) overflow-hidden rounded-(--cds-radius-xl) ring-1 ring-(--border) ring-inset',
        className,
      )}
      {...props}
    />
  );
}

export function TraceRowButton({
  verb,
  target,
  mono = false,
  trailing,
  expandable = false,
  open = false,
  running = false,
  compact = false,
  className,
  onClick,
  ...props
}: Omit<ComponentProps<typeof Button>, 'children' | 'variant'> & {
  verb: ReactNode;
  target?: ReactNode;
  mono?: boolean;
  trailing?: ReactNode;
  expandable?: boolean;
  open?: boolean;
  running?: boolean;
  compact?: boolean;
}) {
  const body = (
    <>
      <span className="flex-none" data-trace-verb="">
        {verb}
      </span>
      {target != null && (
        <span
          className={cn(
            'min-w-0 truncate font-medium text-(--foreground)',
            mono && 'font-mono text-code',
          )}
        >
          {target}
        </span>
      )}
      {expandable && <TraceChevron open={open} />}
      <span className="ml-auto flex flex-none items-center gap-2 pl-2 tabular-nums">
        {trailing}
      </span>
    </>
  );
  const tone = cn(compact ? 'text-meta' : 'text-ui', RUNNING_VERB);
  if (onClick == null)
    return (
      <div
        data-running={running ? '' : undefined}
        data-testid={props['data-testid' as keyof typeof props] as string | undefined}
        className={cn(
          'flex h-9 min-w-0 items-center gap-1.5 px-3 text-(--text-tertiary)',
          tone,
          className,
        )}
      >
        {body}
      </div>
    );
  return (
    <Button
      variant="ghost"
      data-running={running ? '' : undefined}
      aria-expanded={expandable ? open : undefined}
      className={cn(ROW_BTN, tone, className)}
      onClick={onClick}
      {...props}
    >
      {body}
    </Button>
  );
}

export function TraceCommandBox({
  command,
  prompt = true,
  className,
}: {
  command: string;
  prompt?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-lg bg-(--menu-hover) px-3 py-2 font-mono text-code leading-5 whitespace-pre-wrap text-(--foreground) [overflow-wrap:anywhere]',
        className,
      )}
      data-trace-command=""
    >
      {prompt && <span className="text-(--text-tertiary)">$ </span>}
      {command}
    </div>
  );
}

export function TraceOutput({ className, ...props }: ComponentProps<'pre'>) {
  return (
    <pre
      className={cn(
        'm-0 max-h-60 overflow-auto px-0.5 pt-2 text-left font-mono text-code leading-[18px] whitespace-pre-wrap text-(--text-tertiary) [overflow-wrap:anywhere]',
        className,
      )}
      {...props}
    />
  );
}

export function TraceFailTag({ children }: { children: ReactNode }) {
  return <span className="text-meta font-medium text-destructive">{children}</span>;
}
