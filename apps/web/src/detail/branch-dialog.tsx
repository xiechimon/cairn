// 分支与 PR dialog (issue #68, r7 31): 448 宽居中，header 承载居中的
// 同步到机器|Git segmented control（registry Tabs 件）。Sync tab：
// build-branch/target-commit box + copy 钮、目标机器 picker（registry
// Popover 组合）、同步目录 Input、强制同步 Label + 说明 + Switch、满宽同步钮。
// M7 #319（08 册附录 B）= 接真：机器选择走 useMachines 真值
// （GET /api/teams/{id}/machines），目录可编辑（r1 changelog 09-13 文本），
// 同步钮 POST /api/builds/{id}/branch-sync + 订阅 team stream `branch_sync`
// 事件渲染结果卡（pending/running/synced/failed 四态）。Git tab 仍是 [推断]
// minimal PR surface，复用同 box。
// #366：详情路由不再弹此 dialog（右 pane 静止 section 承接，字段件
// BranchBox/BranchSyncFields/SyncButton 由 right-pane.tsx 共用）；本 dialog
// 的存活入口 = 看板卡片分支图标。
//
// #1006 原型（#980 前提②④，#983 判决表）：手写皮律常量（FIELD_LABEL /
// DIR_BOX / MACHINE_PILL 冻结几何 + 七通道中和串）退役——字段标签走
// registry Label 件、输入走 Input 默认形态、机器 pill 走 Button outline
// 默认档 + Popover 锚定组合（#983「锚定 absolute 族 → Popover」同族判例）、
// 同步钮走 Button default 档（--spot-disabled 漆面恒压退役，disabled 走
// registry opacity 降档）。保留的是语义映射与 layout 位：数据 mono 排版、
// 机器状态点 token 色、满宽同步钮。

import type { BranchSyncRecord, BranchSyncStatus, MachineRecord } from '@pacman/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cn } from 'cn';
import { useState } from 'react';
import { api } from '../api/client.js';
import { useBuild, useMachines } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { Button } from '../components/ui/button.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import { Input } from '../components/ui/input.js';
import { Label } from '../components/ui/label.js';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover.js';
import { Switch } from '../components/ui/switch.js';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs.js';
import { toastError } from '../components/ui/toaster.js';
import type { BranchInfoContent } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { ChevronDown, Copy } from '../icons/index.js';

/** #1006 原型：只读目录/PR 槽的盒子 geometry 与 registry Input 默认档对齐
 *  （h-8 rounded-lg border-input px-2.5）——只读值展示不是控件，用 div 承
 *  Input 的 layout 语言；mono 12 是路径/提交数据的排版语义（content 位）。
 *  branch-dialog 与 right-pane 两消费面共用。 */
export const READONLY_BOX =
  'flex h-8 items-center rounded-lg border border-input px-2.5 font-mono text-xs text-(--text-tertiary)';

/** #951：机器状态点（原 .dlg-machine-dot，6px 圆 / done 绿）。data-on 是
 *  在线态行为载体（无 CSS 消费，读面语义保留）。 */
export const MACHINE_DOT = 'size-1.5 flex-none rounded-full bg-(--badge-done)';

interface BranchDialogProps {
  /** #73 retained-mount open flag. */
  open?: boolean;
  info: BranchInfoContent;
  /**
   * M7 #319：分支对话框接真的 bridge。`buildId` 走 POST/GET 路径段。
   *
   * `buildId` **必须由调用方传**：live 数据层只暴露 { live, teamId }，派生不出
   * 当前 todo 的 build。调用点（board-page）持 `overlayTodo.latestBuildId`
   * 传入；漏传 = buildId 恒 null = canSync 恒 false = 同步面永远停在 r7
   * 占位 UI（同步钮不可点）。
   */
  buildId?: string | null;
  onClose: () => void;
}

function CopyButton({ value }: { value: string }) {
  const { t } = useI18n();
  const copy = () => {
    void navigator.clipboard?.writeText(value).catch(() => {
      // clipboard unavailable (headless/permissions) — copy is best-effort
    });
  };
  return (
    // #1006 原型：icon 钮 = registry ghost/icon-xs 默认档（24×24 是 size 档
    // 正典值），透明底/tertiary 墨/hover 增亮的逐值中和串退役——hover 走
    // ghost 底座 bg-muted 反馈。
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

/** 构建分支/目标提交 box（r7 31）——dialog 与详情右 pane 的 分支与 PR
 *  section（#366）共用。#1006 原型：方角 per-face 盒退役，圆角/描边走
 *  registry 控件语言（rounded-lg border-input），行律是 layout 位。 */
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

/** Sync-tab field stack（受控件）：box + 目标机器 + 同步目录 + 强制同步 +
 *  结果卡。dialog（footer 钉同步钮）和右 pane section（inline 同步钮）
 *  各自持 state 后走同一份字段渲染（#366 抽取，M7 #319 接真行为不变）。
 *  #1006 原型：字段栈 = registry Field 语言的 layout 等价形（纵向 gap-4，
 *  Label 件承载字段名）。 */
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
        {/* CJK 标签行高修正（leading-none → 1.25，墨盒不贴行底被 focus 环压
            住）：就地 className，Label 件保持 pristine（#980 S5 棘轮）。 */}
        <Label className="leading-tight">{t('目标机器')}</Label>
        {canSync ? (
          <MachinePicker
            machines={machines}
            selected={selectedMachineId}
            onSelect={onMachineId}
            t={t}
          />
        ) : (
          // fixture / fixture 路径占位（r7 31 原始捕获面）：outline 默认档 +
          // registry disabled 降档（老面「无禁用降档」的中性化退役——禁用态
          // 就该长得禁用，前提④）。
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
          // XMON-24：目录输入 = registry Input 默认形态；mono 是路径数据的
          // 排版语义。aria-label 与 label 关联双载体（m7 集成钉 aria-label，
          // #910 裁定 1——行为契约不动）。
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
        {/* #951（spec/22 §1.6/§4-2）：手搓拨杆已收编 components/ui Switch
            正典默认档；mt 对齐是 layout 位（track 中心对齐 desc 首行）。 */}
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

/** 机器默认选派生：info.machine 同名命中优先，否则首台机器，否则 null。 */
export function defaultMachineId(
  machines: MachineRecord[],
  override: string | null,
  infoMachine: string,
): string | null {
  return override ?? machines.find((m) => m.name === infoMachine)?.id ?? machines[0]?.id ?? null;
}

/** 分支同步面共享状态（#366 抽取）：机器/目录/强制三件 + 默认选派生 +
 *  canSync。dialog（machines 查询随 open 门控）与右 pane section（挂载即
 *  查）走同一状态形，避免两处漂移。 */
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
  // #704 / B-C16：PR 槽真值 = build 行回填的 prUrl/prNumber（daemon 步收尾
  // 只读探测上报）。buildId 缺席（fixture 面/live 无 build）或探测失败（null）
  // = 保持「未创建」诚实态——面板分支名在、PR 槽留空，不造数据。
  const buildQ = useBuild(buildId, buildId != null);
  const pr = buildQ.data?.prUrl ?? null;
  const prNumber = buildQ.data?.prNumber ?? null;

  return (
    <DialogShell
      headerCenter={
        // #945（正典表 §5.4）：seg 走 Tabs 件 default 档（registry 几何）。
        // #138 家族 hover tint 保留在消费端 utility（--seg-hover token 承载，
        // 未选中档专属）——前提④「用户自行决定只经 token 层生效」的合法
        // 通道，非手写皮肤；registry TabsTrigger 自带的 hover:text 反馈
        // 同时生效。选中态载体 = role=tab + aria-selected + data-active
        // （Base UI 自带）不动。
        <Tabs value={tab} onValueChange={(value) => setTab(value as 'sync' | 'git')}>
          <TabsList aria-label={t('分支与 PR')}>
            <TabsTrigger
              value="sync"
              className={
                tab === 'sync' ? undefined : 'hover:bg-(--seg-hover) dark:hover:bg-(--seg-hover)'
              }
            >
              {t('同步到机器')}
            </TabsTrigger>
            <TabsTrigger
              value="git"
              className={
                tab === 'git' ? undefined : 'hover:bg-(--seg-hover) dark:hover:bg-(--seg-hover)'
              }
            >
              Git
            </TabsTrigger>
          </TabsList>
        </Tabs>
      }
      open={open}
      onClose={onClose}
      footer={
        // #193: the sync tab's 同步 button rides the pinned shell footer
        // （registry DialogFooter band）; the git tab carries no action and
        // no footer.
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
              // #704 PR 槽回填态：同 box 形，链接色 + 下划线（原 .dlg-pr-link）。
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
  // #1006 原型（#983「锚定 absolute 族 → Popover」同族判例）：手搓 inline
  // listbox（无外点关、无锚定、撑开 body）→ registry Popover 组合——锚定
  // Positioner、外点/Esc 关、焦点管理归原语；触发钮 = outline 默认档。
  // role=listbox/option 与 data-on 行为载体不动（m7 集成钉）。
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
              // 菜单行 = ghost 默认档（hover/focus:bg-muted 原生反馈），
              // 行几何是 layout 位；data-active 选中载体不动。
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

/** 同步钮（POST branch-sync）——dialog footer 与右 pane section（#366）
 *  共用；disabled 律由调用方派生（机器/目录齐备才可点）。#1006 原型：
 *  --spot-disabled 漆面恒压退役（enabled/disabled 同漆面是反语义的老面），
 *  走 Button default 档 + registry disabled 降档；满宽是 layout 位。 */
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
    // #638（普查账外、验收 grep 命中）：POST 入队被拒（409/5xx/网络）此前
    // 全静默。ResultCard 的红字是机器异步失败（record.status='failed'）的
    // 既有 canon 位——与 POST 失败分属两个阶段，不重叠、不双报。
    onError: (error) => toastError(t('同步失败，请重试。'), error),
  });
  const live = canSync && buildId !== null && machineId !== null;
  return (
    <Button
      className="w-full"
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

/** 结果卡：初始 GET + team stream `branch_sync` 事件失效重取。
 *  record.status 四态（pending / running / synced / failed）；无 record = 不渲染卡。 */
function ResultCard({ buildId, t }: { buildId: string; t: (k: string) => string }) {
  const syncQ = useQuery({
    queryKey: ['branchSync', buildId],
    queryFn: () => api.get<BranchSyncRecord | null>(`/api/builds/${buildId}/branch-sync`),
  });
  // team stream branch_sync events are subscribed at LiveDataBridge root level
  // (api/sse.ts); this card only reads the cache.
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
  // #951：result 卡类名钩退役（全仓零规则零 pin 的死类）；data-status 是
  // 状态行为载体，保留。
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
