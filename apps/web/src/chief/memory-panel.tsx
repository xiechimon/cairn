import type { MemoryRecord, PatchMemoryBody, ProjectRecord } from '@cairn/shared';
import { cn } from 'cn';
import { useRef, useState } from 'react';
import { useConnected } from '../api/connection-state.js';
import { useApiMutations, useChiefMemoryUsage, useMemories } from '../api/hooks.js';
import { ProjectInstructionsField } from '../board/project-instructions-field.js';
import { AlertDialogActions, AlertDialogShell } from '../components/ui/alert-dialog-shell.js';
import { Button } from '../components/ui/button.js';
import { DialogFootRow, DialogShell } from '../components/ui/dialog-shell.js';
import { Input } from '../components/ui/input.js';
import { Skeleton } from '../components/ui/skeleton.js';
import { Textarea } from '../components/ui/textarea.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';
import { isAutoInjected, memoriesByLayer, splitMemoryContent } from './memory-list.js';

const ROW_GRID_CLS =
  'grid w-full grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-6 gap-y-0.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]';
const HEAD_CLS = 'text-ui font-normal text-foreground';
const HINT_CLS = 'mt-1 text-ui text-content-secondary';

const updatedOn = (at: number, t: TFunc) => {
  const date = new Date(at);
  return t('{mo}月{d}日', {
    mo: date.getMonth() + 1,
    d: date.getDate(),
    monthShort: date.toLocaleString('en', { month: 'short' }),
  });
};

export function MemoryPanel({
  live,
  teamId,
  project,
}: {
  live: boolean;
  teamId: string | undefined;
  project: Pick<ProjectRecord, 'id' | 'name' | 'instructions'> | null;
}) {
  const { t } = useI18n();
  const connected = useConnected();
  const memoriesQ = useMemories(teamId, live);
  const usageQ = useChiefMemoryUsage(teamId, live && project === null);
  const mutations = useApiMutations(teamId);
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState<{ title: string; content: string } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const autoHeadingRef = useRef<HTMLHeadingElement>(null);
  const detailBodyRef = useRef<HTMLDListElement>(null);
  const editContentRef = useRef<HTMLTextAreaElement>(null);
  const memories = memoriesQ.data ?? [];
  const { injected, lookup } = memoriesByLayer(memories, project?.id ?? null);
  const open = [...injected, ...lookup].find((memory) => memory.id === openId) ?? null;
  const deleting = mutations.deleteMemory;
  const updating = mutations.updateMemory;
  const scopeLabel = project?.name ?? t('团队');
  const layerLabel = (memory: MemoryRecord) =>
    isAutoInjected(memory.layer) ? t('核心') : t('可检索 · 不自动注入');

  const startDelete = () => {
    deleting.reset();
    setConfirming(true);
  };
  const confirmDelete = () => {
    if (open === null || deleting.isPending) return;
    deleting.mutate(
      { memoryId: open.id },
      {
        onSuccess: () => {
          setConfirming(false);
          setOpenId(null);
        },
      },
    );
  };

  const startEdit = () => {
    if (open === null) return;
    updating.reset();
    setEditing({ title: open.title, content: open.content });
  };
  const cancelEdit = () => {
    if (updating.isPending) return;
    updating.reset();
    setEditing(null);
  };
  const editUnchanged =
    open !== null &&
    editing !== null &&
    editing.content === open.content &&
    editing.title === open.title;
  const saveEdit = () => {
    if (open === null || editing === null || updating.isPending) return;
    const body: PatchMemoryBody = {};
    if (editing.content !== open.content) body.content = editing.content;
    if (!isAutoInjected(open.layer) && editing.title !== open.title) body.title = editing.title;
    if (body.content === undefined && body.title === undefined) {
      setEditing(null);
      return;
    }
    updating.mutate(
      { memoryId: open.id, body },
      {
        onSuccess: (record) => {
          setEditing(null);
          setOpenId(record.id);
        },
      },
    );
  };

  const rows = (heading: string, list: MemoryRecord[]) =>
    list.length === 0 ? null : (
      <div className="mt-5">
        <h3 className={HEAD_CLS}>{heading}</h3>
        <ul className="-mx-3 mt-2 border-t border-border">
          {list.map((memory) => (
            <li key={memory.id} className="border-b border-border">
              <Button
                variant="ghost"
                data-slot="memory-row"
                aria-label={t('打开记忆：{title}', { title: memory.title })}
                className="h-auto min-h-11 w-full justify-start rounded-none border-0 px-3 py-3 text-left text-ui font-normal whitespace-normal"
                onClick={() => setOpenId(memory.id)}
              >
                <span className={ROW_GRID_CLS}>
                  <span
                    data-slot="memory-title"
                    className="col-start-1 row-start-1 min-w-0 truncate text-foreground underline decoration-content-tertiary underline-offset-4"
                  >
                    {memory.title}
                  </span>
                  <span
                    data-slot="memory-summary"
                    className="col-span-2 row-start-2 truncate text-content-secondary sm:col-span-1 sm:col-start-2 sm:row-start-1"
                  >
                    {splitMemoryContent(memory.content).summary}
                  </span>
                  <span
                    data-slot="memory-date"
                    className="col-start-2 row-start-1 whitespace-nowrap text-content-secondary sm:col-start-3"
                  >
                    {t('更新于 {date}', { date: updatedOn(memory.updatedAt, t) })}
                  </span>
                </span>
              </Button>
            </li>
          ))}
        </ul>
      </div>
    );

  const autoMemory = (() => {
    if (live && memoriesQ.data === undefined && memoriesQ.isError) {
      return (
        <div role="alert" className="mt-4 flex items-center gap-3 border-y border-border py-3">
          <p className="min-w-0 flex-1 text-ui text-foreground">
            {t('记忆没有加载出来，请重试。')}
          </p>
          <Button
            variant="outline"
            disabled={memoriesQ.isFetching}
            onClick={() => void memoriesQ.refetch()}
          >
            {t('重试')}
          </Button>
        </div>
      );
    }
    if (live && memoriesQ.data === undefined) {
      return (
        <div role="status" aria-label={t('正在加载记忆')} className="mt-5">
          <Skeleton className="h-4 w-24" />
          <div className="-mx-3 mt-2 border-t border-border">
            {[0, 1, 2].map((key) => (
              <div key={key} className={cn(ROW_GRID_CLS, 'border-b border-border px-3 py-3')}>
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-full max-sm:hidden" />
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </div>
        </div>
      );
    }
    return (
      <>
        {rows(t('可自动注入'), injected)}
        {rows(t('记忆文件'), lookup)}
      </>
    );
  })();

  const empty = (!live || memoriesQ.data !== undefined) && injected.length + lookup.length === 0;
  const content = open === null ? null : splitMemoryContent(open.content);
  const usage = project === null ? (usageQ.data?.usage ?? null) : null;
  const usageRows = (() => {
    if (usage === null) return null;
    const byId = new Map(memories.map((memory) => [memory.id, memory]));
    const ids = [
      ...usage.teamMemoryIds.map((id) => ({ id, tag: null as string | null })),
      ...usage.projectMemoryIds.map((id) => ({ id, tag: t('项目') })),
      ...usage.recalledMemoryIds.map((id) => ({ id, tag: t('按消息召回') })),
    ];
    return (
      <div className="mt-6" data-testid="memory-usage">
        <h3 className={HEAD_CLS}>{t('本轮使用')}</h3>
        <p className={HINT_CLS}>{t('最近一轮对话实际注入给 Coordinator 的记忆。')}</p>
        {ids.length === 0 ? (
          <p className="mt-2 text-ui text-content-secondary">{t('这一轮没有注入记忆。')}</p>
        ) : (
          <ul className="-mx-3 mt-2 border-t border-border">
            {ids.map(({ id, tag }) => {
              const memory = byId.get(id);
              return (
                <li key={`${tag ?? 'team'}-${id}`} className="border-b border-border">
                  {memory === undefined ? (
                    <div className="px-3 py-3 text-ui text-content-tertiary">
                      {t('已失效的记忆')}
                      {tag !== null && <span className="ml-2 text-meta">{tag}</span>}
                    </div>
                  ) : (
                    <Button
                      variant="ghost"
                      data-slot="memory-row"
                      aria-label={t('打开记忆：{title}', { title: memory.title })}
                      className="h-auto min-h-11 w-full justify-start rounded-none border-0 px-3 py-3 text-left text-ui font-normal whitespace-normal"
                      onClick={() => setOpenId(memory.id)}
                    >
                      <span className={ROW_GRID_CLS}>
                        <span
                          data-slot="memory-title"
                          className="col-start-1 row-start-1 min-w-0 truncate text-foreground underline decoration-content-tertiary underline-offset-4"
                        >
                          {memory.title}
                        </span>
                        <span
                          data-slot="memory-summary"
                          className="col-span-2 row-start-2 truncate text-content-secondary sm:col-span-1 sm:col-start-2 sm:row-start-1"
                        >
                          {splitMemoryContent(memory.content).summary}
                        </span>
                        {tag !== null && (
                          <span className="col-start-2 row-start-1 whitespace-nowrap text-content-tertiary sm:col-start-3">
                            {tag}
                          </span>
                        )}
                      </span>
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  })();
  return (
    <div ref={listRef} data-testid="memory-list">
      {usageRows}
      {project !== null && live && (
        <div className="mt-6">
          <h3 className={HEAD_CLS}>{t('项目说明')}</h3>
          <p className={HINT_CLS}>
            {t('像 AGENTS.md：本项目的每个对话和 Coordinator 都会读到并遵守。')}
          </p>
          <div className="mt-3">
            <ProjectInstructionsField
              key={project.id}
              project={project}
              teamId={teamId}
              testId="project-instructions-input"
            />
          </div>
        </div>
      )}
      <div className="mt-6">
        <h3
          ref={autoHeadingRef}
          tabIndex={-1}
          className={cn(
            HEAD_CLS,
            'outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-(--focus-ring)',
          )}
        >
          {t('自动记忆')}
        </h3>
        <p className={HINT_CLS}>
          {project === null
            ? empty
              ? t('Coordinator 还没有记下团队笔记。')
              : t('Coordinator 在所有项目里都会用到的笔记。')
            : empty
              ? t('Coordinator 还没有在这个项目里记下笔记。')
              : t('Coordinator 在这个项目里工作时自己写下的笔记。')}
        </p>
        {!connected && (
          <p className="mt-1 text-meta text-content-secondary">
            {t('离线中。记忆只能查看，重新连接后才能编辑或删除。')}
          </p>
        )}
      </div>
      {autoMemory}
      <DialogShell
        open={open !== null && !confirming}
        title={open?.title ?? ''}
        subtitle={open === null ? undefined : `${scopeLabel} · ${layerLabel(open)}`}
        initialFocus={editing === null ? detailBodyRef : editContentRef}
        onClose={() => {
          if (updating.isPending) return;
          setEditing(null);
          setOpenId(null);
        }}
        headerAction={
          live && connected && editing === null ? (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={startEdit}>
                {t('编辑')}
              </Button>
              <Button variant="outline" size="sm" onClick={startDelete}>
                {t('删除…')}
              </Button>
            </div>
          ) : undefined
        }
        footer={
          editing !== null ? (
            <DialogFootRow>
              <Button variant="outline" disabled={updating.isPending} onClick={cancelEdit}>
                {t('取消')}
              </Button>
              <Button disabled={updating.isPending || editUnchanged} onClick={saveEdit}>
                {updating.isPending ? t('保存中…') : t('保存')}
              </Button>
            </DialogFootRow>
          ) : undefined
        }
      >
        {open !== null && content !== null && editing !== null ? (
          <div className="space-y-4">
            {!isAutoInjected(open.layer) && (
              <div>
                <label htmlFor="memory-edit-title" className="text-meta text-content-tertiary">
                  {t('文件名')}
                </label>
                <Input
                  id="memory-edit-title"
                  data-testid="memory-edit-title"
                  className="mt-0.5"
                  value={editing.title}
                  disabled={updating.isPending}
                  onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                />
              </div>
            )}
            <div>
              <label htmlFor="memory-edit-content" className="text-meta text-content-tertiary">
                {t('记忆内容')}
              </label>
              <Textarea
                id="memory-edit-content"
                ref={editContentRef}
                data-testid="memory-edit-content"
                className="mt-0.5 min-h-40"
                value={editing.content}
                disabled={updating.isPending}
                onChange={(e) => setEditing({ ...editing, content: e.target.value })}
              />
            </div>
            {updating.isError && (
              <p role="alert" className="text-ui text-destructive">
                {t('没有保存成功，原内容保持不变，请重试。')}
              </p>
            )}
          </div>
        ) : (
          open !== null &&
          content !== null && (
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
          )
        )}
      </DialogShell>
      <AlertDialogShell
        open={open !== null && confirming}
        title={t('删除这条记忆？')}
        ariaLabel={t('删除这条记忆')}
        finalFocus={() => {
          if (open !== null) return true;
          return (
            listRef.current?.querySelector<HTMLElement>('[data-slot="memory-row"]') ??
            autoHeadingRef.current
          );
        }}
        onClose={() => {
          if (!deleting.isPending) setConfirming(false);
        }}
        footer={
          <AlertDialogActions
            cancelLabel={t('取消')}
            confirmLabel={deleting.isPending ? t('正在删除…') : t('删除记忆')}
            confirmDisabled={deleting.isPending}
            onCancel={() => {
              if (!deleting.isPending) setConfirming(false);
            }}
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
