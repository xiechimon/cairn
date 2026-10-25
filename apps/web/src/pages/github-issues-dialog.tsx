import type { GithubIssueState, TodoRecord } from '@cairn/shared';
import { useEffect, useState } from 'react';
import { useApiMutations, useGithubIssues } from '../api/hooks.js';
import { Button } from '../components/ui/button.js';
import { DIALOG_TEXT_BUTTON, DialogShell } from '../components/ui/dialog-shell.js';
import { TagChip } from '../components/ui/tag-chip.js';
import { useI18n } from '../i18n/provider.js';

const STATE_FILTERS: { id: GithubIssueState; label: string }[] = [
  { id: 'open', label: '打开' },
  { id: 'closed', label: '已关闭' },
  { id: 'all', label: '全部' },
];

interface GithubIssuesDialogProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  teamId: string | undefined;
  onImported: (record: TodoRecord) => void;
}

export function GithubIssuesDialog({
  open,
  onClose,
  projectId,
  teamId,
  onImported,
}: GithubIssuesDialogProps) {
  const { t } = useI18n();
  const [state, setState] = useState<GithubIssueState>('open');
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) setError(null);
  }, [open]);
  const issuesQ = useGithubIssues(projectId, state, page, open);
  const mutations = useApiMutations(teamId);
  const data = issuesQ.data;
  const pending = mutations.importGithubIssue.isPending;
  const importIssue = (issueNumber: number) => {
    setError(null);
    mutations.importGithubIssue.mutate(
      { projectId, number: issueNumber },
      {
        onSuccess: (record) => onImported(record),
        onError: (err) => setError(err instanceof Error ? err.message : String(err)),
      },
    );
  };
  return (
    <DialogShell
      open={open}
      onClose={onClose}
      title={t('从 GitHub issue 建任务')}
      size="l"
      hint={<span className="tabular-nums">{t('第 {page} 页', { page })}</span>}
      footer={
        <>
          <Button
            variant="ghost"
            className={DIALOG_TEXT_BUTTON}
            disabled={page <= 1 || pending}
            onClick={() => setPage((p) => p - 1)}
          >
            {t('上一页')}
          </Button>
          <Button
            variant="ghost"
            className={DIALOG_TEXT_BUTTON}
            disabled={data?.hasMore !== true || pending}
            onClick={() => setPage((p) => p + 1)}
          >
            {t('下一页')}
          </Button>
        </>
      }
    >
      <div className="flex gap-2">
        {STATE_FILTERS.map((filter) => (
          <Button
            key={filter.id}
            variant={state === filter.id ? 'secondary' : 'outline'}
            aria-pressed={state === filter.id}
            onClick={() => {
              setState(filter.id);
              setPage(1);
            }}
          >
            {t(filter.label)}
          </Button>
        ))}
      </div>
      {issuesQ.isError ? (
        <div className="py-6 text-center text-ui text-content-tertiary">
          {t('issue 列表加载失败')}
        </div>
      ) : data === undefined ? (
        <div className="py-6 text-center text-ui text-content-tertiary">{t('加载中…')}</div>
      ) : data.issues.length === 0 ? (
        <div className="py-6 text-center text-ui text-content-tertiary">
          {t('这个状态下没有 issue')}
        </div>
      ) : (
        <div className="flex max-h-80 flex-col overflow-y-auto">
          {data.issues.map((issue) => (
            <Button
              key={issue.number}
              variant="ghost"
              className="h-auto w-full cursor-pointer items-baseline justify-start gap-1.5 rounded-lg p-2 text-left font-normal whitespace-normal"
              disabled={pending}
              onClick={() => importIssue(issue.number)}
            >
              <span className="flex-none text-meta text-content-tertiary tabular-nums">
                #{issue.number}
              </span>
              <span className="min-w-0 text-ui text-foreground [overflow-wrap:anywhere]">
                {issue.title}
              </span>
              {issue.labels.length > 0 && (
                <span className="flex w-full flex-wrap gap-1">
                  {issue.labels.map((label) => (
                    <TagChip
                      key={label.name}
                      tag={{ id: label.name, name: label.name, color: label.color }}
                    />
                  ))}
                </span>
              )}
            </Button>
          ))}
        </div>
      )}
      {error !== null && <div className="text-meta text-destructive">{error}</div>}
    </DialogShell>
  );
}
