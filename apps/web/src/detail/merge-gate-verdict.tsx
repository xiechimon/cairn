import type { MergeReadiness } from '@cairn/shared';
import { CircleCheck, CircleX, Minus } from 'lucide-react';
import { CODE_PILL_CLS } from '../components/code-pill.js';
import { useI18n } from '../i18n/provider.js';

export function MergeGateVerdict({ state }: { state: MergeReadiness }) {
  const { t } = useI18n();
  const Icon = state.ready ? CircleCheck : CircleX;
  return (
    <section className="border-b border-(--border) px-4 py-3" data-testid="merge-gate-verdict">
      <p className="m-0 flex items-center gap-2 text-ui">
        <Icon
          aria-hidden="true"
          className={`size-4 flex-none ${state.ready ? 'text-running-text' : 'text-destructive'}`}
        />
        <span className="text-content-tertiary">{t('合并闸')}</span>
        <span className={`font-medium ${state.ready ? 'text-running-text' : 'text-destructive'}`}>
          {state.ready ? t('可以合并') : t('还不能合并')}
        </span>
      </p>
      {state.blockers.length > 0 && (
        <ul className="m-0 mt-2 flex list-none flex-col gap-1.5 p-0 pl-6">
          {state.blockers.map((blocker) => (
            <li
              key={blocker.code}
              className="flex items-baseline gap-2 text-meta text-content-secondary"
            >
              <Minus
                aria-hidden="true"
                className="size-3 flex-none self-center text-content-tertiary"
              />
              <span>
                {blocker.label}
                {blocker.detail.length > 0 && (
                  <span className="text-content-tertiary">{` · ${blocker.detail.join(' ')}`}</span>
                )}
              </span>
              <code className={`ml-auto flex-none ${CODE_PILL_CLS} text-content-tertiary`}>
                {blocker.code}
              </code>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
