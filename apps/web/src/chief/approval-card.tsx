import { cn } from 'cn';
import { CircleAlert, KeyRound, Mail, Monitor, Send, Terminal } from 'lucide-react';
import { type ComponentType, Fragment, type ReactNode, type SVGProps, useState } from 'react';
import { Disclosure } from '../components/disclosure.js';
import { NoticeBanner } from '../components/notice-banner.js';
import { Button } from '../components/ui/button.js';
import { RingSpinner } from '../components/ui/ring-spinner.js';
import { useI18n } from '../i18n/provider.js';
import type { ApprovalCardModel, ApprovalField, ApprovalKind } from './approval-card-model.js';

export interface ApprovalAction {
  label: string;
  testId: string;
  onClick: () => void;
}

export interface ApprovalCardProps {
  card: ApprovalCardModel;
  actions?: readonly ApprovalAction[];
  busy?: string | null;
  disabled?: boolean;
  problem?: string | null;
  testId?: string;
  outcome?: string;
  children?: ReactNode;
}

const KIND_ICON: Record<ApprovalKind, ComponentType<SVGProps<SVGSVGElement>>> = {
  mail: Mail,
  send: Send,
  shell: Terminal,
  app: Monitor,
  secret: KeyRound,
  other: CircleAlert,
};

const FOLD_LINES = 5;
const FOLD_CHARS = 360;
const ACTION_BUTTON_CLS = 'pointer-coarse:h-11 pointer-coarse:px-4';
const INLINE_LINK_CLS = 'h-auto min-h-6 p-0 text-meta font-normal text-content-secondary';

function variantAt(index: number, count: number): 'default' | 'outline' | 'ghost' {
  if (index === 0) return 'default';
  return index === count - 1 ? 'ghost' : 'outline';
}

function Preview({
  value,
  mono,
  allowFold = true,
}: {
  value: string;
  mono: boolean;
  allowFold?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const lines = value.split('\n').length;
  const foldable = allowFold && (lines > FOLD_LINES || value.length > FOLD_CHARS);
  return (
    <>
      <blockquote
        data-testid="approval-card-quote"
        className={cn(
          'm-0 mt-2 border-s-2 border-border ps-3.5 text-ui text-foreground',
          !allowFold && 'max-h-60 overflow-y-auto',
        )}
      >
        <span
          data-testid="approval-field-value"
          className={cn(
            'block whitespace-pre-wrap wrap-anywhere',
            mono && 'font-mono text-code',
            foldable && !open && 'line-clamp-5',
          )}
        >
          {value}
        </span>
      </blockquote>
      {foldable && (
        <Button
          type="button"
          variant="link"
          data-testid="approval-field-more"
          aria-expanded={open}
          className={cn(INLINE_LINK_CLS, 'ms-4 mt-1')}
          onClick={() => setOpen(!open)}
        >
          {open
            ? t('收起')
            : lines > FOLD_LINES
              ? t('展开全文 · 共 {n} 行', { n: lines })
              : t('展开全文')}
        </Button>
      )}
    </>
  );
}

function RawArguments({ fields }: { fields: readonly ApprovalField[] }) {
  return (
    <dl
      data-testid="approval-details"
      className="m-0 mt-2 grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-md bg-muted px-3 py-2 font-mono text-meta text-content-secondary"
    >
      {fields.map((field, index) => (
        <Fragment key={`${field.label}-${index}`}>
          <dt data-testid="approval-detail-label">{field.label}</dt>
          <dd className="m-0 min-w-0 whitespace-pre-wrap wrap-anywhere">{field.value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

export function ApprovalCard({
  card,
  actions = [],
  busy = null,
  disabled = false,
  problem = null,
  testId = 'approval-card',
  outcome,
  children,
}: ApprovalCardProps) {
  const { t } = useI18n();
  const [raw, setRaw] = useState(false);
  const hasRaw = card.details.length > 0;
  const footer =
    card.note !== null || hasRaw || actions.length > 0 ? (
      <span className="wrap-anywhere">
        {card.note !== null && <span data-testid="approval-card-note">{card.note}</span>}
        {card.note !== null && hasRaw && ' · '}
        {hasRaw && (
          <Button
            type="button"
            variant="link"
            data-testid="approval-details-toggle"
            aria-expanded={raw}
            className={INLINE_LINK_CLS}
            onClick={() => setRaw(!raw)}
          >
            {raw ? t('收起原始参数') : t('原始参数')}
          </Button>
        )}
      </span>
    ) : null;
  return (
    <NoticeBanner
      tone="waiting"
      icon={KIND_ICON[card.kind]}
      data-testid={testId}
      data-slot="approval-card"
      data-outcome={outcome}
      aria-label={card.title}
      className="w-reply-bubble max-w-full"
      title={
        <span data-testid="approval-card-title" className="wrap-anywhere">
          {card.title}
        </span>
      }
      body={
        card.context === null ? undefined : (
          <span data-testid="approval-card-context" className="whitespace-pre-wrap wrap-anywhere">
            {card.context}
          </span>
        )
      }
      footer={footer}
      actions={
        actions.length === 0
          ? undefined
          : actions
              .map((action, index) => (
                <Button
                  key={action.testId}
                  type="button"
                  size="sm"
                  variant={variantAt(index, actions.length)}
                  className={ACTION_BUTTON_CLS}
                  disabled={busy === null ? disabled : busy !== action.testId}
                  aria-disabled={busy === action.testId || undefined}
                  aria-busy={busy === action.testId || undefined}
                  data-testid={action.testId}
                  onClick={busy === null ? action.onClick : undefined}
                >
                  {busy === action.testId && <RingSpinner data-icon="inline-start" />}
                  {action.label}
                </Button>
              ))
              .reverse()
      }
    >
      {card.preview !== null && (
        <Preview value={card.preview} mono={card.mono} allowFold={card.kind !== 'shell'} />
      )}
      {children}
      <Disclosure open={raw}>
        <RawArguments fields={card.details} />
      </Disclosure>
      {problem !== null && (
        <p
          role="alert"
          data-testid="approval-card-problem"
          className="m-0 mt-2 text-meta text-destructive"
        >
          {problem}
        </p>
      )}
    </NoticeBanner>
  );
}

export function ApprovalHistoryLine({
  card,
  status,
  icon,
  testId = 'approval-history',
  outcome,
}: {
  card: ApprovalCardModel;
  status: string;
  icon: ReactNode;
  testId?: string;
  outcome?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const text = `${status} · ${card.title}`;
  return (
    <div
      data-testid={testId}
      data-slot="approval-history"
      data-outcome={outcome}
      className="flex w-full min-w-0 flex-col"
    >
      <p className="m-0 flex min-w-0 items-center gap-1.5 text-meta text-content-secondary">
        <span aria-hidden className="flex size-4 flex-none items-center justify-center">
          {icon}
        </span>
        <span data-testid="approval-history-text" title={text} className="min-w-0 truncate">
          {text}
        </span>
        <Button
          type="button"
          variant="link"
          data-testid="approval-history-toggle"
          aria-expanded={open}
          className={cn(INLINE_LINK_CLS, 'flex-none')}
          onClick={() => setOpen(!open)}
        >
          {open ? t('收起') : t('详情')}
        </Button>
      </p>
      <Disclosure open={open} contentClassName="pt-2">
        <ApprovalCard card={card} />
      </Disclosure>
    </div>
  );
}
