// #1259 团队 agent 卡网格（team-page 与机器详情页共用）：卡 = 进 Agent 详情
// 面的链接（#485）。Paper 卡（DESIGN.md「页面模式 · 卡片圆角」）：白底、
// --radius-card、1px 环 + 看板任务卡同一层轻投影；内容 = 头像 + 名字 + 一行
// 元信息（模型 · 归属机）+ 归属机状态（图标 + 颜色 + 文字）。

import { cn } from 'cn';
import { Bot, CircleAlert, CircleDashed, CircleDot, type LucideIcon, Plus } from 'lucide-react';
import { Link } from 'react-router';
import { TOPBAR_TEXT_BUTTON } from '../board/filter-panel.js';
import { EmptyState } from '../components/empty-state.js';
import { CARD_RADIUS_CLS } from '../components/settings-list.js';
import { Button } from '../components/ui/button.js';
import { SeededAvatar } from '../components/ui/seeded-avatar.js';
import type { MachineRow, TeamAgentCard } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { AGENTS_HREF } from '../routes/agent-detail-page.js';

const AGENT_CARD_CLS = cn(
  'flex min-w-0 items-center gap-3 bg-card px-3.5 py-3 text-inherit no-underline shadow-(--panel-shadow) transition-[box-shadow] duration-150 ease-out hover:shadow-(--panel-shadow-hover)',
  CARD_RADIUS_CLS,
);

type MachineStatus = 'online' | 'offline' | 'unassigned';

const STATUS_FACE: Record<MachineStatus, { icon: LucideIcon; label: string; cls: string }> = {
  online: { icon: CircleDot, label: '在线', cls: 'text-running-text' },
  offline: { icon: CircleDashed, label: '离线', cls: 'text-content-tertiary' },
  unassigned: { icon: CircleAlert, label: '未设归属机', cls: 'text-(--card-button)' },
};

interface TeamAgentGridProps {
  agents: TeamAgentCard[];
  /** 归属机名与在线态的解析源（machineId → row）；可省 = 不出归属机与状态。 */
  machines?: MachineRow[];
  /** 网格自带的创建入口（机器详情页）；团队页的创建在顶栏，不传。 */
  onCreate?: () => void;
  /** Link 律（#121）：scenario 串随行。 */
  search: string;
  /** fixture 删除覆面（#66）：删掉的卡隐去。 */
  isDeleted?: (id: string) => boolean;
}

/** 零 Agent 空态：团队页 grid 与 chart 两种布局共用。 */
export function TeamAgentsEmpty({ onCreate }: { onCreate?: () => void }) {
  const { t } = useI18n();
  return (
    <EmptyState
      icon={Bot}
      title={t('暂无成员')}
      description={t('创建 Agent 后，它会出现在这里。')}
      action={onCreate === undefined ? undefined : { label: t('创建 Agent'), onClick: onCreate }}
      testId="team-agents-empty"
    />
  );
}

export function TeamAgentGrid({
  agents,
  machines,
  onCreate,
  search,
  isDeleted,
}: TeamAgentGridProps) {
  const { t } = useI18n();
  const visible = agents.filter((agent) => !(isDeleted?.(agent.id) ?? false));
  const machineOf = (machineId: string | null | undefined) =>
    machineId == null ? undefined : machines?.find((m) => m.id === machineId);
  return (
    <div className="flex flex-col gap-3" data-testid="team-agent-grid">
      {visible.length === 0 ? (
        <TeamAgentsEmpty onCreate={onCreate} />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {visible.map((agent) => {
            const machine = machineOf(agent.machineId);
            const status: MachineStatus | null =
              machines === undefined
                ? null
                : machine === undefined
                  ? 'unassigned'
                  : machine.online === false
                    ? 'offline'
                    : 'online';
            const face = status === null ? null : STATUS_FACE[status];
            const meta = [
              agent.model + (agent.isDefault ? t(' · 默认') : ''),
              machine?.name,
            ].filter((part) => part != null && part !== '');
            return (
              <Link
                key={agent.id}
                className={AGENT_CARD_CLS}
                data-testid="team-agent-card"
                to={{ pathname: `${AGENTS_HREF}/${agent.id}`, search }}
              >
                <span className="flex size-10 flex-none overflow-hidden rounded-full bg-card ring-1 ring-border [&_img]:size-10">
                  <SeededAvatar
                    className="size-10"
                    name={agent.displayName}
                    src={agent.avatarUrl}
                    fallback="/avatar-robot-1.svg"
                  />
                </span>
                <span className="flex min-w-0 flex-auto flex-col">
                  <span className="truncate text-card-title font-medium text-foreground">
                    {agent.displayName}
                  </span>
                  <span
                    className="truncate text-meta text-content-tertiary"
                    data-testid="team-agent-meta"
                  >
                    {meta.join(' · ')}
                  </span>
                </span>
                {face !== null && (
                  <span
                    className={cn('flex flex-none items-center gap-1 text-meta', face.cls)}
                    data-testid="team-card-status"
                    data-status={status}
                  >
                    <face.icon className="size-3.25" strokeWidth={1.75} aria-hidden="true" />
                    {t(face.label)}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      )}
      {visible.length > 0 && onCreate !== undefined && (
        <Button variant="ghost" className={cn(TOPBAR_TEXT_BUTTON, 'self-start')} onClick={onCreate}>
          <Plus className="size-3.5" strokeWidth={1.75} />
          {t('创建 Agent')}
        </Button>
      )}
    </div>
  );
}
