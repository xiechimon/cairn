import { cn } from 'cn';
import { type ReactNode, useState } from 'react';
import { useBuild } from '../api/hooks.js';
import { NO_PRICE_REASON } from '../api/mappers.js';
import { Badge } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import { Label } from '../components/ui/label.js';
import type { BuildOverlayContent, PaneView, RunHistoryRow } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { Check, TriangleDown, TriangleRight, X } from '../icons/index.js';
import { BranchSyncFields, READONLY_BOX, SyncButton, useBranchSyncState } from './branch-dialog.js';

function RunGlyph({ status }: { status: RunHistoryRow['status'] }) {
  if (status === 'current')
    return <span className="ml-px size-3 flex-none rounded-full border-[1.5px] border-(--input)" />;
  if (status === 'failed' || status === 'failed-current')
    return <X width={14} height={14} className="ml-px size-3.5 flex-none text-(--destructive)" />;
  return <Check width={14} height={14} className="ml-px size-3.5 flex-none text-(--badge-done)" />;
}

function parseTokens(text: string): number {
  const value = Number.parseFloat(text);
  if (Number.isNaN(value)) return 0;
  return text.endsWith('k') ? value * 1000 : value;
}

function SectionShell({
  testId,
  title,
  summary,
  open,
  onToggle,
  children,
}: {
  testId: string;
  title: string;
  summary?: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const bodyId = `pane-section-${testId}`;
  return (
    <section data-testid={`pane-section-${testId}`} className="mx-3.5 border-t border-(--border)">
      <Button
        variant="ghost"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={onToggle}
        className="h-8 w-full justify-start gap-1 px-0 text-meta font-medium text-(--text-tertiary) hover:bg-transparent hover:text-(--foreground) aria-expanded:bg-transparent aria-expanded:text-(--text-tertiary) aria-expanded:hover:text-(--foreground)"
      >
        {open ? <TriangleDown width={10} height={10} /> : <TriangleRight width={10} height={10} />}
        {title}
        {summary !== undefined && (
          <span className="ml-auto font-normal tabular-nums text-(--text-secondary)">
            {summary}
          </span>
        )}
      </Button>
      {open && (
        <div id={bodyId} className="pb-3.5">
          {children}
        </div>
      )}
    </section>
  );
}

function UsageBody({ content }: { content: BuildOverlayContent }) {
  const { t } = useI18n();
  const stats = content.token;
  const legend: Array<{ label: string; value: string; tile: number }> = [
    { label: '输入', value: stats.input, tile: 5 },
    { label: '输出', value: stats.output, tile: 2 },
    { label: '缓存读取', value: stats.cacheRead, tile: 3 },
    { label: '缓存写入', value: stats.cacheWrite, tile: 1 },
  ];
  const costRows: Array<[string, string, string]> = stats.cost
    ? [
        ['缓存读取', stats.cost.cacheRead, 'cost-cache-read'],
        ['输入（含缓存写入）', stats.cost.input, 'cost-input'],
        ['输出', stats.cost.output, 'cost-output'],
      ]
    : [];
  return (
    <div className="text-meta">
      <div
        aria-hidden="true"
        className="my-2 flex h-1.5 gap-px overflow-hidden rounded-full bg-(--secondary)"
      >
        {legend.map((row) => (
          <i
            key={row.label}
            className="block h-full"
            style={{
              flexGrow: parseTokens(row.value),
              flexBasis: 0,
              background: `var(--project-tile-${row.tile})`,
            }}
          />
        ))}
      </div>
      <div className="mt-2.5 grid grid-cols-[8px_1fr_auto] items-center gap-x-2 gap-y-1.5">
        {legend.map((row) => (
          <div key={row.label} className="contents">
            <i
              aria-hidden="true"
              className="size-2 rounded-xs"
              style={{ background: `var(--project-tile-${row.tile})` }}
            />
            <span className="text-(--text-secondary)">{t(row.label)}</span>
            <span className="text-right tabular-nums text-(--foreground)">{row.value}</span>
          </div>
        ))}
      </div>
      <div className="mt-2.5 flex items-center justify-between">
        <span className="text-(--text-tertiary)">{t('缓存命中率')}</span>
        <span className="tabular-nums text-(--foreground)">{stats.cacheHitRate}</span>
      </div>
      <div className="mt-1.5 flex items-center justify-between font-mono">
        <span className="text-(--text-secondary)">{stats.model}</span>
        <span className="text-(--text-tertiary)">{stats.modelTotal} tokens</span>
      </div>
      {stats.cost !== undefined && (
        <fieldset
          aria-label={t('花费')}
          className="m-0 mt-2.5 min-w-0 border-0 border-t border-t-(--border) p-0 pt-2"
        >
          <div className="flex h-6 items-center justify-between">
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
            <p className="pb-1 text-(--text-tertiary)">{t(NO_PRICE_REASON)}</p>
          )}
          {costRows.map(([label, value, testId]) => (
            <div key={testId} className="flex h-6 items-center justify-between">
              <span className="text-(--text-tertiary)">{t(label)}</span>
              <span data-testid={testId} className="tabular-nums text-(--foreground)">
                {value}
              </span>
            </div>
          ))}
        </fieldset>
      )}
    </div>
  );
}

function HistoryBody({ content }: { content: BuildOverlayContent }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-2.5">
      {content.runs.map((run) => (
        <div key={run.label} data-testid="history-row" className="flex items-center gap-3">
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
  );
}

function BranchBody({
  content,
  buildId,
}: {
  content: BuildOverlayContent;
  buildId: string | null;
}) {
  const { t } = useI18n();
  const info = content.branch;
  const sync = useBranchSyncState(info, buildId);
  const buildQ = useBuild(buildId, buildId != null);
  const pr = buildQ.data?.prUrl ?? null;
  const prNumber = buildQ.data?.prNumber ?? null;
  return (
    <div>
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
  );
}

type SectionKey = 'branch' | 'token' | 'history';

export function PaneSections({
  content,
  buildId,
  initialView,
}: {
  content: BuildOverlayContent;
  buildId: string | null;
  initialView?: PaneView;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState<Record<SectionKey, boolean>>({
    branch: true,
    token: true,
    history: initialView === 'history',
  });
  const toggle = (key: SectionKey) => setOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  const stats = content.token;
  const usageSummary =
    stats.cost != null ? `${stats.total} · ${stats.cost.total}` : `${stats.total}`;
  return (
    <div data-testid="pane-sections">
      <SectionShell
        testId="branch"
        title={t('分支')}
        open={open.branch}
        onToggle={() => toggle('branch')}
      >
        <BranchBody content={content} buildId={buildId} />
      </SectionShell>
      <SectionShell
        testId="token"
        title={t('用量')}
        summary={usageSummary}
        open={open.token}
        onToggle={() => toggle('token')}
      >
        <UsageBody content={content} />
      </SectionShell>
      <SectionShell
        testId="history"
        title={t('历史')}
        summary={t('{n} 次运行', { n: content.runs.length })}
        open={open.history}
        onToggle={() => toggle('history')}
      >
        <HistoryBody content={content} />
      </SectionShell>
    </div>
  );
}

export function RightPane({ children }: { children: ReactNode }) {
  return (
    <aside
      className="detail-right flex w-(--detail-pane-right) min-h-0 flex-none flex-col border-l border-(--border) bg-(--background) max-[816px]:hidden"
      data-testid="detail-right"
    >
      {children}
    </aside>
  );
}
