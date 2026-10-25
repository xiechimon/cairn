// team chart 组织图 —— 照 todos.dev/app/team 的 chart 布局现场实测重建
// （2026-09-30 DOM 实测）。r7 12 那份捕获的团队是 0 个成员，只留下「暂无成员」
// 空态，树结构从未出现在旧语料里 —— 旧实现把那份空态当成了 chart 的唯一状态。
//
// 树形是渲染约定，不是数据：members 载荷没有层级字段（只有 memberType /
// role / provider / modelId / description），所以根 = 总管绑定的 agent
// （GET teams/{id}/chief 的 chief.agent.agentId），未绑定时退首个成员；其余
// 成员按序落子列。创建 Agent 在页面顶栏，组织图里没有创建节点。
//
// 几何：节点 220×56（Paper 卡，--radius-card）/ 连接线 44×1 / 括号列 28 宽，
// 只有两个以上子节点时才画括号。chart 内部全是无 role 的结构 div，e2e 载体走
// data-testid 二级
// （节点/名字/模型行/皇冠/服务商徽标/连接线/括号/子列），根节点身份由
// 皇冠徽标承载（crown 只渲染在总管绑定 agent 上，即原 --root 修饰类的
// 语义载体）。
import { cn } from 'cn';
import type { SVGProps } from 'react';
import { CARD_RADIUS_CLS } from '../components/settings-list.js';
import { SeededAvatar } from '../components/ui/seeded-avatar.js';
import type { TeamAgentCard } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { TeamAgentsEmpty } from './team-agent-grid.js';

function CrownGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M7 17V13C3.5 13 3 10 5 8 5 5 8 3 12 3s7 2 7 5c2 2 1.5 5-2 5v4" />
      <rect x="7" y="17" width="10" height="3" rx=".75" />
    </svg>
  );
}

/** 服务商徽标字形：逐字抄自参考产品节点第二行（实心 currentColor）。参考账号
 *  里两个 Agent 同属一个服务商，字形一致 —— 采样不足以反推「服务商 → 字形」
 *  的映射表，故照抄实测字形而不臆造映射。 */
function ProviderGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill="currentColor"
      {...props}
    >
      <path d="M2 2h15v10h-5V7H2ZM2 7h5v5h5v5H7v5H2ZM17 12h5v10h-5Z" />
    </svg>
  );
}

/** 节点卡盒：220×56，Paper 卡（白底、--radius-card、1px 环 + 轻投影，与团队
 *  卡、看板任务卡同一套）。 */
const NODE_CLS = cn(
  'flex h-14 w-55 items-center gap-2 bg-card px-2.5 shadow-(--panel-shadow)',
  CARD_RADIUS_CLS,
);

/** 组织图节点卡：32 圆头像 + 两行文本（名字 text-ui 500，第二行 = 服务商徽标
 *  + text-meta 模型行）。 */
function ChartNode({ agent, crown }: { agent: TeamAgentCard; crown?: boolean }) {
  const { t } = useI18n();
  return (
    <div className={NODE_CLS} data-testid="team-chart-node">
      <span className="flex size-8 flex-none overflow-hidden rounded-full bg-card ring-1 ring-border [&_img]:size-8">
        <SeededAvatar
          className="size-8"
          name={agent.displayName}
          src={agent.avatarUrl}
          fallback="/avatar-robot-1.svg"
        />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex h-4.5 min-w-0 items-center gap-1">
          <span
            className="truncate text-ui font-medium text-foreground"
            data-testid="team-chart-name"
          >
            {agent.displayName}
          </span>
          {crown && (
            <span
              className="flex size-4.5 flex-none items-center justify-center rounded-full bg-spot-soft text-(--card-button)"
              data-testid="team-chart-crown"
            >
              <CrownGlyph />
            </span>
          )}
        </span>
        <span className="flex h-4.5 min-w-0 items-center gap-1">
          {agent.provider ? (
            <span
              className="flex size-4.5 flex-none items-center justify-center rounded-full bg-muted text-foreground"
              data-testid="team-chart-provider"
            >
              <ProviderGlyph />
            </span>
          ) : null}
          <span className="truncate text-meta text-content-tertiary" data-testid="team-chart-model">
            {agent.model}
            {agent.isDefault ? t(' · 默认') : ''}
          </span>
        </span>
      </span>
    </div>
  );
}

/** chart 布局的整块内容：零成员 = 空态（与 grid 同一件），否则出树。两条分支
 *  收在同一处，调用方不必自己按成员数分流。 */
export function TeamChart({
  agents,
  chiefAgentId,
}: {
  agents: TeamAgentCard[];
  chiefAgentId: string | null;
}) {
  const root = agents.find((a) => a.id === chiefAgentId) ?? agents[0];
  if (!root) return <TeamAgentsEmpty />;
  const subordinates = agents.filter((a) => a.id !== root.id);
  return (
    <div className="flex items-center">
      <ChartNode agent={root} crown />
      {subordinates.length > 0 && (
        <>
          <div className="h-px w-11 flex-none bg-input" data-testid="team-chart-link" />
          <div className="flex" data-testid="team-chart-children">
            {/* 括号列本身不画东西，只给绝对定位的括号当坐标架：高度随子列撑满，
                于是括号 top/bottom 各留半个卡片高（28），正好落在首/末子节点的
                垂直中心上。只有一个子节点时连接线直连，不画括号。 */}
            {subordinates.length > 1 && (
              <div className="relative w-7 flex-none">
                <div
                  className="absolute top-7 bottom-7 left-0 w-7 rounded-l-md border border-r-0 border-input"
                  data-testid="team-chart-bracket"
                />
              </div>
            )}
            <div className="flex flex-col gap-2" data-testid="team-chart-nodes">
              {subordinates.map((a) => (
                <ChartNode key={a.id} agent={a} />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
