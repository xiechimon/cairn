import { cn } from 'cn';
import type { ReactNode } from 'react';
import { useBuild } from '../api/hooks.js';
import { NO_PRICE_REASON } from '../api/mappers.js';
import { Badge } from '../components/ui/badge.js';
import { Label } from '../components/ui/label.js';
import type { BuildOverlayContent, PaneView, RunHistoryRow } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { BarChart3, Check, Download, History, X } from '../icons/index.js';
import { type DocTypeLabel, PaneTypeSelect } from '../overlay/plan-dropdown.js';
import { BranchSyncFields, READONLY_BOX, SyncButton, useBranchSyncState } from './branch-dialog.js';
import { PANE_HEAD } from './docpane.js';

interface PaneSelectProps {
  view: PaneView;
  docLabel: DocTypeLabel;
  sections: boolean;
  onView: (view: PaneView) => void;
}

function SectionHead({ icon, select }: { icon: ReactNode; select: PaneSelectProps }) {
  return (
    <header className={PANE_HEAD}>
      {icon}
      <PaneTypeSelect
        view={select.view}
        docLabel={select.docLabel}
        sections={select.sections}
        onView={select.onView}
      />
    </header>
  );
}

function RunGlyph({ status }: { status: RunHistoryRow['status'] }) {
  if (status === 'current')
    return <span className="ml-px size-3 flex-none rounded-full border-[1.5px] border-(--input)" />;
  if (status === 'failed' || status === 'failed-current')
    return <X width={14} height={14} className="ml-px size-3.5 flex-none text-(--destructive)" />;
  return <Check width={14} height={14} className="ml-px size-3.5 flex-none text-(--badge-done)" />;
}

function TokenSection({
  content,
  select,
}: {
  content: BuildOverlayContent;
  select: PaneSelectProps;
}) {
  const { t } = useI18n();
  const stats = content.token;
  const rows: Array<[string, string]> = [
    ['输入', stats.input],
    ['输出', stats.output],
    ['缓存读取', stats.cacheRead],
    ['缓存写入', stats.cacheWrite],
    ['缓存命中率', stats.cacheHitRate],
  ];
  const costRows: Array<[string, string, string]> = stats.cost
    ? [
        ['缓存读取', stats.cost.cacheRead, 'cost-cache-read'],
        ['输入（含缓存写入）', stats.cost.input, 'cost-input'],
        ['输出', stats.cost.output, 'cost-output'],
      ]
    : [];
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <SectionHead icon={<BarChart3 width={14} height={14} />} select={select} />
      <div className="pane-section-body min-h-0 flex-1 overflow-y-auto">
        <div className="flex h-15 items-baseline justify-between border-b border-b-(--border) px-4">
          <span className="text-page font-semibold tabular-nums text-(--foreground)">
            {stats.total}
          </span>
          <span className="text-meta text-(--text-tertiary)">tokens</span>
        </div>
        <div className="flex h-10 items-center justify-between border-b border-b-(--border) px-4 font-mono text-meta">
          <span className="text-(--text-secondary)">{stats.model}</span>
          <span className="text-(--text-tertiary)">{stats.modelTotal}</span>
        </div>
        <div>
          {rows.map(([label, value]) => (
            <div key={label} className="flex h-7 items-center justify-between px-4 text-meta">
              <span className="text-(--text-tertiary)">{t(label)}</span>
              <span className="text-(--foreground)">{value}</span>
            </div>
          ))}
        </div>
        {stats.cost !== undefined && (
          <fieldset
            aria-label={t('花费')}
            className="m-0 mt-2 min-w-0 border-0 border-t border-t-(--border) p-0 pt-2"
          >
            <div className="flex h-7 items-center justify-between px-4 text-meta">
              <span className="text-(--text-tertiary)">{t('花费')}</span>
              <span
                data-testid="cost-total"
                title={stats.cost === null ? t(NO_PRICE_REASON) : undefined}
                className="font-semibold tabular-nums text-(--foreground)"
              >
                {stats.cost === null ? '—' : stats.cost.total}
              </span>
            </div>
            {stats.cost === null && (
              <p className="px-4 pb-2 text-meta text-(--text-tertiary)">{t(NO_PRICE_REASON)}</p>
            )}
            {costRows.map(([label, value, testId]) => (
              <div key={testId} className="flex h-7 items-center justify-between px-4 text-meta">
                <span className="text-(--text-tertiary)">{t(label)}</span>
                <span data-testid={testId} className="tabular-nums text-(--foreground)">
                  {value}
                </span>
              </div>
            ))}
          </fieldset>
        )}
      </div>
    </section>
  );
}

function HistorySection({
  content,
  select,
}: {
  content: BuildOverlayContent;
  select: PaneSelectProps;
}) {
  const { t } = useI18n();
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <SectionHead icon={<History width={14} height={14} />} select={select} />
      <div className="pane-section-body min-h-0 flex-1 overflow-y-auto">
        <div className="px-4 pt-6 pb-6">
          {content.runs.map((run, index) => (
            <div
              key={run.label}
              data-testid="history-row"
              className={cn(
                'flex items-center gap-3',
                index > 0 && 'mt-2 border-t border-t-(--border) pt-2',
              )}
            >
              <RunGlyph status={run.status} />
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-ui text-(--foreground)">{t(run.label)}</span>
                  {(run.status === 'current' || run.status === 'failed-current') && (
                    <Badge variant="secondary" className="font-normal text-(--text-tertiary)">
                      {t('当前')}
                    </Badge>
                  )}
                </div>
                <div className="h-4 text-meta text-(--text-tertiary)">{t(run.meta)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function BranchSection({
  content,
  buildId,
  select,
}: {
  content: BuildOverlayContent;
  buildId: string | null;
  select: PaneSelectProps;
}) {
  const { t } = useI18n();
  const info = content.branch;
  const sync = useBranchSyncState(info, buildId);
  const buildQ = useBuild(buildId, buildId != null);
  const pr = buildQ.data?.prUrl ?? null;
  const prNumber = buildQ.data?.prNumber ?? null;
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <SectionHead icon={<Download width={14} height={14} />} select={select} />
      <div className="pane-section-body min-h-0 flex-1 overflow-y-auto">
        <div className="p-4">
          <BranchSyncFields
            info={info}
            canSync={sync.canSync}
            machines={sync.machines}
            selectedMachineId={sync.selectedMachineId}
            onMachineId={sync.onMachineId}
            directory={sync.directory}
            onDirectory={sync.onDirectory}
            force={sync.force}
            onForce={sync.onForce}
            buildId={buildId}
          />
          <div className="mt-4 flex flex-col gap-2">
            <Label>Pull Request</Label>
            {pr !== null && prNumber != null ? (
              <a
                className={cn(READONLY_BOX, 'text-(--accent) underline')}
                href={pr}
                target="_blank"
                rel="noopener noreferrer"
              >
                #{prNumber}
              </a>
            ) : (
              <div className={READONLY_BOX}>{t('未创建')}</div>
            )}
          </div>
          <div className="mt-4">
            <SyncButton
              buildId={buildId}
              canSync={sync.canSync}
              machineId={sync.selectedMachineId}
              directory={sync.directory}
              refName={info.branch}
              commit={info.commit}
              force={sync.force}
              disabled={sync.selectedMachineId === null || sync.directory.trim() === ''}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

interface RightPaneProps extends Omit<PaneSelectProps, 'sections'> {
  content: BuildOverlayContent | null;
  buildId: string | null;
  children?: ReactNode;
}

export function RightPane({ view, docLabel, onView, content, buildId, children }: RightPaneProps) {
  const select = (active: PaneView): PaneSelectProps => ({
    view: active,
    docLabel,
    sections: content != null,
    onView,
  });
  return (
    <aside
      className="detail-right flex w-(--detail-pane-right) min-h-0 flex-none flex-col border-l border-(--border) max-[816px]:hidden"
      data-testid="detail-right"
    >
      {content == null || view === 'doc' ? (
        children
      ) : view === 'branch' ? (
        <BranchSection content={content} buildId={buildId} select={select('branch')} />
      ) : view === 'token' ? (
        <TokenSection content={content} select={select('token')} />
      ) : (
        <HistorySection content={content} select={select('history')} />
      )}
    </aside>
  );
}
