import { KeyRound } from 'lucide-react';
import { Link } from 'react-router';
import { NoticeBanner, withCodeSpans } from '../components/notice-banner.js';
import { Button } from '../components/ui/button.js';
import { useI18n } from '../i18n/provider.js';
import { settingsHref } from '../settings/settings-href.js';

export interface SubscriptionLoginWarning<Kind extends string = 'expired' | 'expiring'> {
  key: string;
  kind: Kind;
  text: string;
}

export function expiryWarningKind(expiresAt: number | null, now: number): 'expired' | 'expiring' {
  return expiresAt !== null && expiresAt <= now ? 'expired' : 'expiring';
}

export function SubscriptionLoginBanner<Kind extends string>({
  testIdPrefix,
  warnings,
  singleTitle,
  summary,
}: {
  testIdPrefix: string;
  warnings: readonly SubscriptionLoginWarning<Kind>[];
  singleTitle: string;
  summary: (warnings: readonly SubscriptionLoginWarning<Kind>[]) => { title: string; body: string };
}) {
  const { t } = useI18n();
  const [only] = warnings;
  if (only === undefined) return null;
  const action = (
    <Button
      variant="outline"
      size="sm"
      className="px-3"
      render={<Link to={settingsHref('routing')} />}
    >
      {t('查看')}
    </Button>
  );
  if (warnings.length === 1) {
    return (
      <NoticeBanner
        data-testid={`${testIdPrefix}-login-banner`}
        tone="warning"
        icon={KeyRound}
        className="mt-4"
        title={singleTitle}
        body={
          <span data-testid={`${testIdPrefix}-login-warning`} data-login={only.kind}>
            {withCodeSpans(only.text)}
          </span>
        }
        actions={action}
      />
    );
  }
  const { title, body } = summary(warnings);
  return (
    <NoticeBanner
      data-testid={`${testIdPrefix}-login-banner`}
      tone="warning"
      icon={KeyRound}
      className="mt-4"
      title={title}
      body={<span data-testid={`${testIdPrefix}-login-summary`}>{body}</span>}
      actions={action}
    />
  );
}
