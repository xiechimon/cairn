import type { PrPanelRow } from '@cairn/shared';
import { cn } from 'cn';
import { Ellipsis, GitMerge, GitPullRequest, GitPullRequestClosed } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '../../i18n/provider.js';
import { Button } from '../ui/button.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu.js';
import { toastSuccess } from '../ui/toaster.js';
import { prChecksText } from './pr-panel-model.js';

const VISIBLE_ROWS = 5;

function Glyph({ state }: { state: PrPanelRow['state'] }) {
  const Icon =
    state === 'merged' ? GitMerge : state === 'closed' ? GitPullRequestClosed : GitPullRequest;
  return (
    <Icon
      aria-hidden
      strokeWidth={1.75}
      className={cn(
        'mt-0.75 size-3.5 flex-none',
        state === 'open' ? 'text-running-text' : 'text-content-tertiary',
      )}
    />
  );
}

function CheckCount({ checks }: { checks: PrPanelRow['checks'] }) {
  const { t } = useI18n();
  const text = prChecksText(checks);
  if (text === null) return null;
  const failed = checks.failed > 0;
  const running = checks.running > 0;
  return (
    <span
      data-slot="pr-checks"
      data-ci={failed ? 'failed' : running ? 'running' : 'passed'}
      title={t('检查通过 {passed} / {total}', { passed: checks.passed, total: checks.total })}
      className="inline-flex flex-none items-center gap-1 text-meta text-content-tertiary tabular-nums"
    >
      <span
        aria-hidden
        className={cn(
          'size-1.5 rounded-full',
          failed ? 'bg-destructive' : running ? 'bg-running' : 'bg-content-tertiary',
        )}
      />
      {text}
    </span>
  );
}

function RowMenu({
  row,
  onViewChanges,
}: {
  row: PrPanelRow;
  onViewChanges: (row: PrPanelRow) => void;
}) {
  const { t } = useI18n();
  const label = t('PR #{n} 的菜单', { n: row.number });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon-xs" className="size-6" aria-label={label} />}
      >
        <Ellipsis />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="end" sideOffset={4} className="w-auto min-w-44">
        <DropdownMenuItem
          render={<a href={row.url} target="_blank" rel="noreferrer" />}
          nativeButton={false}
        >
          {t('在 GitHub 打开')}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            void navigator.clipboard?.writeText(row.url);
            toastSuccess(t('已复制链接'));
          }}
        >
          {t('复制链接')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => onViewChanges(row)}>{t('查看变更')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export interface PrListProps {
  rows: readonly PrPanelRow[];
  onOpenThread: (threadId: string) => void;
  onViewChanges: (row: PrPanelRow) => void;
}

export function PrList({ rows, onOpenThread, onViewChanges }: PrListProps) {
  const { t } = useI18n();
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, VISIBLE_ROWS);
  return (
    <div data-slot="pr-list" className="flex flex-col">
      {shown.map((row) => (
        <div
          key={row.buildId}
          data-slot="pr-list-row"
          data-state={row.state}
          className="group/row relative flex items-start gap-2.5 rounded-(--radius-control) py-1.75 pr-2 pl-2.5 hover:bg-(--menu-hover)"
        >
          <Glyph state={row.state} />
          <Button
            variant="ghost"
            onClick={() => onOpenThread(row.threadId)}
            className="h-auto min-w-0 flex-1 flex-col items-stretch gap-0.5 p-0 text-left font-normal hover:bg-transparent dark:hover:bg-transparent"
          >
            <span className="truncate text-ui text-foreground">{row.title}</span>
            <span className="flex min-w-0 items-center gap-2 text-meta text-content-tertiary">
              <span className="truncate tabular-nums">
                {row.repo.split('/').at(-1)} #{row.number}
              </span>
              <span className="text-(--diff-add-fg) tabular-nums">+{row.additions}</span>
              <span className="text-destructive tabular-nums">−{row.deletions}</span>
              <span className="ml-auto">
                <CheckCount checks={row.checks} />
              </span>
            </span>
          </Button>
          <RowMenu row={row} onViewChanges={onViewChanges} />
        </div>
      ))}
      {rows.length > VISIBLE_ROWS && (
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={all}
          onClick={() => setAll(!all)}
          className="mt-1 self-start text-meta text-content-secondary"
        >
          {all ? t('收起') : t('显示更多')}
        </Button>
      )}
    </div>
  );
}
