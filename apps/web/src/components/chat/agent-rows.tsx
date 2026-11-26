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

const PREVIEW_CHARS = 150;
const GENERIC_THINKING_OPENER =
  /^(?:i['’]?m |i am |let me )?(?:think(?:ing)?(?:\s+(?:through|about)\b[^.!?]*)?|reason(?:ing)?(?:\s+(?:through|about)\b[^.!?]*)?)[.!?…]*$/i;

export function thinkingPreview(text: string, fallback: string): string {
  const firstLine =
    text
      .trim()
      .split('\n')
      .find((line) => line.trim() !== '')
      ?.trim() ?? '';
  if (firstLine === '' || GENERIC_THINKING_OPENER.test(firstLine)) return fallback;
  return firstLine.length > PREVIEW_CHARS ? `${firstLine.slice(0, PREVIEW_CHARS)}…` : firstLine;
}

const AGENT_LINE_CLS =
  'text-meta leading-5 tabular-nums text-content-tertiary data-[status=error]:text-content-tertiary';

export function ThinkingRow({
  text,
  defaultOpen = false,
}: {
  text: string | readonly string[];
  defaultOpen?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(defaultOpen);
  const steps = typeof text === 'string' ? [text] : text;
  const single = steps.length <= 1 ? (steps[0] ?? '') : null;
  const title = single !== null ? t('思考') : t('思考 {n} 步', { n: steps.length });
  return (
    <Trace>
      <TraceCollapsible open={open} onOpenChange={setOpen}>
        <TraceCollapsibleTrigger
          className={`${AGENT_LINE_CLS} font-medium`}
          aria-label={t(open ? '收起思考' : '展开思考')}
        >
          <TraceLine className={AGENT_LINE_CLS}>
            <TraceTitle>{title}</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          {single !== null ? (
            <pre className="m-0 whitespace-pre-wrap break-words font-[inherit] text-meta leading-5 text-(--text-secondary)">
              {single}
            </pre>
          ) : (
            <ol className="m-0 flex list-none flex-col gap-2.5 p-0">
              {steps.map((step, index) => (
                <li key={index} className="min-w-0">
                  <div className="text-caption font-medium text-content-tertiary tabular-nums">
                    {t('第 {n} 步', { n: index + 1 })}
                  </div>
                  <pre className="m-0 mt-0.5 whitespace-pre-wrap break-words font-[inherit] text-meta leading-5 text-(--text-secondary)">
                    {step}
                  </pre>
                </li>
              ))}
            </ol>
          )}
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}
