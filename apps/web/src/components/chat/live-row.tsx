import { type ReactNode, useEffect, useState } from 'react';
import { useConnected } from '../../api/connection-state.js';
import { formatTokens } from '../../api/mappers.js';
import { useI18n } from '../../i18n/provider.js';
import type { TFunc, TVars } from '../../i18n/translate.js';
import { Button } from '../ui/button.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip.js';
import { TraceChevron } from './trace-parts.js';

export function useLiveSeconds(startedAt: number | null | undefined): number | null {
  const connected = useConnected();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt == null || !connected) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt, connected]);
  if (startedAt == null) return null;
  return Math.max(1, Math.round((now - startedAt) / 1000));
}

export function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

export function liveTokensLabel(output: number, t: TFunc): string {
  return t('{n} tokens', { n: output < 1000 ? output : formatTokens(output) });
}

export function formatLiveElapsed(seconds: number | null): string {
  if (seconds === null || seconds < 5) return '';
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

const HEAD =
  'flex min-w-0 max-w-full items-center gap-1 overflow-hidden whitespace-nowrap text-(--text-tertiary)';

const HEAD_SIZE = 'text-ui leading-6';

const HEAD_BTN =
  "chat-interaction h-auto min-h-0 w-fit cursor-pointer justify-start rounded-md border-none bg-transparent px-0 py-0.5 text-left font-normal hover:bg-transparent hover:text-(--text-secondary) dark:hover:bg-transparent dark:hover:text-(--text-secondary) aria-expanded:bg-transparent aria-expanded:text-(--text-tertiary) [&_svg:not([class*='size-'])]:size-auto";

export function LivePulse({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-testid="live-pulse"
      className={`live-pulse block size-[7px] rounded-full bg-(--text-tertiary) ${className ?? ''}`}
    />
  );
}

const TYPING_PILL = 'inline-flex w-fit items-center gap-1 rounded-full bg-secondary px-3 py-2.5';

function TypingDotMarks() {
  return [0, 1, 2].map((n) => (
    <span
      key={n}
      aria-hidden="true"
      data-testid="typing-dot"
      style={{ animationDelay: `${n * 0.15}s` }}
      className="typing-dot block size-1.5 rounded-full bg-(--text-tertiary)"
    />
  ));
}

export function TypingDots({
  className,
  label,
  testId = 'typing-dots',
}: {
  className?: string;
  label?: string;
  testId?: string;
}) {
  const { t } = useI18n();
  return (
    <span
      role="status"
      aria-label={label === undefined ? t('正在回复') : undefined}
      data-testid={testId}
      className={`${TYPING_PILL} ${className ?? ''}`}
    >
      <TypingDotMarks />
      {label !== undefined && <span className="sr-only">{label}</span>}
    </span>
  );
}

export function TaskLiveRow({
  label,
  seconds,
  startedAt,
  tokens,
  testId = 'live-row',
}: {
  label: string;
  seconds?: number | undefined;
  startedAt?: number | undefined;
  tokens?: string | undefined;
  testId?: string | undefined;
}) {
  const liveSeconds = useLiveSeconds(seconds === undefined ? (startedAt ?? null) : null);
  const elapsed = formatLiveElapsed(seconds ?? liveSeconds);
  return (
    <div
      role="status"
      data-testid={testId}
      className="flex min-w-0 max-w-full items-start gap-2 py-1 text-ui leading-5 text-(--text-secondary)"
    >
      <span className="inline-flex h-5 flex-none items-center gap-1">
        <TypingDotMarks />
      </span>
      <span className="min-w-0 [overflow-wrap:anywhere] shimmer motion-reduce:shimmer-none">
        {label}
      </span>
      {elapsed !== '' && (
        <span
          className="flex-none text-meta tabular-nums text-(--text-tertiary)"
          data-slot="live-elapsed"
        >
          {elapsed}
          {tokens !== undefined && <span data-slot="live-tokens"> · {tokens}</span>}
        </span>
      )}
    </div>
  );
}

export function TaskBlockedRow({ text, actions }: { text: string; actions?: ReactNode }) {
  return (
    <div
      role="status"
      data-testid="queue-blocked"
      className="agent-measure flex min-w-0 flex-col items-start gap-1.5 text-meta leading-5 text-content-secondary [overflow-wrap:anywhere]"
    >
      <span>{text}</span>
      {actions}
    </div>
  );
}

export function BlockedTyping({ text, actions }: { text: string; actions?: ReactNode }) {
  return (
    <span className="flex min-w-0 flex-col items-start gap-1" data-testid="queue-blocked">
      <TypingDots />
      <span className="text-meta text-content-secondary [overflow-wrap:anywhere]">{text}</span>
      {actions}
    </span>
  );
}

export function LiveSignal({ at, className }: { at?: number | null; className: string }) {
  const { t } = useI18n();
  const secs = useLiveSeconds(at ?? null);
  if (secs == null) return null;
  return <span className={className}>{t('最近信号：{n}s 前', { n: secs })}</span>;
}

export interface LiveRowProps {
  variant: 'detail' | 'chief';
  label: string;
  labelVars?: TVars;
  labelDetail?: { label: string; vars: TVars };
  quiet?: boolean;
  notice?: boolean;
  blocked?: boolean;
  blockedActions?: ReactNode;
  disclosure?: { expand: string; collapse: string } | null;
  children?: ReactNode;
}

export function LiveRow({
  variant,
  label,
  labelVars,
  labelDetail,
  quiet = false,
  notice = true,
  blocked = false,
  blockedActions,
  disclosure = null,
  children,
}: LiveRowProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const labelCls = 'chat-streaming-label truncate shimmer motion-reduce:shimmer-none';
  const body = (
    <>
      <span
        className={labelCls}
        title={labelDetail !== undefined ? t(labelDetail.label, labelDetail.vars) : undefined}
      >
        {t(label, labelVars)}
      </span>
      {disclosure != null && <TraceChevron open={expanded} />}
    </>
  );
  const testid = variant === 'detail' ? 'live-row' : undefined;
  if (variant === 'chief') {
    const labelText = t(label, labelVars);
    if (blocked) return <BlockedTyping text={labelText} actions={blockedActions} />;
    if (!notice) return <TypingDots label={labelText} />;
    return (
      <Tooltip>
        <TooltipTrigger render={<span className="w-fit" />}>
          <TypingDots label={labelText} />
        </TooltipTrigger>
        <TooltipContent side="top" align="start" sideOffset={6} data-testid="chief-live-notice">
          {labelDetail !== undefined ? t(labelDetail.label, labelDetail.vars) : labelText}
        </TooltipContent>
      </Tooltip>
    );
  }
  return (
    <div className="flex min-w-0 flex-col">
      {disclosure == null ? (
        <span className={quiet ? 'sr-only' : `${HEAD} ${HEAD_SIZE}`} data-testid={testid}>
          {body}
        </span>
      ) : (
        <Button
          variant="ghost"
          className={`${HEAD} ${HEAD_SIZE} ${HEAD_BTN}`}
          data-testid={testid}
          aria-label={t(expanded ? disclosure.collapse : disclosure.expand)}
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {body}
        </Button>
      )}
      {disclosure != null && expanded && children}
      <LivePulse className="mt-1 ml-0.5" />
    </div>
  );
}
