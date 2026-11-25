import type { MemoryEditReceiptRecord, MemoryEditRecord } from '@cairn/shared';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from 'cn';
import { diffLines } from 'diff';
import { ArrowUp, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useConnected } from '../api/connection-state.js';
import { useApiMutations, useCurrentMemoryEdit } from '../api/hooks.js';
import { formatClock } from '../components/chat/live-row.js';
import { IconTooltip } from '../components/icon-tooltip.js';
import { Button } from '../components/ui/button.js';
import { Textarea } from '../components/ui/textarea.js';
import { toastError } from '../components/ui/toaster.js';
import { useIntervalNow } from '../hooks/use-interval-now.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';
import { COMPOSER_FIELD_CLS } from './composer-surface.js';

interface DiffLine {
  sign: '-' | '+' | ' ';
  text: string;
}

function receiptDiffLines(receipt: MemoryEditReceiptRecord): DiffLine[] {
  const before = receipt.before ?? '';
  const after = receipt.after ?? '';
  if (before === after) return [];
  const out: DiffLine[] = [];
  for (const part of diffLines(before, after)) {
    const sign = part.added ? '+' : part.removed ? '-' : ' ';
    const lines = part.value.replace(/\n$/, '').split('\n');
    for (const text of lines) out.push({ sign, text });
  }
  return out;
}

function scopeTag(receipt: MemoryEditReceiptRecord, projectName: string | null, t: TFunc) {
  return receipt.scope === 'team' || receipt.scope === null
    ? t('团队')
    : (projectName ?? t('项目'));
}

function ReceiptDiff({
  receipt,
  projectName,
}: {
  receipt: MemoryEditReceiptRecord;
  projectName: string | null;
}) {
  const { t } = useI18n();
  const lines = receiptDiffLines(receipt);
  if (lines.length === 0) return null;
  return (
    <div data-slot="memory-edit-diff" className="mt-3">
      <p className="text-meta text-content-secondary">
        {receipt.file ?? 'MEMORY.md'}
        <span className="ml-2 text-content-tertiary">{scopeTag(receipt, projectName, t)}</span>
      </p>
      <div className="mt-1 overflow-x-auto font-mono text-meta leading-5 whitespace-pre-wrap break-words">
        {lines.map((line, index) => (
          <div
            key={`${index}-${line.sign}`}
            className={cn(
              'px-1',
              line.sign === '+' && 'bg-(--diff-add-bg) shadow-[inset_2px_0_0_var(--diff-add-fg)]',
              line.sign === '-' && 'bg-(--diff-del-bg) shadow-[inset_2px_0_0_var(--destructive)]',
              line.sign === ' ' && 'text-content-tertiary',
            )}
          >
            {line.sign === ' ' ? '  ' : `${line.sign} `}
            {line.text}
          </div>
        ))}
      </div>
    </div>
  );
}

function statusLine(
  edit: MemoryEditRecord,
  elapsed: number | null,
  t: TFunc,
): { head: string; showDiffs: boolean } {
  const changes = edit.receipts.length;
  switch (edit.status) {
    case 'working':
      return {
        head: t('Coordinator 正在改记忆{elapsed}', {
          elapsed: elapsed === null ? '' : ` · ${formatClock(elapsed)}`,
        }),
        showDiffs: false,
      };
    case 'done':
      return {
        head:
          changes === 0
            ? t('Coordinator 看过了，记忆没有要改的。')
            : t('已按你的话改了 {count} 处', { count: changes }),
        showDiffs: changes > 0,
      };
    case 'awaiting_input':
      return { head: edit.reply ?? t('Coordinator 需要确认后再修改。'), showDiffs: false };
    case 'partial':
      return { head: t('已修改 {count} 处，其余未完成', { count: changes }), showDiffs: true };
    case 'stopped':
      return { head: t('已停止，记忆没有变'), showDiffs: false };
    case 'failed':
      return { head: t('Coordinator 本次未能修改，记忆未改变。'), showDiffs: false };
  }
}

export function memoryEditTouchedFiles(edit: MemoryEditRecord | null | undefined): Set<string> {
  const keys = new Set<string>();
  if (edit === null || edit === undefined) return keys;
  if (edit.status !== 'done' && edit.status !== 'partial') return keys;
  for (const receipt of edit.receipts) {
    keys.add(`${receipt.scope ?? 'team'}:${receipt.file ?? 'MEMORY.md'}`);
  }
  return keys;
}

export function MemoryEditComposer({
  teamId,
  projectId = null,
  projectName = null,
  file = null,
  embedded = false,
}: {
  teamId: string | undefined;
  projectId?: string | null;
  projectName?: string | null;
  file?: string | null;
  embedded?: boolean;
}) {
  const { t } = useI18n();
  const connected = useConnected();
  const qc = useQueryClient();
  const editQ = useCurrentMemoryEdit(teamId, teamId !== undefined);
  const mutations = useApiMutations(teamId);
  const scopeKey = `${projectId ?? 'team'}:${file ?? ''}`;
  const rawEdit = editQ.data ?? null;
  const matchesScope =
    rawEdit !== null &&
    (rawEdit.projectId ?? null) === projectId &&
    (file === null || rawEdit.file === null || rawEdit.file === file);
  const edit = matchesScope ? rawEdit : null;
  const otherScopeWorking = rawEdit !== null && !matchesScope && rawEdit.status === 'working';
  const [draftsByScope, setDraftsByScope] = useState<Record<string, string>>({});
  const draft = draftsByScope[scopeKey] ?? '';
  const setDraft = (next: string | ((current: string) => string)) => {
    setDraftsByScope((current) => {
      const prev = current[scopeKey] ?? '';
      const value = typeof next === 'function' ? next(prev) : next;
      return value === prev ? current : { ...current, [scopeKey]: value };
    });
  };
  const restoredFor = useRef<string | null>(null);
  const working = edit?.status === 'working';
  const now = useIntervalNow(working);
  const elapsed =
    working && edit !== null ? Math.max(0, Math.floor((now - edit.updatedAt) / 1000)) : null;

  const receiptCount = edit?.receipts.length ?? 0;
  const editStatus = edit?.status ?? null;
  useEffect(() => {
    if (receiptCount > 0 || editStatus === 'done') {
      void qc.invalidateQueries({ queryKey: ['memories', teamId] });
    }
  }, [qc, teamId, receiptCount, editStatus]);

  useEffect(() => {
    if (edit !== null && edit.status === 'failed' && restoredFor.current !== edit.id) {
      restoredFor.current = edit.id;
      setDraft((current) => (current === '' ? edit.instruction : current));
    }
  }, [edit, scopeKey]);

  const continuable =
    edit !== null && (edit.status === 'awaiting_input' || edit.status === 'partial');
  const sending = mutations.submitMemoryEdit.isPending;
  const stopping = mutations.stopMemoryEdit.isPending;
  const canSend = connected && !sending && !otherScopeWorking && draft.trim() !== '';
  const showCard = edit !== null;
  const line = edit !== null ? statusLine(edit, elapsed, t) : null;

  const send = () => {
    const text = draft.trim();
    if (!canSend) return;
    mutations.submitMemoryEdit.mutate(
      continuable && edit !== null
        ? { text, editId: edit.id, attempt: edit.attempt }
        : {
            text,
            ...(file !== null ? { file } : {}),
            ...(projectId !== null ? { projectId } : {}),
          },
      {
        onSuccess: () => setDraft(''),
        onError: () => setDraft((current) => (current === '' ? text : current)),
      },
    );
  };
  const stop = () => {
    if (edit === null || stopping) return;
    mutations.stopMemoryEdit.mutate(
      { editId: edit.id, attempt: edit.attempt },
      { onError: (error) => toastError(t('停止失败，请重试。'), error) },
    );
  };

  return (
    <div
      data-testid="memory-edit-composer"
      className={cn(
        embedded ? 'w-full' : 'sticky bottom-0 -mx-3 mt-auto bg-dialog-surface px-3 pt-4 pb-4',
        'z-1',
      )}
    >
      <div
        className={cn(
          COMPOSER_FIELD_CLS,
          'rounded-(--radius-composer) border-0 bg-(--composer-fill) px-3.5 py-2.5',
        )}
      >
        {showCard && edit !== null && line !== null && (
          <div data-testid="memory-edit-card" className="mb-1.5 border-b border-border pb-2.5">
            <p className="text-ui text-content-secondary break-words">
              {t('你：{text}', { text: edit.instruction })}
            </p>
            <p
              className={cn(
                'mt-0.5 text-ui',
                edit.status === 'awaiting_input' ? 'text-(--accent-ink)' : 'text-foreground',
              )}
              role={edit.status === 'failed' ? 'alert' : undefined}
            >
              {line.head}
            </p>
            {line.showDiffs &&
              edit.receipts.map((receipt) => (
                <ReceiptDiff key={receipt.id} receipt={receipt} projectName={projectName} />
              ))}
          </div>
        )}
        {!connected && (
          <p className="mb-1.5 text-meta text-content-secondary">
            {t('离线中。重新连接后才能让 Coordinator 修改。')}
          </p>
        )}
        {connected && otherScopeWorking && (
          <p className="mb-1.5 text-meta text-content-secondary">
            {t('其他范围有一条记忆修改正在进行。')}
          </p>
        )}
        <div className="flex items-end gap-2">
          <div className="relative min-w-0 flex-1">
            <Textarea
              data-testid="memory-edit-input"
              className="h-7 max-h-30 min-h-0 resize-none overflow-y-auto rounded-none border-none bg-transparent px-0.5 py-1 font-sans text-ui leading-5 tabular-nums shadow-none field-sizing-fixed placeholder:text-(--text-tertiary) focus-visible:border-transparent focus-visible:ring-0 focus-visible:outline-none dark:bg-transparent"
              readOnly={!connected || sending}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  send();
                }
              }}
              placeholder={t('告诉 Coordinator 要记住或改什么')}
              aria-label={t('告诉 Coordinator 要记住或改什么')}
            />
          </div>
          {working ? (
            <IconTooltip
              label={t('停止')}
              trigger={
                <Button
                  variant="ghost"
                  size="icon"
                  data-testid="memory-edit-stop"
                  disabled={stopping}
                  className="ml-auto size-7 cursor-pointer rounded-(--radius-control) text-foreground hover:bg-(--menu-hover)"
                  onClick={stop}
                />
              }
            >
              <Square width={14} height={14} fill="currentColor" />
            </IconTooltip>
          ) : (
            <IconTooltip
              label={t('发送')}
              trigger={
                <Button
                  variant="ghost"
                  size="icon"
                  data-testid="memory-edit-send"
                  disabled={!canSend}
                  className={cn(
                    'ml-auto size-7 cursor-pointer rounded-(--radius-control) text-(--text-tertiary) hover:bg-(--menu-hover)',
                    draft.trim() !== '' && 'text-foreground',
                  )}
                  onClick={send}
                />
              }
            >
              <ArrowUp width={20} height={20} />
            </IconTooltip>
          )}
        </div>
        {mutations.submitMemoryEdit.isError && (
          <p role="alert" className="mt-1.5 text-meta text-destructive">
            {t('未能发送，内容仍在输入框里，请重试。')}
          </p>
        )}
      </div>
    </div>
  );
}
