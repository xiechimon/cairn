import { Globe, Laptop, MonitorSmartphone, Plus, Server } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ListCard } from '../components/list-card.js';
import { SidePanel, SidePanelHead, SidePanelTitle } from '../components/side-panel.js';
import { ToggleSwitch } from '../components/toggle-switch.js';
import { Badge } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import type { MachineRow } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { CoordinatorComputer } from './computer-feed.js';

export function coordinatorMachine(machines: readonly MachineRow[]): MachineRow | null {
  return (
    machines.find((machine) => machine.chiefHost === true) ??
    machines.find((machine) => machine.kind === 'local') ??
    machines[0] ??
    null
  );
}

function runningLabel(machine: MachineRow, t: ReturnType<typeof useI18n>['t']): string {
  if (machine.online !== true) return t('离线');
  const running = machine.runningSteps ?? 0;
  if (running === 0) return t('空闲');
  return machine.maxConcurrent != null
    ? t('{n}/{max} 在跑', { n: running, max: machine.maxConcurrent })
    : t('{n} 在跑', { n: running });
}

function OnlineDot({ online }: { online: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`size-1.5 flex-none rounded-full ${online ? 'bg-running' : 'bg-content-dim'}`}
    />
  );
}

export function MachineChip({
  machines,
  open,
  onToggle,
}: {
  machines: readonly MachineRow[];
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  const host = coordinatorMachine(machines);
  const running = machines.reduce((sum, machine) => sum + (machine.runningSteps ?? 0), 0);
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-pressed={open}
      onClick={onToggle}
      data-testid="machines-button"
      className="mr-1 h-7 gap-1.5 rounded-full px-2.5 text-meta font-normal text-content-secondary hover:text-foreground aria-pressed:bg-(--hover-1) aria-pressed:text-foreground"
    >
      <Laptop aria-hidden="true" className="size-3.5" />
      <span className="max-w-32 truncate max-[640px]:sr-only">{host?.name ?? t('电脑')}</span>
      <OnlineDot online={host?.online === true} />
      {running > 0 && (
        <span className="text-content-tertiary tabular-nums max-[640px]:hidden">
          {t('{n} 在跑', { n: running })}
        </span>
      )}
      {machines.length > 1 && (
        <span className="text-content-tertiary tabular-nums max-[640px]:hidden">
          +{machines.length - 1}
        </span>
      )}
    </Button>
  );
}

function CapabilityRow({
  icon,
  label,
  hint,
  installed,
}: {
  icon: ReactNode;
  label: string;
  hint: string;
  installed: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-3 px-3.5 py-2.5">
      <span className="flex-none text-content-tertiary">{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-1.5 text-ui text-foreground">
          {label}
          <Badge variant="secondary" className="font-normal text-content-tertiary">
            {installed ? t('已安装') : t('未安装')}
          </Badge>
        </span>
        <span className="text-meta text-content-tertiary">{hint}</span>
      </span>
      <ToggleSwitch checked={false} disabled aria-label={label} />
    </div>
  );
}

function MachineCard({ machine, coordinator }: { machine: MachineRow; coordinator: boolean }) {
  const { t } = useI18n();
  const online = machine.online === true;
  const Icon = machine.kind === 'local' ? Laptop : Server;
  return (
    <ListCard className="flex-none">
      <div
        data-testid="machine-screen"
        className={`grid place-items-center bg-(--surface-1) px-6 text-center text-meta text-content-tertiary ${online ? 'aspect-[16/10]' : 'h-16'}`}
      >
        <span className={`flex items-center gap-2 ${online ? 'flex-col' : ''}`}>
          <MonitorSmartphone aria-hidden="true" className="size-5 opacity-60" />
          {online ? t('屏幕随桌面控制一起上线，到时显示在这里') : t('电脑离线')}
        </span>
      </div>
      <div className="flex items-center gap-3 px-3.5 py-3">
        <Icon aria-hidden="true" className="size-4.5 flex-none text-content-secondary" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-ui font-medium text-foreground">{machine.name}</span>
            {coordinator && (
              <Badge variant="secondary" className="font-normal">
                {t('Coordinator 在这台')}
              </Badge>
            )}
          </span>
          <span className="flex items-center gap-1.5 text-meta text-content-tertiary">
            <OnlineDot online={online} />
            {runningLabel(machine, t)}
          </span>
        </span>
      </div>
      <CapabilityRow
        icon={<MonitorSmartphone aria-hidden="true" className="size-4" />}
        label={t('桌面控制')}
        hint={t('让 agent 操作这台电脑上的应用。macOS 要在辅助功能里授权。')}
        installed={false}
      />
      <CapabilityRow
        icon={<Globe aria-hidden="true" className="size-4" />}
        label={t('浏览器')}
        hint={t('让 agent 打开网页、点击和填表。')}
        installed={false}
      />
    </ListCard>
  );
}

export function MachinesPanel({
  machines,
  onClose,
}: {
  machines: readonly MachineRow[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const host = coordinatorMachine(machines);
  const ordered = host === null ? machines : [host, ...machines.filter((m) => m !== host)];
  return (
    <SidePanel label={t('电脑')} onDismiss={onClose}>
      <SidePanelHead closeLabel={t('关闭')} onClose={onClose}>
        <SidePanelTitle>{t('电脑')}</SidePanelTitle>
      </SidePanelHead>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pt-3 pb-4">
        {ordered.length <= 1 && (
          <p className="m-0 px-1 text-meta text-content-tertiary">
            {t('没有其他电脑时，任务都在 Coordinator 这台电脑上跑。')}
          </p>
        )}
        <CoordinatorComputer />
        {ordered.map((machine) => (
          <MachineCard
            key={machine.id ?? machine.name}
            machine={machine}
            coordinator={machine === host}
          />
        ))}
        <Button
          variant="ghost"
          size="sm"
          className="self-start text-meta text-content-secondary"
          render={<Link to="/app/resources/machines" />}
        >
          <Plus aria-hidden="true" className="size-3.5" />
          {t('添加电脑')}
        </Button>
      </div>
    </SidePanel>
  );
}
