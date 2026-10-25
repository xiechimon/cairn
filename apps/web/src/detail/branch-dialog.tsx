import type { BranchSyncRecord, BranchSyncStatus, MachineRecord } from '@cairn/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cn } from 'cn';
import { useState } from 'react';
import { api } from '../api/client.js';
import { useBuild, useMachines } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { SegmentedTabs } from '../components/segmented.js';
import { Button } from '../components/ui/button.js';
import { DIALOG_PRIMARY_BUTTON, DialogShell } from '../components/ui/dialog-shell.js';
import { Input } from '../components/ui/input.js';
import { Label } from '../components/ui/label.js';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover.js';
import { Switch } from '../components/ui/switch.js';
import { toastError } from '../components/ui/toaster.js';
import type { BranchInfoContent } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { ChevronDown, Copy } from '../icons/index.js';

export const READONLY_BOX =
  'flex h-8 items-center rounded-lg border border-input px-2.5 font-mono text-xs text-(--text-tertiary)';

export const MACHINE_DOT = 'size-1.5 flex-none rounded-full bg-(--badge-done)';

interface BranchDialogProps {
  open?: boolean;
  info: BranchInfoContent;
  buildId?: string | null;
  onClose: () => void;
}

function CopyButton({ value }: { value: string }) {
  const { t } = useI18n();
  const copy = () => {
    void navigator.clipboard?.writeText(value).catch(() => {});
  };
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      className="flex-none"
      aria-label={t('复制')}
      onClick={copy}
    >
      <Copy width={14} height={14} />
    </Button>
  );
}

export function BranchBox({ info }: { info: BranchInfoContent }) {
  const { t } = useI18n();
  const row = 'flex h-10 items-center gap-1 pr-2 pl-3';
  const label = 'w-19 flex-none text-xs text-(--text-tertiary)';
  const value = 'min-w-0 flex-1 truncate font-mono text-xs text-(--foreground)';
  return (
    <div className="overflow-hidden rounded-lg border border-input">
      <div className={row}>
        <span className={label}>{t('构建分支')}</span>
        <span className={value}>{info.branch}</span>
        <CopyButton value={info.branch} />
      </div>
      <div className={`${row} border-t border-input`}>
        <span className={label}>{t('目标提交')}</span>
        <span className={value}>{info.commit}</span>
        <CopyButton value={info.commit} />
      </div>
    </div>
  );
}

export function BranchSyncFields({
  info,
  canSync,
  machines,
  selectedMachineId,
  onMachineId,
  directory,
  onDirectory,
  force,
  onForce,
  buildId,
}: {
  info: BranchInfoContent;
  canSync: boolean;
  machines: MachineRecord[];
  selectedMachineId: string | null;
  onMachineId: (id: string) => void;
  directory: string;
  onDirectory: (directory: string) => void;
  force: boolean;
  onForce: (force: boolean) => void;
  buildId: string | null;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-4">
      <BranchBox info={info} />
      <div className="flex flex-col gap-2">
        <Label className="leading-tight">{t('目标机器')}</Label>
        {canSync ? (
          <MachinePicker
            machines={machines}
            selected={selectedMachineId}
            onSelect={onMachineId}
            t={t}
          />
        ) : (
          <Button variant="outline" className="w-fit" disabled>
            <span className={MACHINE_DOT} />
            <span>{info.machine}</span>
            <ChevronDown width={12} height={12} />
          </Button>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="branch-sync-directory" className="leading-tight">
          {t('同步目录')}
        </Label>
        {canSync ? (
          <Input
            id="branch-sync-directory"
            type="text"
            aria-label={t('同步目录')}
            className="font-mono text-xs md:text-xs"
            value={directory}
            onChange={(event) => onDirectory(event.target.value)}
            spellCheck={false}
          />
        ) : (
          <div className={READONLY_BOX}>{info.directory}</div>
        )}
      </div>
      <div className="flex items-start gap-3">
        <div className="flex flex-1 flex-col gap-1">
          <Label className="text-sm leading-tight">{t('强制同步')}</Label>
          <div className="text-meta text-(--text-tertiary)">
            {t('丢弃代码修改并删除非忽略的未跟踪文件；保留忽略内容。仅本次生效。')}
          </div>
        </div>
        <Switch
          className="mt-1 flex-none"
          aria-label={t('强制同步')}
          checked={force}
          onCheckedChange={onForce}
        />
      </div>
      {canSync && buildId !== null ? <ResultCard buildId={buildId} t={t} /> : null}
    </div>
  );
}

export function defaultMachineId(
  machines: MachineRecord[],
  override: string | null,
  infoMachine: string,
): string | null {
  return override ?? machines.find((m) => m.name === infoMachine)?.id ?? machines[0]?.id ?? null;
}

export function useBranchSyncState(
  info: BranchInfoContent,
  buildId: string | null,
  machinesEnabled = true,
) {
  const { live, teamId } = useLiveData();
  const machinesQ = useMachines(teamId, live && machinesEnabled);
  const [force, setForce] = useState(false);
  const [machineId, setMachineId] = useState<string | null>(null);
  const [directory, setDirectory] = useState(info.directory);
  const machines: MachineRecord[] = machinesQ.data ?? [];
  return {
    live,
    machines,
    selectedMachineId: defaultMachineId(machines, machineId, info.machine),
    onMachineId: setMachineId,
    directory,
    onDirectory: setDirectory,
    force,
    onForce: setForce,
    canSync: buildId !== null && live,
  };
}

export function BranchDialog({ info, buildId: buildIdProp, open, onClose }: BranchDialogProps) {
  const { t } = useI18n();
  const buildId = buildIdProp ?? null;
  const [tab, setTab] = useState<'sync' | 'git'>('sync');
  const sync = useBranchSyncState(info, buildId, open === true);
  const buildQ = useBuild(buildId, buildId != null);
  const pr = buildQ.data?.prUrl ?? null;
  const prNumber = buildQ.data?.prNumber ?? null;

  return (
    <DialogShell
      headerCenter={
        <SegmentedTabs
          label={t('分支与 PR')}
          value={tab}
          onChange={setTab}
          options={[
            { value: 'sync', label: t('同步到机器') },
            { value: 'git', label: 'Git' },
          ]}
        />
      }
      open={open}
      onClose={onClose}
      size="m"
      footer={
        tab === 'sync' ? (
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
        ) : undefined
      }
    >
      {tab === 'sync' ? (
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
      ) : (
        <div className="flex flex-col gap-4">
          <BranchBox info={info} />
          <div className="flex flex-col gap-2">
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
        </div>
      )}
    </DialogShell>
  );
}

function MachinePicker({
  machines,
  selected,
  onSelect,
  t,
}: {
  machines: MachineRecord[];
  selected: string | null;
  onSelect: (id: string) => void;
  t: (k: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const cur = machines.find((m) => m.id === selected);
  const list = machines.filter((m) => m.online);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button variant="outline" className="w-fit" aria-haspopup="listbox" />}
      >
        <span className={MACHINE_DOT} data-on={cur?.online ?? false} />
        <span>{cur?.name ?? t('选择机器')}</span>
        <ChevronDown width={12} height={12} />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--anchor-width) min-w-44 gap-0 p-1">
        <div role="listbox" aria-label={t('目标机器')}>
          {list.length === 0 ? (
            <div className="px-1.5 py-1 text-sm text-(--text-tertiary)">{t('暂无在线机器')}</div>
          ) : (
            list.map((m) => (
              <Button
                variant="ghost"
                key={m.id}
                className="w-full justify-start font-normal"
                data-active={m.id === selected}
                onClick={() => {
                  onSelect(m.id);
                  setOpen(false);
                }}
              >
                <span className={MACHINE_DOT} data-on={m.online} />
                <span>{m.name}</span>
              </Button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function SyncButton({
  buildId,
  canSync,
  machineId,
  directory,
  refName,
  commit,
  force,
  disabled,
}: {
  buildId: string | null;
  canSync: boolean;
  machineId: string | null;
  directory: string;
  refName: string;
  commit: string;
  force: boolean;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const mut = useMutation({
    mutationFn: (input: {
      machineId: string;
      directory: string;
      ref: string;
      commit: string;
      force: boolean;
    }) =>
      api.post<BranchSyncRecord>(`/api/builds/${buildId}/branch-sync`, {
        machineId: input.machineId,
        directory: input.directory,
        ref: input.ref,
        commit: input.commit,
        force: input.force,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['branchSync', buildId] });
    },
    onError: (error) => toastError(t('同步失败，请重试。'), error),
  });
  const live = canSync && buildId !== null && machineId !== null;
  return (
    <Button
      className={DIALOG_PRIMARY_BUTTON}
      disabled={!live || disabled || mut.isPending}
      onClick={() => {
        if (!live || buildId === null || machineId === null) return;
        mut.mutate({ machineId, directory, ref: refName, commit, force });
      }}
    >
      {t('同步')}
    </Button>
  );
}

function ResultCard({ buildId, t }: { buildId: string; t: (k: string) => string }) {
  const syncQ = useQuery({
    queryKey: ['branchSync', buildId],
    queryFn: () => api.get<BranchSyncRecord | null>(`/api/builds/${buildId}/branch-sync`),
  });
  const live: BranchSyncRecord | null = syncQ.data ?? null;
  if (!live) return null;
  return <ResultCardBody record={live} t={t} />;
}

function ResultCardBody({ record, t }: { record: BranchSyncRecord; t: (k: string) => string }) {
  const statusLabel: Record<BranchSyncStatus, string> = {
    pending: t('等待中'),
    running: t('正在同步…'),
    synced: t('已同步'),
    failed: t('同步失败'),
  };
  return (
    <div data-status={record.status}>
      <div>{statusLabel[record.status]}</div>
      {record.errorMessage !== null && record.status === 'failed' ? (
        <div>{record.errorMessage}</div>
      ) : null}
      <div>
        {record.commit.slice(0, 12)} · {record.directory}
      </div>
    </div>
  );
}
