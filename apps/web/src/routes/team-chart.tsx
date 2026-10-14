// team chart 组织图 —— 照 todos.dev/app/team 的 chart 布局现场实测重建
// （2026-09-30 DOM 实测）。r7 12 那份捕获的团队是 0 个成员，只留下「暂无成员」
// 空态，树结构从未出现在旧语料里 —— 旧实现把那份空态当成了 chart 的唯一状态。
//
// 树形是渲染约定，不是数据：members 载荷没有层级字段（只有 memberType /
// role / provider / modelId / description），所以根 = 总管绑定的 agent
// （GET teams/{id}/chief 的 chief.agent.agentId），未绑定时退首个成员；其余
// 成员按序落子列，末位接虚线「创建 Agent」卡。
//
// #947 per-face 清零：secondary.css 退役，chart 族几何改挂 token utility
// （参考产品实测值等值迁移：节点卡 220×56 / 圆角 8 / 连接线 44×1 / 括号列
// 28 宽、圆角 7 是阶梯外一次性尺寸，§3.1(a)）。类名别名按 #910 裁定 1
// 退役——chart 内部全是无 role 的结构 div，e2e 载体走 data-testid 二级
// （节点/名字/模型行/皇冠/服务商徽标/连接线/括号/子列），根节点身份由
// 皇冠徽标承载（crown 只渲染在总管绑定 agent 上，即原 --root 修饰类的
// 语义载体）。
import type { SVGProps } from 'react';
import { Button } from '../components/ui/button.js';
import { SeededAvatar } from '../components/ui/seeded-avatar.js';
import type { TeamAgentCard } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';

/** 皇冠字形：逐字抄自参考产品 chart 根节点（`text-indigo-600`，描边 2.5）。
 *  与同栏位图标不同，它不属于 r7 图标清单（icons/ 由 generate-icons.mjs
 *  从那份清单生成），故留在此处而不入 icons/。 */
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

/** 虚线卡里的加号：参考产品为 12×12 / 描边 2.5（与 icons/PlusSmall 的
 *  9×9 / 描边 3 不同号，故另抄一份）。 */
function PlusGlyph(props: SVGProps<SVGSVGElement>) {
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
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

/** 节点卡盒（成员卡与虚线创建卡同族）：220×56 / 圆角 8 / 1px
 *  --border-default / surface 底 / 内垫 0 10（参考产品实测）。 */
const NODE_CLS =
  'flex h-14 w-[220px] items-center gap-2 rounded-[8px] border border-(--border) bg-(--card) px-2.5';

/** 组织图节点卡：32 圆头像 + 两行文本（名字 12px/500，第二行 = 服务商徽标
 *  胶囊 + 10px mono 模型行）。参考产品的节点可点开编辑（本仓那条交互归
 *  #485，此处只落结构与外观）。 */
function ChartNode({ agent, crown }: { agent: TeamAgentCard; crown?: boolean }) {
  const { t } = useI18n();
  return (
    <div className={NODE_CLS} data-testid="team-chart-node">
      <span className="flex size-8 flex-none items-center justify-center overflow-hidden rounded-full bg-(--secondary) [&_img]:size-8">
        <SeededAvatar
          className="size-8"
          name={agent.displayName}
          src={agent.avatarUrl}
          fallback="/avatar-robot-1.svg"
        />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex h-[18px] min-w-0 items-center gap-1">
          <span
            className="truncate text-xs font-medium text-(--foreground)"
            data-testid="team-chart-name"
          >
            {agent.displayName}
          </span>
          {crown && (
            <span
              className="flex size-[18px] flex-none items-center justify-center rounded-full bg-(--spot-soft) text-(--card-button)"
              data-testid="team-chart-crown"
            >
              <CrownGlyph />
            </span>
          )}
        </span>
        <span className="flex h-[18px] min-w-0 items-center gap-1">
          {agent.provider ? (
            <span
              className="flex size-[18px] flex-none items-center justify-center rounded-full bg-(--secondary) text-(--foreground)"
              data-testid="team-chart-provider"
            >
              <ProviderGlyph />
            </span>
          ) : null}
          {/* 模型行墨 --text-dim → --text-tertiary（#947 实测换槽，#908
              裁决 2）：dim×surface 亮模 2.89 低于 10px 文本 floor 4.5，
              tertiary 同对实测 ~6.3/7.6（卡面模型行同墨，域内一致）。 */}
          <span
            className="truncate font-mono text-[10px] text-(--text-tertiary)"
            data-testid="team-chart-model"
          >
            {agent.model}
            {agent.isDefault ? t(' · 默认') : ''}
          </span>
        </span>
      </span>
    </div>
  );
}

/** chart 布局的整块内容：零成员 = 「暂无成员」空态（r2 §8.1 17c），否则出树。
 *  两条分支收在同一处，调用方不必自己按成员数分流。 */
export function TeamChart({
  agents,
  chiefAgentId,
  onCreate,
}: {
  agents: TeamAgentCard[];
  chiefAgentId: string | null;
  onCreate: () => void;
}) {
  const { t } = useI18n();
  const root = agents.find((a) => a.id === chiefAgentId) ?? agents[0];
  if (!root) {
    return (
      <div className="mt-10 text-center text-[13px] text-(--text-tertiary)">{t('暂无成员')}</div>
    );
  }
  const subordinates = agents.filter((a) => a.id !== root.id);
  // 创建槽恒占子列末位，非根成员为 0 时子数是 1。括号列按 ≥2 子设计
  // （top/bottom 各留半张卡高）；单子时列高被吃光，边框塌成悬浮短横，
  // w-7 还把连接线隔出断口（#1246）。单子跳过括号，w-11 连接线直接
  // 接到唯一子卡。外层 items-center 让这条线的 y 落在子卡中心上。
  const singleChain = subordinates.length === 0;
  return (
    <div className="mt-[9px] flex items-center">
      <ChartNode agent={root} crown />
      <div className="h-px w-11 flex-none bg-(--input)" data-testid="team-chart-link" />
      <div className="flex" data-testid="team-chart-children">
        {/* 括号列本身不画东西，只给绝对定位的括号当坐标架：高度随子列撑满，
            于是括号 top/bottom 各留半个卡片高（28），正好落在首/末子节点的
            垂直中心上。单子不挂这一列。 */}
        {singleChain ? null : (
          <div className="relative w-7 flex-none">
            <div
              className="absolute bottom-7 left-0 top-7 w-7 rounded-l-[7px] border border-r-0 border-(--input)"
              data-testid="team-chart-bracket"
            />
          </div>
        )}
        <div className="flex flex-col gap-2" data-testid="team-chart-nodes">
          {subordinates.map((a) => (
            <ChartNode key={a.id} agent={a} />
          ))}
          {/* 虚线创建卡：与成员卡同族盒模型（NODE_CLS layout），border-style
              换 dashed、文本左对齐。#1005 registry 对齐：outline 默认档
              （hover bg-muted / 按下位移由件承载，七通道中和退役），节点卡
              族盒模型经 NODE_CLS 保留（组织图 = 参考产品实测的 bespoke
              可视化面，非 registry 件射程）。 */}
          <Button
            variant="outline"
            className={`${NODE_CLS} justify-start border-dashed text-left text-xs font-medium text-(--text-tertiary)`}
            onClick={onCreate}
          >
            {/* size-3 挂字形本体顶回 12px：件基类 [&_svg:not([class*='size-'])]:size-4
                的 :not 守卫就是让位给自带 size-* 类的 svg（wrapper 上的
                [&_svg]:size-3 特异性低于基类选择器，压不住——#952 实测 16px
                后改挂字形本体；grid 创建槽同款并项）。 */}
            <span className="flex size-6 flex-none items-center justify-center rounded-full border border-dashed border-(--input)">
              <PlusGlyph className="size-3" />
            </span>
            {t('创建 Agent')}
          </Button>
        </div>
      </div>
    </div>
  );
}
