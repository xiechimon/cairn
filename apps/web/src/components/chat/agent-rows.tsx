import { useState } from 'react';
import { useI18n } from '../../i18n/provider.js';
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceLine,
  TraceTitle,
} from '../ui/trace.js';
import { useLiveSeconds } from './live-row.js';
import { TraceRows } from './trace-steps.js';

const PREVIEW_CHARS = 150;

const AGENT_LINE_CLS =
  'text-meta leading-5 text-content-tertiary data-[status=error]:text-content-tertiary';

export function ThinkingRow({ text }: { text: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const firstLine =
    text
      .trim()
      .split('\n')
      .find((l) => l.trim() !== '') ?? '';
  const preview =
    firstLine.length > PREVIEW_CHARS ? `${firstLine.slice(0, PREVIEW_CHARS)}…` : firstLine;
  return (
    <Trace>
      <TraceCollapsible open={open} onOpenChange={setOpen}>
        <TraceCollapsibleTrigger
          className={`${AGENT_LINE_CLS} font-medium`}
          aria-label={t(open ? '收起思考' : '展开思考')}
        >
          <TraceLine className={AGENT_LINE_CLS}>
            <TraceTitle className="italic">{open ? t('思考') : preview}</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <pre className="m-0 whitespace-pre-wrap break-words font-[inherit] text-meta leading-5 text-(--text-secondary)">
            {text}
          </pre>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

export function ToolActivityRow({
  name,
  startedAt,
  seconds,
  running,
  error,
}: {
  name: string;
  startedAt?: number;
  seconds?: number;
  running?: boolean;
  error?: boolean;
}) {
  const { t } = useI18n();
  const tick = useLiveSeconds(running === true ? (startedAt ?? null) : null);
  const shown = tick ?? seconds ?? null;
  const status = error === true ? 'failed' : running === true ? 'running' : 'done';
  return (
    <TraceRows
      density="compact"
      steps={[
        {
          id: name,
          step: {
            kind: 'tool',
            ...(running === true ? { verb: t('正在调用') } : {}),
            name,
            status,
            ...(shown != null ? { secs: shown } : {}),
          },
        },
      ]}
    />
  );
}
