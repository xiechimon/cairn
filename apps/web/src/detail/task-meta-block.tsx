import type { ReactNode } from 'react';
import { relativeTime } from '../board/rel-time.js';
import { useI18n } from '../i18n/provider.js';

export interface TaskMetaFields {
  sourceIssue: { number: number; title: string; url: string } | null;
  branch: string | null;
  pr: { number: number; url: string } | null;
  machine: string | null;
  machineWaiting: boolean;
  model: string | null;
  createdAt: number | null;
}

function Row({ label, first, children }: { label: string; first?: boolean; children: ReactNode }) {
  return (
    <div className={`flex items-baseline text-meta leading-5${first === true ? '' : ' mt-4'}`}>
      <span className="w-17 flex-none text-(--text-tertiary)">{label}</span>
      <span className="min-w-0 flex-1 text-(--text-secondary) [overflow-wrap:anywhere]">
        {children}
      </span>
    </div>
  );
}

export function TaskMetaBlock({ meta, now }: { meta: TaskMetaFields; now: number }) {
  const { t } = useI18n();
  const rows: Array<{ label: string; content: ReactNode }> = [];
  if (meta.sourceIssue != null) {
    rows.push({
      label: t('来源 issue'),
      content: (
        <a
          className="text-(--chip-plan-fg) no-underline hover:underline"
          href={meta.sourceIssue.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          #{meta.sourceIssue.number} {meta.sourceIssue.title}
        </a>
      ),
    });
  }
  if (meta.branch != null || meta.pr != null) {
    rows.push({
      label: t('分支 / PR'),
      content: (
        <>
          {meta.branch != null && <code className="font-mono text-caption">{meta.branch}</code>}
          {meta.pr != null && (
            <a
              className={`text-(--chip-plan-fg) no-underline hover:underline${
                meta.branch != null ? ' ml-2' : ''
              }`}
              href={meta.pr.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              #{meta.pr.number}
            </a>
          )}
        </>
      ),
    });
  }
  if (meta.machine != null) {
    rows.push({
      label: t('机器'),
      content: (
        <>
          {meta.machine}
          {meta.machineWaiting && (
            <span className="text-(--text-tertiary)">{t('（等待机器上线）')}</span>
          )}
        </>
      ),
    });
  }
  if (meta.model != null) {
    rows.push({
      label: t('模型'),
      content: <code className="font-mono text-caption">{meta.model}</code>,
    });
  }
  if (meta.createdAt != null) {
    rows.push({ label: t('创建时间'), content: relativeTime(meta.createdAt, now, t) });
  }
  return (
    <div data-testid="task-meta">
      {rows.map((row, i) => (
        <Row key={row.label} label={row.label} first={i === 0}>
          {row.content}
        </Row>
      ))}
      <div className="mt-6 text-meta text-(--text-tertiary)">{t('方案产出后显示于此')}</div>
    </div>
  );
}
