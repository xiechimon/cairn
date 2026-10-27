import type { ScheduleGroup, ScheduleReport } from '@cairn/shared';
import { useState } from 'react';
import { useApiMutations, useProjectSchedule } from '../api/hooks.js';
import { SETTINGS_HINT_CLS, SettingsCard, SettingsRow } from '../components/settings-list.js';
import { Button } from '../components/ui/button.js';
import { Checkbox } from '../components/ui/checkbox.js';
import { DIALOG_PRIMARY_BUTTON } from '../components/ui/dialog-shell.js';
import { toastError } from '../components/ui/toaster.js';
import { useI18n } from '../i18n/provider.js';
import { canExecute, isActionable, scheduleSelection } from './schedule-card-model.js';

const GROUP_LABELS: Record<ScheduleGroup, string> = {
  now: '现在就能开',
  next: '排在这之后',
  later: '先放着',
  close: '建议关闭',
};

const GROUPS: readonly ScheduleGroup[] = ['now', 'next', 'later', 'close'];

export function ScheduleUnparsedDeps({ unparsedDeps }: Pick<ScheduleReport, 'unparsedDeps'>) {
  const { t } = useI18n();
  return (
    <SettingsRow label={t('读不懂的依赖')}>
      <ul className="m-0 flex list-none flex-col gap-1 p-0" data-testid="schedule-unparsed-deps">
        {unparsedDeps.map((dep, index) => (
          <li key={`${dep.issue}-${index}`} className="flex items-center gap-2">
            <span className="font-mono">#{dep.issue}</span>
            <span className={SETTINGS_HINT_CLS}>{dep.text}</span>
          </li>
        ))}
      </ul>
    </SettingsRow>
  );
}

export function ProjectScheduleCard({ projectId, teamId }: { projectId: string; teamId: string }) {
  const { t } = useI18n();
  const query = useProjectSchedule(projectId, true);
  const mutations = useApiMutations(teamId);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const report = query.data?.report ?? null;
  if (report === null) return null;
  return (
    <section className="flex flex-col gap-2" aria-label={t('总管排期')}>
      <h3 className="m-0 px-1 text-meta font-normal text-content-tertiary">{t('总管排期')}</h3>
      <SettingsCard>
        <SettingsRow label={t('报告时间')} hint={report.mainSha.slice(0, 7)}>
          <span className="font-mono">{new Date(report.generatedAt).toLocaleString()}</span>
        </SettingsRow>
        {GROUPS.map((group) => {
          const items = report.items.filter((item) => item.group === group);
          if (items.length === 0) return null;
          return (
            <SettingsRow key={group} label={t(GROUP_LABELS[group])}>
              <ul
                className="m-0 flex list-none flex-col gap-1 p-0"
                data-testid={`schedule-${group}`}
              >
                {items.map((item) => (
                  <li key={String(item.issue)} className="flex items-center gap-2">
                    {isActionable(item) ? (
                      <Checkbox
                        aria-label={`#${item.issue}`}
                        checked={selected.has(item.issue)}
                        disabled={report.appliedAt !== null}
                        onCheckedChange={() =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (next.has(item.issue)) next.delete(item.issue);
                            else next.add(item.issue);
                            return next;
                          })
                        }
                      />
                    ) : (
                      <span aria-hidden="true" className={SETTINGS_HINT_CLS}>
                        ·
                      </span>
                    )}
                    <span className="font-mono">#{item.issue}</span>
                    <span className="truncate">{item.title}</span>
                    <span className={SETTINGS_HINT_CLS}>{item.reason}</span>
                    {item.evidence.map((evidence) =>
                      evidence.url === null ? (
                        <span key={evidence.ref} className="font-mono text-meta">
                          {evidence.ref}
                        </span>
                      ) : (
                        <a
                          key={evidence.ref}
                          className="font-mono text-meta"
                          href={evidence.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {evidence.ref}
                        </a>
                      ),
                    )}
                  </li>
                ))}
              </ul>
            </SettingsRow>
          );
        })}
        {report.unparsedDeps.length > 0 ? (
          <ScheduleUnparsedDeps unparsedDeps={report.unparsedDeps} />
        ) : null}
        <SettingsRow label={t('确认后才会改 GitHub')}>
          <Button
            className={DIALOG_PRIMARY_BUTTON}
            aria-label={t('落实勾选的排期建议')}
            disabled={!canExecute(report, selected) || mutations.executeSchedule.isPending}
            onClick={() => {
              mutations.executeSchedule.mutate(
                { id: projectId, reportId: report.id, issues: scheduleSelection(report, selected) },
                {
                  onSuccess: (result) => {
                    setSelected(new Set());
                    if (result.skipped.length > 0) {
                      toastError(t('有建议没落地：票已变动，请等下一轮排期'), new Error('stale'));
                    }
                  },
                  onError: (error) => toastError(t('排期没落地，请重试'), error),
                },
              );
            }}
          >
            {t('落实勾选')}
          </Button>
        </SettingsRow>
      </SettingsCard>
    </section>
  );
}
