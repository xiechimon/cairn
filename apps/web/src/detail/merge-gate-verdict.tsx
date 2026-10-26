import type { MergeReadiness } from '@cairn/shared';
import { useI18n } from '../i18n/provider.js';

export function MergeGateVerdict({ state }: { state: MergeReadiness }) {
  const { t } = useI18n();
  return (
    <section className="border-b border-(--border) px-4 py-3" data-testid="merge-gate-verdict">
      <p className="text-meta text-(--text-secondary)">
        <span>{t('合并闸')}</span>
        <span className="ml-2">{state.ready ? t('可以合并') : t('还不能合并')}</span>
      </p>
      {state.blockers.map((blocker) => (
        <p key={blocker.code} className="mt-1 text-meta text-(--text-tertiary)">
          <span>{blocker.label}</span>
          <code className="ml-2 font-mono text-caption">{blocker.code}</code>
          {blocker.detail.length > 0 ? <span>{` ${blocker.detail.join(' ')}`}</span> : null}
        </p>
      ))}
    </section>
  );
}
