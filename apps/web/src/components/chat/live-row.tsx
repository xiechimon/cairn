import { type ReactNode, useEffect, useState } from 'react';
import { useConnected } from '../../api/connection-state.js';
import { useI18n } from '../../i18n/provider.js';
import type { TVars } from '../../i18n/translate.js';
import { Button } from '../ui/button.js';
import { TraceTriangle } from './trace-parts.js';

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

const HEAD =
  'flex min-w-0 max-w-full items-center gap-1 overflow-hidden whitespace-nowrap text-ui leading-6 text-(--text-tertiary)';

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

export function TypingDots({ className }: { className?: string }) {
  const { t } = useI18n();
  return (
    <span
      role="status"
      aria-label={t('正在回复')}
      data-testid="typing-dots"
      className={`inline-flex w-fit items-center gap-1 rounded-full bg-secondary px-3 py-2.5 ${className ?? ''}`}
    >
      {[0, 1, 2].map((n) => (
        <span
          key={n}
          aria-hidden="true"
          data-testid="typing-dot"
          style={{ animationDelay: `${n * 0.15}s` }}
          className="typing-dot block size-1.5 rounded-full bg-(--text-tertiary)"
        />
      ))}
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
  waiting?: boolean;
  disclosure?: { expand: string; collapse: string } | null;
  children?: ReactNode;
}

export function LiveRow({
  variant,
  label,
  labelVars,
  labelDetail,
  quiet = false,
  waiting = false,
  disclosure = null,
  children,
}: LiveRowProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const labelCls = waiting
    ? 'chat-streaming-label truncate'
    : 'chat-streaming-label truncate shimmer motion-reduce:shimmer-none';
  const body = (
    <>
      <span
        className={labelCls}
        title={labelDetail !== undefined ? t(labelDetail.label, labelDetail.vars) : undefined}
      >
        {t(label, labelVars)}
      </span>
      {disclosure != null && <TraceTriangle open={expanded} />}
    </>
  );
  const testid = variant === 'detail' ? 'live-row' : undefined;
  return (
    <div className="flex min-w-0 flex-col">
      {disclosure == null ? (
        <span className={quiet ? 'sr-only' : HEAD} data-testid={testid}>
          {body}
        </span>
      ) : (
        <Button
          variant="ghost"
          className={`${HEAD} ${HEAD_BTN}`}
          data-testid={testid}
          aria-label={t(expanded ? disclosure.collapse : disclosure.expand)}
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {body}
        </Button>
      )}
      {disclosure != null && expanded && children}
      {!waiting &&
        (variant === 'chief' ? (
          <TypingDots className="mt-1" />
        ) : (
          <LivePulse className="mt-1 ml-0.5" />
        ))}
    </div>
  );
}
