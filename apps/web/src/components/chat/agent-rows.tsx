import { useState } from 'react';
import { useI18n } from '../../i18n/provider.js';
import { ChevronDown, ChevronRight } from '../../icons/index.js';
import { Button } from '../ui/button.js';
import { useLiveSeconds } from './live-row.js';

const PREVIEW_CHARS = 150;

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
    <div className="flex flex-col gap-1">
      <Button
        variant="ghost"
        className="h-auto w-fit min-w-0 max-w-full shrink justify-start gap-1.5 rounded-none px-0 font-medium text-[12px] leading-4 text-[var(--text-dim)] active:not-aria-[haspopup]:translate-y-0 [&_svg:not([class*='size-'])]:size-auto"
        aria-label={t(open ? '收起思考' : '展开思考')}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown width={10} height={10} /> : <ChevronRight width={10} height={10} />}
        <span className="min-w-0 flex-auto truncate italic">{open ? t('思考') : preview}</span>
      </Button>
      {open && (
        <pre className="m-0 whitespace-pre-wrap break-words font-[inherit] text-[12px] leading-4 text-[var(--text-secondary)]">
          {text}
        </pre>
      )}
    </div>
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
  return (
    <span className="flex items-center gap-2 text-[12px] leading-4 text-[var(--text-dim)]">
      <span className="font-[var(--font-mono)]">
        {running === true ? t('正在调用 {n}', { n: name }) : name}
      </span>
      {shown != null && <span className="tabular-nums">{shown}s</span>}
      {error === true && <span className="text-[var(--destructive)]">{t('失败')}</span>}
    </span>
  );
}
