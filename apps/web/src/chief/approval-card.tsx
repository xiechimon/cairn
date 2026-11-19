import { cn } from 'cn';
import { Fragment, useState } from 'react';
import { Button } from '../components/ui/button.js';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../components/ui/collapsible.js';
import { REPLY_BUBBLE_CLS } from '../detail/chat-markdown.js';
import { useI18n } from '../i18n/provider.js';
import { ChevronRight } from '../icons/index.js';
import type { ApprovalCardModel, ApprovalField } from './approval-card-model.js';

export interface ApprovalAction {
  label: string;
  primary: boolean;
  testId: string;
  onClick: () => void;
}

export interface ApprovalCardProps {
  card: ApprovalCardModel;
  waiting: boolean;
  actions?: readonly ApprovalAction[];
  disabled?: boolean;
  problem?: string | null;
  testId?: string;
  outcome?: string;
}

const FOLD_LINES = 6;
const FOLD_CHARS = 360;
const ACTION_BUTTON_CLS = 'pointer-coarse:h-11 pointer-coarse:px-4';

function folds(value: string): boolean {
  return value.split('\n').length > FOLD_LINES || value.length > FOLD_CHARS;
}

function FieldValue({ field }: { field: ApprovalField }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const foldable = folds(field.value);
  const text = (
    <span
      data-testid="approval-field-value"
      className={cn(
        'block whitespace-pre-wrap wrap-anywhere',
        field.mono === true && 'font-mono text-code',
        foldable && !open && 'line-clamp-6',
      )}
    >
      {field.value}
    </span>
  );
  if (!foldable) return text;
  return (
    <>
      {text}
      <Button
        type="button"
        variant="link"
        data-testid="approval-field-more"
        aria-expanded={open}
        className="h-auto min-h-6 p-0 text-meta font-normal text-content-secondary"
        onClick={() => setOpen(!open)}
      >
        {open ? t('收起') : t('展开全文')}
      </Button>
    </>
  );
}

function FieldRows({ fields, detail }: { fields: readonly ApprovalField[]; detail?: boolean }) {
  return (
    <dl
      className={cn(
        'm-0 grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1',
        detail === true ? 'text-meta text-content-secondary' : 'text-ui text-foreground',
      )}
    >
      {fields.map((field, index) => (
        <Fragment key={`${field.label}-${index}`}>
          <dt
            data-testid={detail === true ? 'approval-detail-label' : 'approval-field-label'}
            className="text-content-secondary"
          >
            {field.label}
          </dt>
          <dd className="m-0 min-w-0">
            {detail === true ? (
              <span className="block font-mono whitespace-pre-wrap wrap-anywhere">
                {field.value}
              </span>
            ) : (
              <FieldValue field={field} />
            )}
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}

export function ApprovalCard({
  card,
  waiting,
  actions = [],
  disabled = false,
  problem = null,
  testId = 'approval-card',
  outcome,
}: ApprovalCardProps) {
  const { t } = useI18n();
  return (
    <section
      data-testid={testId}
      data-slot="approval-card"
      data-outcome={outcome}
      aria-label={card.title}
      className={cn(REPLY_BUBBLE_CLS, 'flex min-w-0 flex-col gap-2 py-3')}
    >
      <p
        data-testid="approval-card-title"
        className="m-0 flex items-center gap-2 text-ui font-title text-foreground"
      >
        {waiting && (
          <span
            aria-hidden="true"
            data-slot="needs-you-dot"
            className="size-1.5 flex-none rounded-full bg-(--card-button)"
          />
        )}
        {card.title}
      </p>
      {card.summary !== null && (
        <p className="m-0 text-ui text-foreground whitespace-pre-wrap wrap-anywhere">
          {card.summary}
        </p>
      )}
      {card.fields.length > 0 && <FieldRows fields={card.fields} />}
      {card.details.length > 0 && (
        <Collapsible className="group/details">
          <CollapsibleTrigger
            data-testid="approval-details-toggle"
            className="-ml-1 flex min-h-6 cursor-pointer items-center gap-1 rounded-md px-1 text-meta text-content-secondary outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <ChevronRight
              aria-hidden
              className="size-4 flex-none transition-transform duration-(--dur-fast) group-data-open/details:rotate-90"
            />
            {t('详情')}
          </CollapsibleTrigger>
          <CollapsibleContent data-testid="approval-details" className="pt-1">
            <FieldRows fields={card.details} detail />
          </CollapsibleContent>
        </Collapsible>
      )}
      {card.note !== null && (
        <p data-testid="approval-card-note" className="m-0 text-meta text-content-secondary">
          {card.note}
        </p>
      )}
      {actions.length > 0 && (
        <div className="mt-1 flex flex-wrap items-center gap-3">
          {actions.map((action) => (
            <Button
              key={action.testId}
              type="button"
              size="sm"
              variant={action.primary ? 'default' : 'ghost'}
              className={ACTION_BUTTON_CLS}
              disabled={disabled}
              data-testid={action.testId}
              onClick={action.onClick}
            >
              {action.label}
            </Button>
          ))}
        </div>
      )}
      {problem !== null && (
        <p
          role="alert"
          data-testid="approval-card-problem"
          className="m-0 text-meta text-destructive"
        >
          {problem}
        </p>
      )}
    </section>
  );
}
