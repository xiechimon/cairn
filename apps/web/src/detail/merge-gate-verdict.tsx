import type { MergeReadiness } from '@cairn/shared';
import { StatusGlyph } from '../components/status-glyph.js';
import { useI18n } from '../i18n/provider.js';

export function MergeGateVerdict({ state }: { state: MergeReadiness }) {
  const { t } = useI18n();
  return (
    <section className="px-4 py-3" data-testid="merge-gate-verdict">
      <p className="m-0 flex items-center gap-2 text-ui">
        <StatusGlyph
          kind={state.ready ? 'done' : 'failed'}
          className={state.ready ? 'text-running' : 'text-destructive'}
        />
        <span className="text-content-tertiary">{t('合并闸')}</span>
        <span className={`font-medium ${state.ready ? 'text-running-text' : 'text-destructive'}`}>
          {state.ready ? t('可以合并') : t('还不能合并')}
        </span>
      </p>
      {state.blockers.length > 0 && (
        <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0 pl-5.5">
          {state.blockers.map((blocker) => (
            <li
              key={blocker.code}
              data-code={blocker.code}
              className="relative text-meta leading-5 text-content-secondary before:absolute before:top-2 before:-left-3 before:size-1 before:rounded-full before:bg-content-tertiary"
            >
              {blocker.label}
              {blocker.detail.length > 0 && (
                <span className="block text-content-tertiary">{blocker.detail.join(' · ')}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
