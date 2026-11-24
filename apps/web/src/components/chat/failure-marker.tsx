import { ChevronDown, ChevronUp, CircleAlert, Copy } from 'lucide-react';
import { useId, useState } from 'react';
import { useI18n } from '../../i18n/provider.js';
import { Button } from '../ui/button.js';
import { DialogShell } from '../ui/dialog-shell.js';
import { Marker, MarkerContent, MarkerIcon } from '../ui/marker.js';
import { toastSuccess } from '../ui/toaster.js';

export interface FailureDetail {
  lines: string[];
  raw: string;
}

export function FailureDetailToggle({
  open,
  controls,
  onToggle,
  className = '',
}: {
  open: boolean;
  controls: string;
  onToggle: () => void;
  className?: string;
}) {
  const { t } = useI18n();
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-expanded={open}
      aria-controls={controls}
      data-testid="failure-marker-detail"
      className={`gap-0.5 px-1 font-normal text-content-tertiary pointer-coarse:h-11 ${className}`}
      onClick={onToggle}
    >
      {t('详情')}
      {open ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
    </Button>
  );
}

export function RawError({
  id,
  text,
  testId,
  lines = [],
}: {
  id: string;
  text: string;
  testId: string;
  lines?: string[];
}) {
  const { t } = useI18n();
  return (
    <span
      id={id}
      data-testid={testId}
      className="relative mt-1 block rounded-lg bg-card py-2 pr-9 pl-2.5 text-left font-mono text-caption whitespace-pre-wrap text-content-secondary shadow-(--edge-ring) [overflow-wrap:anywhere]"
    >
      {lines.map((line) => (
        <span key={line} className="mb-1.5 block font-sans text-ui text-foreground">
          {line}
        </span>
      ))}
      {text}
      <Button
        variant="ghost"
        size="icon-xs"
        className="absolute top-1 right-1 text-content-tertiary pointer-coarse:size-11"
        aria-label={t('复制原始错误')}
        title={t('复制原始错误')}
        onClick={() =>
          void navigator.clipboard?.writeText(text).then(() => toastSuccess(t('已复制')))
        }
      >
        <Copy className="size-4" />
      </Button>
    </span>
  );
}

export function FailureMarker({
  label,
  testId,
  detail,
}: {
  label: string;
  testId: string;
  detail?: FailureDetail | undefined;
}) {
  const [open, setOpen] = useState(false);
  const detailId = useId();
  return (
    <div>
      <Marker
        variant="separator"
        role="note"
        data-testid={testId}
        className="gap-1.5 text-meta text-content-tertiary"
      >
        <MarkerIcon>
          <CircleAlert />
        </MarkerIcon>
        <MarkerContent
          data-testid="failure-marker-label"
          className="text-pretty group-data-[variant=separator]/marker:flex-initial"
        >
          {label}
        </MarkerContent>
        {detail !== undefined && (
          <FailureDetailToggle
            open={open}
            controls={detailId}
            onToggle={() => setOpen((v) => !v)}
            className="h-6 flex-none text-meta hover:text-foreground"
          />
        )}
      </Marker>
      {detail !== undefined && open && (
        <RawError id={detailId} text={detail.raw} lines={detail.lines} testId="fail-raw-error" />
      )}
    </div>
  );
}

export function RawTextDialog({
  title,
  lines = [],
  text,
  open,
  onClose,
  testId,
}: {
  title: string;
  lines?: string[];
  text: string;
  open: boolean;
  onClose: () => void;
  testId: string;
}) {
  const { t } = useI18n();
  return (
    <DialogShell
      title={title}
      open={open}
      onClose={onClose}
      size="l"
      headerAction={
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('复制')}
          title={t('复制')}
          className="text-content-tertiary pointer-coarse:size-11"
          onClick={() =>
            void navigator.clipboard?.writeText(text).then(() => toastSuccess(t('已复制')))
          }
        >
          <Copy />
        </Button>
      }
    >
      {lines.map((line) => (
        <p key={line} className="m-0 mb-2 text-ui text-foreground">
          {line}
        </p>
      ))}
      <pre
        className="m-0 rounded-(--cds-radius-sm) border border-(--border) bg-(--muted) px-2.5 py-2 text-left font-mono text-code break-words whitespace-pre-wrap text-(--foreground) [word-break:break-word]"
        data-testid={testId}
      >
        {text}
      </pre>
    </DialogShell>
  );
}
