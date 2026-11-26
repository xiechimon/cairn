import { cn } from 'cn';
import { ChevronDown, CircleAlert, Clock, Copy } from 'lucide-react';
import {
  type ComponentProps,
  type ComponentType,
  type ReactNode,
  type SVGProps,
  useId,
  useState,
} from 'react';
import { useI18n } from '../../i18n/provider.js';
import { copyTextWithFeedback } from '../../lib/clipboard.js';
import { Disclosure } from '../disclosure.js';
import { Button } from '../ui/button.js';
import { DialogShell } from '../ui/dialog-shell.js';
import { Marker, MarkerContent, MarkerIcon } from '../ui/marker.js';
import { toastError, toastSuccess } from '../ui/toaster.js';

export interface NoticeDetail {
  lines: string[];
  raw: string;
}

export function NoticeDetailToggle({
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
      <ChevronDown
        aria-hidden="true"
        className={cn(
          'transition-transform duration-(--dur-fast) ease-(--ease-out-strong) motion-reduce:transition-none',
          open && 'rotate-180',
        )}
      />
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
          copyTextWithFeedback(
            text,
            () => toastSuccess(t('已复制')),
            (error) => toastError(t('复制失败，请重试。'), error),
          )
        }
      >
        <Copy className="size-4" />
      </Button>
    </span>
  );
}

export type NoticeTone = 'neutral' | 'waiting' | 'danger';

const TONE_INK: Record<NoticeTone, string> = {
  neutral: 'text-content-tertiary',
  waiting: 'text-(--card-button)',
  danger: 'text-destructive',
};

const DEFAULT_ICON: Record<NoticeTone, ComponentType<SVGProps<SVGSVGElement>> | null> = {
  neutral: null,
  waiting: Clock,
  danger: CircleAlert,
};

export const NOTICE_LINE_PLAIN_CLS =
  'flex min-h-6 min-w-0 items-center gap-2 text-left font-sans text-meta tabular-nums text-(--text-tertiary)';

export function NoticeLine({
  label,
  children,
  testId,
  detail,
  detailTestId,
  onKeyDown,
  tone = 'neutral',
  layout = 'separator',
  waiting = false,
  live = false,
  icon,
  actions,
  className,
  contentClassName,
}: {
  label?: ReactNode;
  children?: ReactNode;
  testId?: string | undefined;
  detail?: NoticeDetail | undefined;
  detailTestId?: string | undefined;
  onKeyDown?: ComponentProps<'div'>['onKeyDown'] | undefined;
  tone?: NoticeTone;
  layout?: 'plain' | 'separator';
  waiting?: boolean;
  live?: boolean;
  icon?: ComponentType<SVGProps<SVGSVGElement>> | null;
  actions?: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const detailId = useId();
  const Icon = icon === undefined ? DEFAULT_ICON[tone] : icon;
  const announced = live || waiting;
  const detailToggle = detail !== undefined && (
    <NoticeDetailToggle
      open={open}
      controls={detailId}
      onToggle={() => setOpen((value) => !value)}
      className="h-6 flex-none text-meta hover:text-foreground"
    />
  );
  const body =
    layout === 'separator' ? (
      <Marker
        variant="separator"
        role={announced ? 'status' : 'note'}
        data-testid={testId}
        data-waiting={waiting ? '' : undefined}
        onKeyDown={onKeyDown}
        className={cn('gap-1.5 text-meta text-content-tertiary', className)}
      >
        {Icon !== null && (
          <MarkerIcon className={TONE_INK[tone]}>
            <Icon />
          </MarkerIcon>
        )}
        <MarkerContent
          data-testid="failure-marker-label"
          className={cn(
            'text-pretty tabular-nums group-data-[variant=separator]/marker:flex-initial',
            contentClassName,
          )}
        >
          {label ?? children}
        </MarkerContent>
        {detailToggle}
        {actions}
      </Marker>
    ) : (
      <div
        role={announced ? 'status' : undefined}
        data-testid={testId}
        data-waiting={waiting ? '' : undefined}
        className={cn(NOTICE_LINE_PLAIN_CLS, className)}
      >
        {Icon !== null && (
          <Icon aria-hidden="true" className={cn('size-4 flex-none', TONE_INK[tone])} />
        )}
        <span
          data-testid="failure-marker-label"
          className={cn('max-w-[68ch] min-w-0 [overflow-wrap:anywhere]', contentClassName)}
        >
          {label ?? children}
        </span>
        {detailToggle}
        {actions}
      </div>
    );
  return (
    <div>
      {body}
      {detail !== undefined && (
        <Disclosure open={open}>
          <RawError
            id={detailId}
            text={detail.raw}
            lines={detail.lines}
            testId={detailTestId ?? 'fail-raw-error'}
          />
        </Disclosure>
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
            copyTextWithFeedback(
              text,
              () => toastSuccess(t('已复制')),
              (error) => toastError(t('复制失败，请重试。'), error),
            )
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
