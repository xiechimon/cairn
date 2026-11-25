import type { ReactElement, ReactNode, RefObject } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useApiMutations } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { joinMeta, relativeTime } from '../board/rel-time.js';
import { useThreadHref } from '../board/thread-link.js';
import { useNarrow } from '../board/use-narrow.js';
import { CopyIconButton } from '../components/copy-icon-button.js';
import { FilterPicker } from '../components/filter-picker.js';
import { FormActions, FormField, FormStack } from '../components/form-layout.js';
import { AlertDialogActions, AlertDialogShell } from '../components/ui/alert-dialog-shell.js';
import { Button } from '../components/ui/button.js';
import { DIALOG_TEXT_BUTTON } from '../components/ui/dialog-shell.js';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '../components/ui/popover.js';
import { Textarea } from '../components/ui/textarea.js';
import { blockDemoWrite } from '../demo/demo-gate.js';
import type { ScheduleRecord } from '../fixtures/records.js';
import { scrollFadeClassName, useScrollFade } from '../hooks/use-scroll-fade.js';
import { useI18n } from '../i18n/provider.js';
import { describeError } from '../lib/error-copy.js';
import { scheduleWhen } from '../pages/schedule-summary.js';
import { ScheduleFields } from './schedule-fields.js';
import {
  isTriggerSchedule,
  previewCronNextRun,
  SCHEDULE_VALIDATION_ERROR_KEYS,
  scheduleBody,
  scheduleDraft,
  schedulePauseReason,
  scheduleViewState,
  toWireSchedule,
} from './schedule-model.js';

export interface ScheduleCandidate {
  id: string;
  title: string;
  projectId: string;
  place?: string;
}

const RUN_STATUS: Record<string, string> = {
  completed: '成功',
  failed: '失败',
  skipped: '已跳过',
};

export function WebhookUrlRevealDialog({
  webhookUrl,
  onDone,
}: {
  webhookUrl: string | null;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const fieldId = useId();
  return (
    <AlertDialogShell
      title={t('保存 Webhook 地址')}
      subtitle={t('关闭后无法再次查看，请现在复制并妥善保存。')}
      ariaLabel={t('保存 Webhook 地址')}
      open={webhookUrl !== null}
      onClose={onDone}
      dismissible={false}
      size="s"
      footer={
        <FormActions
          className="pt-0"
          primary={{ label: t('我已保存'), onClick: onDone, testId: 'schedule-webhook-saved' }}
        />
      }
    >
      <FormStack className="max-w-none">
        <FormField
          label={t('Webhook 地址')}
          htmlFor={fieldId}
          help={t('外部 POST 请求打到它就运行一次。')}
        >
          <div className="flex items-start gap-1">
            <Textarea
              id={fieldId}
              readOnly
              rows={3}
              value={webhookUrl ?? ''}
              data-testid="schedule-webhook-url"
              className="min-h-0 min-w-0 flex-1 resize-none font-mono break-all"
              onFocus={(event) => {
                event.currentTarget.select();
                event.currentTarget.scrollTop = 0;
              }}
            />
            <CopyIconButton
              text={webhookUrl ?? ''}
              testId="schedule-webhook-copy"
              className="pointer-coarse:size-11"
            />
          </div>
        </FormField>
      </FormStack>
    </AlertDialogShell>
  );
}

export function SchedulePopover({
  schedule,
  candidates = [],
  deleted = false,
  anchor,
  now,
  open,
  onOpenChange,
  onWebhookUrl,
  trigger,
  children,
}: {
  schedule: ScheduleRecord | null;
  candidates?: readonly ScheduleCandidate[];
  deleted?: boolean;
  anchor?: RefObject<HTMLElement | null>;
  now: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onWebhookUrl?: (url: string) => void;
  trigger: ReactElement;
  children: ReactNode;
}) {
  const narrow = useNarrow();
  const [locked, setLocked] = useState(false);
  const [localWebhookUrl, setLocalWebhookUrl] = useState<string | null>(null);
  const handleWebhookUrl = onWebhookUrl ?? setLocalWebhookUrl;
  return (
    <>
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (!next && locked) return;
          onOpenChange(next);
        }}
      >
        <PopoverTrigger render={trigger}>{children}</PopoverTrigger>
        <PopoverContent
          data-testid="schedule-popover"
          {...(narrow
            ? {
                anchor,
                side: 'bottom' as const,
                align: 'start' as const,
                sideOffset: ({ anchor }: { anchor: { height: number } }) => -anchor.height,
                collisionPadding: {
                  top: anchor?.current?.getBoundingClientRect().top ?? 72,
                  bottom: 96,
                  left: 8,
                  right: 8,
                },
                collisionAvoidance: { side: 'shift' as const, align: 'shift' as const },
                className:
                  'max-h-(--available-height) w-(--available-width) gap-3 overflow-hidden p-3 pb-0',
              }
            : {
                side: 'left' as const,
                align: 'start' as const,
                sideOffset: 16,
                collisionPadding: { top: 60, right: 8, left: 8, bottom: 104 },
                collisionAvoidance: { side: 'flip' as const, align: 'shift' as const },
                className: 'max-h-(--available-height) w-80 gap-3 overflow-hidden p-3 pb-0',
              })}
        >
          {open && (
            <ScheduleEditor
              schedule={schedule}
              candidates={candidates}
              deleted={deleted}
              now={now}
              onLockChange={setLocked}
              onWebhookUrl={handleWebhookUrl}
              onDone={() => {
                setLocked(false);
                onOpenChange(false);
              }}
            />
          )}
        </PopoverContent>
      </Popover>
      {onWebhookUrl === undefined && (
        <WebhookUrlRevealDialog
          webhookUrl={localWebhookUrl}
          onDone={() => setLocalWebhookUrl(null)}
        />
      )}
    </>
  );
}

function ScheduleEditor({
  schedule,
  candidates,
  deleted,
  now,
  onLockChange,
  onWebhookUrl,
  onDone,
}: {
  schedule: ScheduleRecord | null;
  candidates: readonly ScheduleCandidate[];
  deleted: boolean;
  now: number;
  onLockChange: (locked: boolean) => void;
  onWebhookUrl: (url: string) => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const mutations = useApiMutations(teamId);
  const threadHref = useThreadHref();
  const taskId = useId();
  const tz = schedule?.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const record = schedule === null ? null : toWireSchedule(schedule);
  const [draft, setDraft] = useState(() => scheduleDraft(record, now, tz));
  const [todoId, setTodoId] = useState(schedule?.todoId ?? candidates[0]?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const target =
    schedule === null
      ? candidates.find((candidate) => candidate.id === todoId)
      : { id: schedule.todoId, title: schedule.todo.title, projectId: schedule.projectId };
  const busy = mutations.createSchedule.isPending || mutations.updateSchedule.isPending;
  const cronValid = draft.trigger !== 'custom' || previewCronNextRun(draft.cron, tz, now).ok;
  const savable = !busy && !deleted && target !== undefined && cronValid;
  const save = async () => {
    if (!savable || target === undefined) return;
    if (!live) {
      blockDemoWrite();
      onDone();
      return;
    }
    setError(null);
    try {
      const body = scheduleBody(
        draft,
        {
          todoId: target.id,
          projectId: target.projectId,
          tz,
          enabled: record?.enabled ?? true,
        },
        now,
      );
      const saved =
        schedule === null
          ? await mutations.createSchedule.mutateAsync(body)
          : await mutations.updateSchedule.mutateAsync({ id: schedule.id, body });
      if (saved.webhookUrl !== undefined) onWebhookUrl(saved.webhookUrl);
      onDone();
    } catch (failure) {
      setError(
        describeError(failure, t) ??
          (failure instanceof Error && SCHEDULE_VALIDATION_ERROR_KEYS.has(failure.message)
            ? t(failure.message)
            : t('定时未能保存，请重试。')),
      );
    }
  };
  const closeRotateConfirm = () => {
    setConfirmRotate(false);
    onLockChange(false);
  };
  const rotateWebhook = async () => {
    if (schedule === null || target === undefined || busy || deleted) return;
    if (!live) {
      blockDemoWrite();
      closeRotateConfirm();
      return;
    }
    setError(null);
    try {
      const rotated = await mutations.updateSchedule.mutateAsync({
        id: schedule.id,
        body: {
          todoId: target.id,
          projectId: target.projectId,
          tz,
          prompt: draft.prompt,
          enabled: record?.enabled ?? true,
          kind: 'webhook',
          rotateWebhook: true,
        },
      });
      closeRotateConfirm();
      if (rotated.webhookUrl !== undefined) onWebhookUrl(rotated.webhookUrl);
      onDone();
    } catch (failure) {
      closeRotateConfirm();
      setError(describeError(failure, t) ?? t('定时未能保存，请重试。'));
    }
  };
  const state = record === null ? null : scheduleViewState(record);
  const nextRun =
    record === null
      ? null
      : deleted ||
          state === 'finished' ||
          !record.enabled ||
          (record.nextRunAt === null && !isTriggerSchedule(record.kind))
        ? t('没有下一次')
        : record.nextRunAt === null
          ? t('等待触发')
          : scheduleWhen(record.nextRunAt, record.tz, now, t);
  const lastRun =
    record === null
      ? null
      : record.lastRunAt === null
        ? record.lastRunStatus === null
          ? t('尚未运行')
          : t(RUN_STATUS[record.lastRunStatus] ?? record.lastRunStatus)
        : joinMeta([
            relativeTime(record.lastRunAt, now, t),
            record.lastRunStatus === null
              ? null
              : t(RUN_STATUS[record.lastRunStatus] ?? record.lastRunStatus),
          ]);
  const blocker =
    busy || deleted
      ? null
      : target === undefined
        ? t('先选择任务')
        : !cronValid
          ? t('Cron 表达式有误')
          : null;
  const problem = record?.pausedReason ?? record?.lastRunError ?? null;
  const bodyRef = useRef<HTMLDivElement>(null);
  useScrollFade(bodyRef);
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const reveal = (event: FocusEvent) => {
      if (event.target instanceof Element) event.target.scrollIntoView({ block: 'nearest' });
    };
    body.addEventListener('focusin', reveal);
    return () => body.removeEventListener('focusin', reveal);
  }, []);
  return (
    <>
      <PopoverTitle className="shrink-0 truncate text-ui font-medium">
        {schedule === null ? t('新建定时') : schedule.todo.title}
      </PopoverTitle>
      <div
        ref={bodyRef}
        className={`${scrollFadeClassName()} -m-1 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto scroll-py-5 p-1 [--scroll-fade-size:16px]`}
      >
        {deleted && (
          <p role="status" className="m-0 text-meta text-destructive">
            {t('这条定时已被删除')}
          </p>
        )}
        {schedule === null ? (
          candidates.length === 0 ? (
            <p className="m-0 text-meta text-content-secondary">
              {t('这里暂无可以定时的任务。先新建一个任务，或让 Coordinator 帮你新建定时。')}
            </p>
          ) : (
            <FormField label={t('任务')} htmlFor={taskId}>
              <FilterPicker
                options={candidates.map((candidate) => ({
                  value: candidate.id,
                  label: candidate.title,
                  ...(candidate.place === undefined
                    ? {}
                    : { detail: candidate.place, group: candidate.place }),
                }))}
                value={todoId}
                onPick={setTodoId}
                disabled={busy}
                label={t('任务')}
                placeholder={t('搜索任务或项目')}
                noun={t('任务')}
                triggerId={taskId}
                triggerClassName="w-full min-w-0 pointer-coarse:h-11"
                popupClassName="w-(--anchor-width) max-sm:w-(--anchor-width)"
                triggerContent={target === undefined ? t('选择任务') : undefined}
              />
            </FormField>
          )
        ) : (
          <dl data-testid="schedule-popover-runs" className="m-0 grid grid-cols-2 gap-2 text-meta">
            <div>
              <dt className="text-content-tertiary">{t('下次运行')}</dt>
              <dd className="m-0 text-foreground">{nextRun}</dd>
            </div>
            <div>
              <dt className="text-content-tertiary">{t('上次运行')}</dt>
              <dd className="m-0 text-foreground">{lastRun}</dd>
            </div>
            {problem !== null && (
              <dd className="col-span-2 m-0 break-words text-content-secondary" title={problem}>
                {schedulePauseReason(problem, t)}
              </dd>
            )}
          </dl>
        )}
        {(schedule !== null || candidates.length > 0) && (
          <ScheduleFields
            value={draft}
            onChange={setDraft}
            tz={tz}
            now={now}
            disabled={busy || deleted}
            webhookMasked={schedule?.kind === 'webhook' ? (schedule.webhookMasked ?? null) : null}
            onRotateWebhook={
              schedule?.kind === 'webhook'
                ? () => {
                    onLockChange(true);
                    setConfirmRotate(true);
                  }
                : undefined
            }
          />
        )}
        {error !== null && (
          <p role="alert" className="m-0 break-words text-meta text-destructive">
            {error}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2 pb-3">
        {schedule !== null && (
          <Button
            variant="ghost"
            size="sm"
            className="mr-auto -ml-2.5 text-content-secondary pointer-coarse:h-11"
            render={<Link to={threadHref(schedule.todoId)} onClick={onDone} />}
          >
            {t('打开任务')}
          </Button>
        )}
        {blocker !== null && (
          <span className="ml-auto min-w-0 truncate text-meta text-content-tertiary">
            {blocker}
          </span>
        )}
        <Button
          variant="secondary"
          size="sm"
          className={`${blocker === null ? 'ml-auto' : ''} ${DIALOG_TEXT_BUTTON} pointer-coarse:h-11 dark:bg-(--menu-hover) dark:hover:bg-(--sidebar-press)`}
          onClick={onDone}
        >
          {deleted ? t('关闭') : t('取消')}
        </Button>
        {!deleted && (
          <Button
            size="sm"
            className="text-ui pointer-coarse:h-11 dark:disabled:bg-(--menu-hover)/50"
            disabled={!savable}
            onClick={() => void save()}
          >
            {t('保存')}
          </Button>
        )}
      </div>
      <AlertDialogShell
        title={t('轮换 Webhook 地址')}
        ariaLabel={t('轮换 Webhook 地址')}
        open={confirmRotate}
        onClose={closeRotateConfirm}
        footer={
          <AlertDialogActions
            cancelLabel={t('取消')}
            confirmLabel={t('轮换地址')}
            confirmDisabled={busy}
            onCancel={closeRotateConfirm}
            onConfirm={() => void rotateWebhook()}
          />
        }
      >
        <p className="m-0 text-ui text-content-secondary">
          {t('轮换后，当前 Webhook 地址会立即失效，已接入的外部调用需要改为新地址。')}
        </p>
      </AlertDialogShell>
    </>
  );
}
