import { cn } from 'cn';
import { type ReactNode, useState } from 'react';
import {
  ACCOUNT_VENDORS,
  type AccountStep,
  type AccountVendor,
  type StickyThread,
  type SubscriptionAccount,
} from '../api/claude-accounts.js';
import {
  AccountRow,
  type AccountRowActions,
  AccountStepRow,
  StickyThreadRow,
  VendorSection,
} from '../components/accounts/account-parts.js';
import { ListCard } from '../components/list-card.js';
import { SETTINGS_ROW_CLS } from '../components/settings-list.js';
import { useI18n } from '../i18n/provider.js';

export interface SubscriptionAccountsProps {
  accounts: SubscriptionAccount[];
  stepsByAccount: Record<string, AccountStep[]>;
  stickiness: StickyThread[];
  now: number;
  actionsFor: (account: SubscriptionAccount) => AccountRowActions;
  statusFor?: (account: SubscriptionAccount) => ReactNode;
  onAdd: (vendor: AccountVendor) => void;
}

function EmptyLine({ children }: { children: ReactNode }) {
  return <div className={cn(SETTINGS_ROW_CLS, 'text-meta text-content-tertiary')}>{children}</div>;
}

function AccountDetail({
  steps,
  sticky,
  now,
}: {
  steps: AccountStep[];
  sticky: StickyThread[];
  now: number;
}) {
  const { t } = useI18n();
  return (
    <div
      data-testid="account-detail"
      className="grid gap-4 border-t border-border bg-background px-4 py-3 md:grid-cols-2"
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="text-caption font-medium text-content-tertiary">{t('最近步骤')}</span>
        <ListCard>
          {steps.length === 0 ? (
            <EmptyLine>{t('最近 24 小时没有步骤')}</EmptyLine>
          ) : (
            steps.map((step) => <AccountStepRow key={step.stepId} step={step} now={now} />)
          )}
        </ListCard>
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="text-caption font-medium text-content-tertiary">
          {t('固定账户的 thread')}
        </span>
        <ListCard>
          {sticky.length === 0 ? (
            <EmptyLine>{t('没有固定账户的 thread')}</EmptyLine>
          ) : (
            sticky.map((thread) => (
              <StickyThreadRow key={thread.threadId} thread={thread} now={now} />
            ))
          )}
        </ListCard>
      </div>
    </div>
  );
}

export function SubscriptionAccounts(props: SubscriptionAccountsProps) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div data-testid="subscription-accounts" className="flex flex-col gap-10">
      {ACCOUNT_VENDORS.map((vendor) => (
        <VendorSection
          key={vendor}
          vendor={vendor}
          accounts={props.accounts.filter((a) => a.vendor === vendor)}
          now={props.now}
          onAdd={() => props.onAdd(vendor)}
          renderRow={(account, index) => {
            const steps = props.stepsByAccount[account.id];
            const expanded = open === account.id;
            return (
              <div key={account.id} className="flex flex-col">
                <AccountRow
                  account={account}
                  index={index}
                  now={props.now}
                  actions={props.actionsFor(account)}
                  status={props.statusFor?.(account)}
                  expanded={expanded}
                  onToggleExpanded={
                    steps === undefined ? undefined : () => setOpen(expanded ? null : account.id)
                  }
                />
                {expanded && steps !== undefined && (
                  <AccountDetail
                    steps={steps}
                    sticky={props.stickiness.filter((s) => s.subscriptionId === account.id)}
                    now={props.now}
                  />
                )}
              </div>
            );
          }}
        />
      ))}
    </div>
  );
}
