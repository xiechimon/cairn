// #1259 团队 agent 卡网格（team-page 与机器详情页共用）：卡 = 进 Agent 详情
// 面的链接（#485）；行 = 名 + 模型 + 职责 + 归属机（绑定模型下机器归属的
// 可见面）。创建槽 = 虚线「创建 Agent」行。

import { Link } from 'react-router';
import { Button } from '../components/ui/button.js';
import { SeededAvatar } from '../components/ui/seeded-avatar.js';
import type { MachineRow, TeamAgentCard } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { PlusSmall } from '../icons/index.js';
import { AGENTS_HREF } from '../routes/agent-detail-page.js';

const CREATE_SLOT_CLS = 'h-[76px] border-dashed text-(--text-tertiary)';

/** Agent 卡（#485：进详情面的链接）：#1005 registry 对齐——皮肤取 Card 件
 *  默认配方（rounded-xl / bg-card / ring-1 ring-foreground/10，#983 panel
 *  判决的同一套官方几何），76px 卡盒是 layout；hover 环加深一档做链接反馈。 */
const AGENT_CARD_CLS =
  'flex h-[76px] items-center gap-3 rounded-xl bg-card px-4 text-inherit no-underline ring-1 ring-foreground/10 hover:ring-foreground/25';

interface TeamAgentGridProps {
  agents: TeamAgentCard[];
  /** 归属机名解析源（machineId → name）；可省 = 归属机行不渲染。 */
  machines?: MachineRow[];
  onCreate?: () => void;
  /** Link 律（#121）：scenario 串随行。 */
  search: string;
  /** fixture 删除覆面（#66）：删掉的卡隐去。 */
  isDeleted?: (id: string) => boolean;
}

export function TeamAgentGrid({
  agents,
  machines,
  onCreate,
  search,
  isDeleted,
}: TeamAgentGridProps) {
  const { t } = useI18n();
  const machineName = (machineId: string | null | undefined) =>
    machineId == null ? null : (machines?.find((m) => m.id === machineId)?.name ?? null);
  return (
    <div className="mt-[9px] grid grid-cols-2 gap-3" data-testid="team-agent-grid">
      {agents
        .filter((agent) => !(isDeleted?.(agent.id) ?? false))
        .map((agent) => (
          <Link
            key={agent.id}
            className={AGENT_CARD_CLS}
            data-testid="team-agent-card"
            to={{ pathname: `${AGENTS_HREF}/${agent.id}`, search }}
          >
            <span className="flex size-[52px] flex-none items-center justify-center overflow-hidden rounded-full bg-(--secondary) [&_img]:size-[52px]">
              <SeededAvatar
                className="size-[52px]"
                name={agent.displayName}
                src={agent.avatarUrl}
                fallback="/avatar-robot-1.svg"
              />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="text-sm leading-[18px] font-medium text-(--foreground)">
                {agent.displayName}
              </span>
              <span className="text-[11px] leading-[18px] text-(--text-tertiary)">
                {agent.model}
                {agent.isDefault ? t(' · 默认') : ''}
                {/* #1259 归属机行：钉在模型行尾（同一视线行）；未设归属机 =
                    指名警示（不可领步）。 */}
                {machines !== undefined &&
                  (machineName(agent.machineId) !== null
                    ? // biome-ignore lint/style/noNonNullAssertion: outer !== null guard above; ternary is the non-null branch
                      t(' · 归属机 {machine}', { machine: machineName(agent.machineId)! })
                    : t(' · 未设归属机'))}
              </span>
              <span
                className="line-clamp-2 text-xs leading-4 text-(--text-tertiary)"
                title={agent.role ?? undefined}
              >
                {agent.role ?? t('未设置职责')}
              </span>
            </span>
          </Link>
        ))}
      {onCreate !== undefined && (
        <Button variant="outline" className={CREATE_SLOT_CLS} onClick={onCreate}>
          <span className="flex size-5 items-center justify-center rounded-full border border-current">
            <PlusSmall className="size-3" />
          </span>
          {t('创建 Agent')}
        </Button>
      )}
    </div>
  );
}
