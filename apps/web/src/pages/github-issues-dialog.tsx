// 从 GitHub issue 建任务弹层（#446 / ADR 0005 读向）：项目页 issue 选择器——
// 状态过滤（打开/已关闭/全部）+ 分页（hasMore = server 依上游 Link 头判定）
// + 行点选即导入建任务。只读面：不在 GitHub 留任何痕迹（写向 = ADR 0006
// 另票）。数据面 = useGithubIssues / importGithubIssue（hooks 单源）；导入
// 成功由父面收弹层并导航任务详情（票面 e2e 真用户路径的落点）。
// 弹层家族律（#68 DialogShell 448 宽 + Esc/背板关闭）。#946：per-face 类
// （dlg-ghissues / prj-issues-*）退役——皮肤迁 token utility 等值，e2e 载体
// 迁语义位（role=dialog/menu、按钮文案、aria-pressed、文本）。

import type { GithubIssueState, TodoRecord } from '@pacman/shared';
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

/** 过滤 chip：registry Button 形态（outline 底座 / secondary 选中档，几何
 *  皮肤全归件默认 h-8），选中载体 aria-pressed（#910 裁定 3 状态断言归行为）。 */

interface GithubIssuesDialogProps {
  /** #73 retained-mount open flag（DialogShell 家族律）。 */
  open: boolean;
  onClose: () => void;
  projectId: string;
  teamId: string | undefined;
  /** 导入成功（201 全 record：标题/正文/多标签/来源两列已落）。 */
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
  // retained-mount 存活态：重开不带上一轮的导入错误（delete-project-confirm
  // 同律）。过滤/页码保留 = 重开续看上次位置。
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
        // 导入失败留在弹层内联呈现（server {error} 消息 verbatim，
        // project-new 错误面同律）；列表与已建任务不受影响。
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
            // 行：ghost 件默认形态（hover 涂底 = registry 可供性），只留布局
            // 位——justify-start = text-align:left 的 flex 等价位；
            // whitespace-normal 恢复标题双行换行（base whitespace-nowrap 会
            // 禁掉 wrap 面的 overflow-wrap）；h-auto 保内容高——base h-8 钉
            // 32px，双行行（60px）会溢出盒外。
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
