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
  'text-meta leading-5 text-content-tertiary data-[status=error]:text-content-tertiary';

export function ThinkingRow({
  text,
  defaultOpen = false,
}: {
  text: string;
  defaultOpen?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(defaultOpen);
  const preview = thinkingPreview(text, t('思考'));
  return (
    <Trace>
      <TraceCollapsible open={open} onOpenChange={setOpen}>
        <TraceCollapsibleTrigger
          className={`${AGENT_LINE_CLS} font-medium`}
          aria-label={t(open ? '收起思考' : '展开思考')}
        >
          <TraceLine className={AGENT_LINE_CLS}>
            <TraceTitle>{open ? t('思考') : preview}</TraceTitle>
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
