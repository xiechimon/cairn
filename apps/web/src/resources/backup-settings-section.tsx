import type { BackupHealth, BackupSnapshotSummary } from '@cairn/shared';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { fetchWithSession } from '../api/auth.js';
import { useBackupMutations, useServerBackup } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { SettingsCard, SettingsRow, SettingsSection } from '../components/settings-list.js';
import { Button } from '../components/ui/button.js';
import { DIALOG_PRIMARY_BUTTON, DialogShell } from '../components/ui/dialog-shell.js';
import { toastError, toastSuccess } from '../components/ui/toaster.js';
import { useI18n } from '../i18n/provider.js';

function formatBackupTime(
  tsMs: number,
  locale: string,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  const date = new Date(tsMs);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const time = date.toLocaleTimeString(locale === 'zh' ? 'zh-CN' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  if (sameDay) return t('今天 {time}', { time });
  const day = date.toLocaleDateString(locale === 'zh' ? 'zh-CN' : 'en-US', {
    month: 'short',
    day: 'numeric',
  });
  return `${day} ${time}`;
}

function formatBackupSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function backupStatusLine(
  health: BackupHealth | null | undefined,
  locale: string,
  t: (key: string, params?: Record<string, string | number>) => string,
): { text: string; failed: boolean; detail: string | null } {
  if (health == null || health.state === 'none') {
    return { text: t('尚未完成首次备份'), failed: false, detail: null };
  }
  if (health.state === 'unreadable') {
    return { text: t('状态无法读取'), failed: true, detail: null };
  }
  const { status } = health;
  const time = formatBackupTime(status.lastRunAt, locale, t);
  if (status.lastRunResult === 'success') {
    return {
      text: t('最近备份：{time} · 正常', { time }),
      failed: false,
      detail: null,
    };
  }
  const detail = [status.lastRunResult, status.lastRunExitStatus].filter(Boolean).join(' ');
  return {
    text: t('最近备份：{time} · 失败', { time }),
    failed: true,
    detail: detail === '' ? null : detail,
  };
}

function snapshotKindLabel(
  kind: BackupSnapshotSummary['kind'],
  t: (key: string) => string,
): string {
  if (kind === 'pre-restore') return t('恢复前自动快照');
  if (kind === 'manual') return t('手动备份');
  return t('每日自动备份');
}

export function BackupSettingsSection() {
  const { locale, t } = useI18n();
  const { live } = useLiveData();
  const backupQ = useServerBackup(live);
  const mutations = useBackupMutations();
  const [exporting, setExporting] = useState(false);
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);
  const [importProgress, setImportProgress] = useState<number | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [reasonOpen, setReasonOpen] = useState(false);
  const [confirmSnapshot, setConfirmSnapshot] = useState<BackupSnapshotSummary | null>(null);

  if (!live) return null;
  const health = backupQ.data;
  const managed = health?.managed;
  if (managed === undefined || !managed.enabled) return null;

  const statusLine = backupStatusLine(health, locale, t);
  const snapshots = managed.snapshots;
  const isBackingUp = mutations.runNow.isPending;
  const isImporting = mutations.importArchive.isPending;
  const isRestoring = mutations.restore.isPending;
  const busy = managed.inProgress || isBackingUp || isImporting || isRestoring || exporting;
  const backupButtonBusy =
    isBackingUp || (managed.inProgress && !isImporting && !isRestoring && !exporting);

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const res = await fetchWithSession('/api/server/backup/export', { method: 'POST' });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? res.statusText);
      }
      const blob = await res.blob();
      const disposition = res.headers.get('content-disposition') ?? '';
      const match = /filename="([^"]+)"/.exec(disposition);
      const filename = match?.[1] ?? 'cairn-backup.tar.gz';
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toastSuccess(t('已开始下载全部数据'));
    } catch (error) {
      toastError(t('下载失败，请重试。'), error);
    } finally {
      setExporting(false);
    }
  };

  const handleRestoreConfirm = () => {
    if (confirmSnapshot === null || isRestoring) return;
    const target = confirmSnapshot;
    setConfirmSnapshot(null);
    mutations.restore.mutate(target.id, {
      onSuccess: (result) => {
        toastSuccess(
          result.restarting
            ? t('已保存当前状态并开始恢复，服务正在重启')
            : t('已保存当前状态并完成恢复准备，重启服务后生效'),
        );
      },
      onError: (error) => toastError(t('恢复失败，请重试。'), error),
    });
  };

  const handlePickImportFile = () => {
    if (busy) return;
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = '.tar.gz,.tgz,application/gzip';
    picker.onchange = () => {
      const selected = picker.files?.[0] ?? null;
      if (selected !== null) {
        setPendingImportFile(selected);
        setImportProgress(null);
      }
    };
    picker.click();
  };

  const handleImportConfirm = () => {
    if (pendingImportFile === null || isImporting) return;
    const target = pendingImportFile;
    setImportProgress(0);
    mutations.importArchive.mutate(
      {
        file: target,
        onProgress: (percent) => setImportProgress(percent),
      },
      {
        onSuccess: (result) => {
          setPendingImportFile(null);
          setImportProgress(null);
          const pausedTotal =
            result.pausedImConnections + result.pausedSchedules + result.pausedMailAccounts;
          const baseMessage = result.restarting
            ? t('已保存当前状态并开始导入，服务正在重启')
            : t('已保存当前状态并完成导入准备，重启服务后生效');
          if (pausedTotal > 0 && result.clearedCredentials > 0) {
            toastSuccess(
              t('{base}；已暂停 {paused} 项外部触发器，{cleared} 项密钥需重新填写', {
                base: baseMessage,
                paused: pausedTotal,
                cleared: result.clearedCredentials,
              }),
            );
          } else if (pausedTotal > 0) {
            toastSuccess(
              t('{base}；已暂停 {paused} 项外部触发器', {
                base: baseMessage,
                paused: pausedTotal,
              }),
            );
          } else if (result.clearedCredentials > 0) {
            toastSuccess(
              t('{base}；{cleared} 项密钥需重新填写', {
                base: baseMessage,
                cleared: result.clearedCredentials,
              }),
            );
          } else {
            toastSuccess(baseMessage);
          }
        },
        onError: (error) => {
          setImportProgress(null);
          toastError(t('导入失败，请检查备份文件后重试。'), error);
        },
      },
    );
  };

  return (
    <SettingsSection title={t('数据与备份')} testId="account-backup">
      <SettingsCard>
        <SettingsRow
          label={t('自动备份')}
          hint={
            <span className="flex flex-col gap-1">
              <span
                className={statusLine.failed ? 'text-destructive tabular-nums' : 'tabular-nums'}
                data-testid="backup-status-text"
              >
                {statusLine.text}
              </span>
              <span>
                {managed.storage === 'cloud'
                  ? t('每天自动加密备份到独立存储空间，可随时恢复或下载全部数据')
                  : t('每天自动备份，可随时恢复或下载全部数据')}
              </span>
              {statusLine.failed && statusLine.detail !== null && (
                <span>
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-meta text-content-secondary"
                    onClick={() => setReasonOpen((open) => !open)}
                  >
                    {reasonOpen ? t('收起原因') : t('查看原因')}
                  </Button>
                  {reasonOpen && (
                    <span className="mt-1 block font-mono text-meta text-content-tertiary">
                      {statusLine.detail}
                    </span>
                  )}
                </span>
              )}
            </span>
          }
        >
          <Button
            variant="outline"
            size="sm"
            className="min-w-28 pointer-coarse:h-11"
            disabled={busy}
            data-testid="backup-run-now"
            onClick={() =>
              mutations.runNow.mutate(undefined, {
                onSuccess: () => toastSuccess(t('备份已完成')),
                onError: (error) => toastError(t('备份失败，请重试。'), error),
              })
            }
          >
            {backupButtonBusy ? t('正在备份…') : t('立即备份')}
          </Button>
        </SettingsRow>

        <SettingsRow
          label={t('下载全部数据')}
          hint={t('导出所有对话、任务、附件和配置到本地文件（不含密钥文件）')}
        >
          <Button
            variant="outline"
            size="sm"
            className="pointer-coarse:h-11"
            disabled={busy}
            data-testid="backup-export-all"
            onClick={() => void handleExport()}
          >
            {exporting ? t('正在打包…') : t('下载全部数据')}
          </Button>
        </SettingsRow>

        <SettingsRow label={t('导入数据')}>
          <Button
            variant="outline"
            size="sm"
            className="pointer-coarse:h-11"
            disabled={busy}
            data-testid="backup-import-trigger"
            onClick={handlePickImportFile}
          >
            {isImporting ? t('正在导入…') : t('选择备份文件')}
          </Button>
        </SettingsRow>

        <SettingsRow label={t('历史备份')} hint={t('恢复前会自动保存当前状态，选错可一键撤回')}>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1 pointer-coarse:h-11"
            disabled={snapshots.length === 0}
            data-testid="backup-history-toggle"
            onClick={() => setHistoryOpen((open) => !open)}
          >
            {historyOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            {snapshots.length === 0
              ? t('暂无历史备份')
              : historyOpen
                ? t('收起历史备份')
                : t('查看历史备份 ({count})', { count: snapshots.length })}
          </Button>
        </SettingsRow>

        {historyOpen && snapshots.length > 0 && (
          <div
            className="flex flex-col divide-y divide-border px-4 py-1"
            data-testid="backup-history-list"
          >
            {snapshots.map((snapshot) => (
              <div
                key={snapshot.id}
                className="flex items-center justify-between gap-3 py-2.5"
                data-testid="backup-snapshot-row"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-ui text-foreground tabular-nums">
                    {formatBackupTime(snapshot.createdAt, locale, t)}
                  </span>
                  <span className="text-meta text-content-tertiary tabular-nums">
                    {snapshotKindLabel(snapshot.kind, t)} · {formatBackupSize(snapshot.sizeBytes)}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="pointer-coarse:h-11"
                  disabled={busy}
                  onClick={() => setConfirmSnapshot(snapshot)}
                >
                  {t('恢复到这份备份')}
                </Button>
              </div>
            ))}
          </div>
        )}
      </SettingsCard>

      {confirmSnapshot !== null && (
        <DialogShell
          stacked
          title={t('恢复到这份备份')}
          subtitle={t('将把全部对话、任务与设置回滚到 {time} 的状态。', {
            time: formatBackupTime(confirmSnapshot.createdAt, locale, t),
          })}
          onClose={() => setConfirmSnapshot(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirmSnapshot(null)}>
                {t('取消')}
              </Button>
              <Button
                variant="outline"
                className={DIALOG_PRIMARY_BUTTON}
                disabled={mutations.restore.isPending}
                data-testid="backup-restore-confirm"
                onClick={handleRestoreConfirm}
              >
                {t('确认恢复')}
              </Button>
            </>
          }
        >
          <p className="m-0 text-ui text-content-secondary">
            {t(
              '执行恢复前，系统会自动为当前数据留存一份快照。如果恢复后发现选错，随时可以从历史备份一键撤回。',
            )}
          </p>
        </DialogShell>
      )}

      {pendingImportFile !== null && (
        <DialogShell
          stacked
          title={t('确认导入数据')}
          onClose={() => {
            if (!isImporting) {
              setPendingImportFile(null);
              setImportProgress(null);
            }
          }}
          footer={
            <>
              <Button
                variant="ghost"
                disabled={isImporting}
                onClick={() => {
                  setPendingImportFile(null);
                  setImportProgress(null);
                }}
              >
                {t('取消')}
              </Button>
              <Button
                variant="outline"
                className={DIALOG_PRIMARY_BUTTON}
                disabled={isImporting}
                data-testid="backup-import-confirm"
                onClick={handleImportConfirm}
              >
                {isImporting ? t('正在导入…') : t('确认导入')}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-2">
            <p className="m-0 text-ui font-medium tabular-nums text-foreground">
              {pendingImportFile.name} · {formatBackupSize(pendingImportFile.size)}
            </p>
            <p className="m-0 text-ui text-content-secondary">
              {t('导入前会为当前数据留存快照，同时暂停导入的聊天软件连接与定时任务。')}
            </p>
            {isImporting && (
              <p
                className="m-0 text-ui text-content-secondary tabular-nums"
                data-testid="backup-import-progress"
              >
                {importProgress !== null && importProgress < 100
                  ? t('正在上传备份文件 ({percent}%)…', { percent: importProgress })
                  : t('正在校验并导入数据…')}
              </p>
            )}
          </div>
        </DialogShell>
      )}
    </SettingsSection>
  );
}
