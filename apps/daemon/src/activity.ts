// 步活动相位 tracker（#905）：从 runner 已有的 StepEvent 消费点派生「在做
// 什么」，经 machineToolBodySchema 第四形上报（server 盖 stepId/at 后瞬态进
// 会话流）。失败方式枚举与判定见 test/activity.test.ts 头注（F1–F7）；两条
// 设计律：
//   - **无定时器**：重发只由 noteEvent（真实流事件到达）驱动——静默期零上报，
//     browser 端 now−at 增长即「卡住」的诚实呈现（#471）。没有 interval 就没有
//     跨步泄漏面（runStep 提前 return 路径多，timer 清理点钉不全是历史教训）。
//   - **fire-and-forget**：sink 抛错（旧 server 对第四形 400 / 网络断）被吞，
//     活动是呈现信号不是数据面——终稿 transcript 与步状态另有正本。

import type { SkillFact, StepActivityPhase, StepActivityReport } from '@pacman/shared';

/** 事件 flowing 期的重发节流窗：browser 端「最近信号 Ns 前」的新鲜度上限
 *  ≈ repeatMs + 事件间隔。5s = 「在动」肉眼可辨、量级远低于 30s heartbeat。 */
export const ACTIVITY_REPEAT_MS = 5_000;

/** #918 技能事实累计上限（F10 载荷有界）：正常一步读个位数技能；到顶说明
 *  模型在病态循环读技能目录，清单停长（已收录名字的 denied 升级不受限）。 */
export const SKILL_FACTS_CAP = 24;

export interface ActivityTrackerDeps {
  /** 上报出口（runner 接 client.activity 的 fire-and-forget 包装）。 */
  send: (report: StepActivityReport) => void;
  now?: () => number;
  repeatMs?: number;
}

export interface ActivityTracker {
  /** 相位变更：report 与上次已发不同即同步发送（F3）；相同即跳过（F2）。 */
  setPhase: (
    phase: StepActivityPhase,
    extra?: { tool?: string; attempt?: number; resetLive?: boolean },
  ) => void;
  /** 任何流事件到达（runner 事件循环顶部，与看门狗重置同点）：驱动节流
   *  重发（F1）——只有真事件能把「最近信号」推新。 */
  noteEvent: () => void;
  /** 调用块流完（toolcall_end 无 result）：工具开始执行。并行时显示名 =
   *  最近开始者（F4）。 */
  toolStarted: (id: string, name: string) => void;
  /** 工具终态（toolcall_end 带 result）：pending 空且当前相位是 tool 才回
   *  awaiting_model（F4/F5）；未知 id 静默（异机回放等）。 */
  toolEnded: (id: string) => void;
  /** #918 技能事实（分类单源 shared/skill-facts）：累计进 skills 清单并立即
   *  重发当前 report（F8）。去重按 name、denied 粘滞（F9）；cap 见
   *  SKILL_FACTS_CAP（F10）；相位未起时只记不发（F12）。 */
  noteSkill: (fact: SkillFact) => void;
}

export function createActivityTracker(deps: ActivityTrackerDeps): ActivityTracker {
  const now = deps.now ?? (() => Date.now());
  const repeatMs = deps.repeatMs ?? ACTIVITY_REPEAT_MS;
  /** pending 工具：插入序 Map（末位 = 最近开始者；F4 的显示名来源）。 */
  const pendingTools = new Map<string, string>();
  /** #918 技能事实累计集（首见序；去重按 name、denied 粘滞、cap 有界）。 */
  const skills: SkillFact[] = [];
  /** 相位基座（不含 skills）：noteSkill 重发时据此重建当前 report（F8）。 */
  let base: Omit<StepActivityReport, 'skills'> | null = null;
  let current: StepActivityReport | null = null;
  let lastSent: StepActivityReport | null = null;
  let lastSentAt = Number.NEGATIVE_INFINITY;
  let lastEventAt = 0;
  let lastSentEventAt = 0;

  function withSkills(report: Omit<StepActivityReport, 'skills'>): StepActivityReport {
    return skills.length > 0 ? { ...report, skills: [...skills] } : report;
  }

  function emit(report: StepActivityReport): void {
    current = report;
    if (sameReport(report, lastSent)) return;
    lastSent = report;
    lastSentAt = now();
    lastSentEventAt = lastEventAt;
    try {
      deps.send(report);
    } catch {
      // F6：出口故障不打断步——下一个相位变化再试。
    }
  }

  return {
    setPhase(phase, extra) {
      base = {
        phase,
        ...(extra?.tool !== undefined ? { tool: extra.tool } : {}),
        ...(extra?.attempt !== undefined ? { attempt: extra.attempt } : {}),
        ...(extra?.resetLive === true ? { resetLive: true } : {}),
      };
      emit(withSkills(base));
      // resetLive 一次性：发出后立刻从 base/current 撕掉，节流重发与后续
      // 相位不得再带清快照位（#1308 Bugbot sticky resetLive）。
      if (extra?.resetLive === true && base !== null) {
        const { resetLive: _drop, ...rest } = base;
        base = rest;
        current = withSkills(base);
      }
    },
    noteEvent() {
      lastEventAt = now();
      if (current === null) return;
      // F1 双臂：必须有比上次发送更新的事件，且距上次发送满节流窗。
      if (lastEventAt <= lastSentEventAt) return;
      if (lastEventAt - lastSentAt < repeatMs) return;
      lastSentAt = lastEventAt;
      lastSentEventAt = lastEventAt;
      try {
        deps.send(current);
      } catch {
        // F6 同律。
      }
    },
    toolStarted(id, name) {
      pendingTools.set(id, name);
      this.setPhase('tool', { tool: name });
    },
    toolEnded(id) {
      if (!pendingTools.delete(id)) return;
      if (pendingTools.size > 0) {
        const latest = [...pendingTools.values()].at(-1) ?? '';
        this.setPhase('tool', { tool: latest });
        return;
      }
      if (current?.phase === 'tool') this.setPhase('awaiting_model');
    },
    noteSkill(fact) {
      const idx = skills.findIndex((s) => s.name === fact.name);
      const existing = idx === -1 ? undefined : skills[idx];
      let changed = false;
      if (existing === undefined) {
        // cap 有界（F10）：到顶后新名字不收——清单停长。
        if (skills.length < SKILL_FACTS_CAP) {
          skills.push({ name: fact.name, denied: fact.denied });
          changed = true;
        }
      } else if (fact.denied && !existing.denied && idx !== -1) {
        // denied 粘滞（F9）：只升级不回退——挡下是既成事实。换对象不换槽
        // （已发 report 的数组是浅拷贝、共享旧对象——原地改会把 lastSent
        // 一起改掉，sameReport 就看不出这次变化了）。
        skills[idx] = { name: fact.name, denied: true };
        changed = true;
      }
      if (!changed) return;
      // 相位未起不凭空发报（F12）：技能集搭下一份相位报的便车。
      if (base === null) return;
      emit(withSkills(base));
    },
  };
}

function sameReport(a: StepActivityReport | null, b: StepActivityReport | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.phase === b.phase &&
    a.tool === b.tool &&
    a.attempt === b.attempt &&
    a.resetLive === b.resetLive &&
    sameSkills(a.skills, b.skills)
  );
}

function sameSkills(
  a: readonly SkillFact[] | undefined,
  b: readonly SkillFact[] | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b;
  return (
    a.length === b.length &&
    a.every((f, i) => {
      const g = b[i];
      return g !== undefined && f.name === g.name && f.denied === g.denied;
    })
  );
}
