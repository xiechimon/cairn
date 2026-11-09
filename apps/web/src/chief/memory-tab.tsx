import { MEMORY_QUOTA_PER_TEAM, type MemoryRecord } from '@cairn/shared';
import { cn } from 'cn';
import { useRef, useState } from 'react';
import { useConnected } from '../api/connection-state.js';
import { useApiMutations, useMemories, useProjects } from '../api/hooks.js';
import { EmptyState } from '../components/empty-state.js';
import { AlertDialogActions, AlertDialogShell } from '../components/ui/alert-dialog-shell.js';
import { Button } from '../components/ui/button.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import { Skeleton } from '../components/ui/skeleton.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';
import { FileText } from '../icons/index.js';
import {
  groupMemories,
  isAutoInjected,
  type MemoryGroup,
  splitMemoryContent,
} from './memory-list.js';

const ROW_GRID_CLS =
  'grid w-full grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-0.5 sm:grid-cols-[11rem_minmax(0,1fr)_auto]';

const updatedOn = (at: number, t: TFunc) => {
  const date = new Date(at);
  return t('{mo}月{d}日', {
    mo: date.getMonth() + 1,
    d: date.getDate(),
    monthShort: date.toLocaleString('en', { month: 'short' }),
  });
};

function groupHeading(group: MemoryGroup, t: TFunc) {
  if (group.scope === 'team') return t('团队');
  return group.projectName ?? t('已移除的项目');
}

export function MemoryTab({ live, teamId }: { live: boolean; teamId: string | undefined }) {
  const { t } = useI18n();
  const connected = useConnected();
  const memoriesQ = useMemories(teamId, live);
  const projectsQ = useProjects(teamId, live);
  const mutations = useApiMutations(teamId);
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const detailBodyRef = useRef<HTMLDListElement>(null);
  const memories = memoriesQ.data ?? [];
  const open = memories.find((memory) => memory.id === openId) ?? null;
  const deleting = mutations.deleteMemory;

  const scopeLabel = (memory: MemoryRecord) =>
    memory.projectId === null
      ? t('团队')
      : (projectsQ.data?.find((project) => project.id === memory.projectId)?.name ??
        t('已移除的项目'));
  const layerLabel = (memory: MemoryRecord) =>
    isAutoInjected(memory.layer) ? t('核心') : t('可检索 · 不自动注入');

  const startDelete = () => {
    deleting.reset();
    setConfirming(true);
  };
  const confirmDelete = () => {
    if (open === null) return;
    deleting.mutate(
      { memoryId: open.id },
      {
        onSuccess: () => {
          setConfirming(false);
          setOpenId(null);
          requestAnimationFrame(() =>
            listRef.current?.querySelector<HTMLElement>('[data-slot="memory-row"]')?.focus(),
          );
        },
      },
    );
  };

  const body = (() => {
    if (
      live &&
      ((memoriesQ.data === undefined && memoriesQ.isError) ||
        (projectsQ.data === undefined && projectsQ.isError))
    ) {
      return (
        <div role="alert" className="mt-2 flex items-center gap-3 border-y border-border py-3">
          <p className="min-w-0 flex-1 text-ui text-foreground">
            {t('记忆没有加载出来，请重试。')}
          </p>
          <Button
            variant="outline"
            disabled={memoriesQ.isFetching || projectsQ.isFetching}
            onClick={() => void Promise.all([memoriesQ.refetch(), projectsQ.refetch()])}
          >
            {t('重试')}
          </Button>
        </div>
      );
    }
    if (live && (memoriesQ.data === undefined || projectsQ.data === undefined)) {
      return (
        <div role="status" aria-label={t('正在加载记忆')} className="mt-2">
          <Skeleton className="mx-3 mt-4 mb-2 h-4 w-12" />
          {[0, 1, 2].map((key) => (
            <div key={key} className={cn(ROW_GRID_CLS, 'border-b border-border px-3 py-3')}>
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-full max-sm:hidden" />
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      );
    }
    if (memories.length === 0) {
      return (
        <EmptyState
          className="mt-8"
          icon={FileText}
          title={t('尚无记忆。')}
          description={t('Coordinator 会在工作中将值得沉淀的经验存入此处。')}
        />
      );
    }
    return (
      <div ref={listRef} data-testid="memory-list" className="mt-2">
        {groupMemories(memories, projectsQ.data ?? []).map((group) => (
          <section key={group.key} aria-labelledby={`memory-group-${group.key}`}>
            <h2
              id={`memory-group-${group.key}`}
              className="flex items-baseline gap-2 px-3 pt-4 pb-1 text-meta font-medium text-content-secondary"
            >
              {groupHeading(group, t)}
              {group.scope !== 'team' && (
                <span className="font-normal text-content-tertiary">{t('项目')}</span>
              )}
            </h2>
            <ul className="border-t border-border">
              {group.rows.map((memory) => (
                <li key={memory.id} className="border-b border-border">
                  <Button
                    variant="ghost"
                    data-slot="memory-row"
                    aria-label={t('打开记忆：{title}', { title: memory.title })}
                    className="h-auto min-h-11 w-full justify-start rounded-none border-0 px-3 py-2.5 text-left text-ui font-normal whitespace-normal"
                    onClick={() => setOpenId(memory.id)}
                  >
                    <span className={ROW_GRID_CLS}>
                      <span
                        data-slot="memory-title"
                        className="col-start-1 row-start-1 flex min-w-0 items-baseline gap-2"
                      >
                        <span className="truncate text-foreground">{memory.title}</span>
                        {!isAutoInjected(memory.layer) && (
                          <span className="flex-none text-meta text-content-tertiary">
                            {t('可检索')}
                          </span>
                        )}
                      </span>
                      <span
                        data-slot="memory-summary"
                        className="col-span-2 row-start-2 truncate text-content-secondary sm:col-span-1 sm:col-start-2 sm:row-start-1"
                      >
                        {splitMemoryContent(memory.content).summary}
                      </span>
                      <span
                        data-slot="memory-date"
                        className="col-start-2 row-start-1 text-meta whitespace-nowrap text-content-tertiary sm:col-start-3"
                      >
                        {t('更新于 {date}', { date: updatedOn(memory.updatedAt, t) })}
                      </span>
                    </span>
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    );
  })();

  const content = open === null ? null : splitMemoryContent(open.content);
  return (
    <div>
      <p className="mt-4 text-meta text-content-tertiary">
        {memories.length > 0
          ? t('已存 {n} 条，上限 {max} 条 · 不是每条都会自动注入', {
              n: memories.length,
              max: MEMORY_QUOTA_PER_TEAM,
            })
          : t('记忆')}
      </p>
      {!connected && (
        <p className="mt-1 text-meta text-content-secondary">
          {t('离线中。记忆只能查看，重新连接后才能删除。')}
        </p>
      )}
      {body}
      <DialogShell
        open={open !== null && !confirming}
        title={open?.title ?? ''}
        subtitle={open === null ? undefined : `${scopeLabel(open)} · ${layerLabel(open)}`}
        initialFocus={detailBodyRef}
        onClose={() => setOpenId(null)}
        headerAction={
          live && connected ? (
            <Button variant="outline" size="sm" onClick={startDelete}>
              {t('删除…')}
            </Button>
          ) : undefined
        }
      >
        {open !== null && content !== null && (
          <dl ref={detailBodyRef} tabIndex={-1} className="space-y-4 outline-none">
            <div>
              <dt className="text-meta text-content-tertiary">{t('更新于')}</dt>
              <dd className="mt-0.5 text-ui">{updatedOn(open.updatedAt, t)}</dd>
            </div>
            <div>
              <dt className="text-meta text-content-tertiary">{t('概要')}</dt>
              <dd className="mt-0.5 text-ui break-words">{content.summary}</dd>
            </div>
            {content.details.length > 0 && (
              <div>
                <dt className="text-meta text-content-tertiary">{t('详情')}</dt>
                <dd className="mt-1">
                  <ul className="list-disc space-y-1 pl-5 text-ui break-words marker:text-content-tertiary">
                    {content.details.map((line, index) => (
                      <li key={`${index}-${line}`}>{line}</li>
                    ))}
                  </ul>
                </dd>
              </div>
            )}
          </dl>
        )}
      </DialogShell>
      <AlertDialogShell
        open={open !== null && confirming}
        title={t('删除这条记忆？')}
        ariaLabel={t('删除这条记忆')}
        onClose={() => {
          if (!deleting.isPending) setConfirming(false);
        }}
        footer={
          <AlertDialogActions
            cancelLabel={t('取消')}
            confirmLabel={deleting.isPending ? t('正在删除…') : t('删除记忆')}
            confirmDisabled={deleting.isPending}
            onCancel={() => setConfirming(false)}
            onConfirm={confirmDelete}
          />
        }
      >
        {open !== null && content !== null && (
          <>
            <p className="mb-2 text-ui font-semibold">{open.title}</p>
            <p className="text-ui break-words">{content.summary}</p>
            <p className="mt-4 text-ui text-content-secondary">
              {t('只删除这条记忆，不影响保存它的对话。')}
            </p>
            {deleting.isError && (
              <p role="alert" className="mt-4 text-ui text-destructive">
                {t('没有删除成功，记忆保持原样，请重试。')}
              </p>
            )}
          </>
        )}
      </AlertDialogShell>
    </div>
  );
}
