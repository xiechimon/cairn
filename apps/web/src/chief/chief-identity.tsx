// Chief drawer robot-row identity chip (#741): avatar + name side by side,
// the whole chip one router Link into the agent's settings page. Reference
// canon (todos.dev, live-captured 2026-10-03 — issue #741): the identity
// chip is cursor-pointer across the board (name span and wrapper alike),
// hover changes only the cursor (no background state), and click routes
// same-tab to /app/resources/agents/<id>. The anchor form keeps keyboard
// activation, middle-click and open-in-new-tab for free (#675 recipe).
//
// ChiefContent.agent.id is an optional slot (#444 envelope): the live mapper
// always carries it, but fixture captures without an id must render an inert
// non-link (zero-navigation capture guarantee) — same face, no anchor. The
// avatar slot keeps the XMON-105 single source (SeededAvatar, 24px canon via
// the AVATAR_IMG_CLS utility recipe, #950).

import { Link, useLocation } from 'react-router';

import { SeededAvatar } from '../components/ui/seeded-avatar.js';
import type { ChiefContent } from '../fixtures/records.js';
import { AGENTS_HREF } from '../routes/agent-detail-page.js';
import { AVATAR_IMG_CLS } from './recipes.js';

/** 身份 chip 基底（#950 清零，旧 .chief-identity 等值：avatar+名横排、
 *  gap 6（参考站实测 3px @12 头像档按 24px 槽等比放大）、self-start、
 *  继承墨、无下划线）。cursor 只给 anchor 形——无 id 的惰性 span 不冒充
 *  可点（参考站 hover 正典：仅指针变化、无背景态；focus 环走全局
 *  :focus-visible）。 */
const IDENTITY_CLS = 'inline-flex items-center gap-1.5 self-start text-inherit no-underline';

interface ChiefIdentityProps {
  agent: NonNullable<ChiefContent['agent']>;
  busy?: boolean;
}

export function ChiefIdentity({ agent, busy = false }: ChiefIdentityProps) {
  // #121 Link law: the scenario param rides along so fixture-mode clicks
  // land on a detail page that resolves the same corpus (team-page agent
  // card recipe). Live URLs carry no scenario — search is empty there.
  const { search } = useLocation();
  const face = (
    <>
      <span className={AVATAR_IMG_CLS}>
        <SeededAvatar
          className="size-6"
          name={agent.displayName}
          src={agent.avatarUrl}
          fallback="/avatar-robot-1.svg"
          busy={busy}
        />
      </span>
      {/* 名字 12px = 参考站实测值（12px/14px、weight 400、次级墨）；行高抬到
          16px 让 chip 高度由 24px 头像槽主导（XMON-105 canon 不动）。 */}
      <span className="text-meta leading-4 font-normal text-(--text-secondary)">
        {agent.displayName}
      </span>
    </>
  );
  if (agent.id == null) return <span className={IDENTITY_CLS}>{face}</span>;
  return (
    <Link
      className={`${IDENTITY_CLS} cursor-pointer`}
      to={{ pathname: `${AGENTS_HREF}/${agent.id}`, search }}
    >
      {face}
    </Link>
  );
}
