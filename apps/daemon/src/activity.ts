import type { SkillFact, StepActivityPhase, StepActivityReport } from '@cairn/shared';

export const ACTIVITY_REPEAT_MS = 5_000;

export const SKILL_FACTS_CAP = 24;

export interface ActivityTrackerDeps {
  send: (report: StepActivityReport) => void;
  now?: () => number;
  repeatMs?: number;
}

export interface ActivityTracker {
  setPhase: (
    phase: StepActivityPhase,
    extra?: { tool?: string; attempt?: number; resetLive?: boolean },
  ) => void;
  noteEvent: () => void;
  toolStarted: (id: string, name: string) => void;
  toolEnded: (id: string) => void;
  noteSkill: (fact: SkillFact) => void;
}

export function createActivityTracker(deps: ActivityTrackerDeps): ActivityTracker {
  const now = deps.now ?? (() => Date.now());
  const repeatMs = deps.repeatMs ?? ACTIVITY_REPEAT_MS;
  const pendingTools = new Map<string, string>();
  const skills: SkillFact[] = [];
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
    } catch {}
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
      if (extra?.resetLive === true && base !== null) {
        const { resetLive: _drop, ...rest } = base;
        base = rest;
        current = withSkills(base);
      }
    },
    noteEvent() {
      lastEventAt = now();
      if (current === null) return;
      if (lastEventAt <= lastSentEventAt) return;
      if (lastEventAt - lastSentAt < repeatMs) return;
      lastSentAt = lastEventAt;
      lastSentEventAt = lastEventAt;
      try {
        deps.send(current);
      } catch {}
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
        if (skills.length < SKILL_FACTS_CAP) {
          skills.push({ name: fact.name, denied: fact.denied });
          changed = true;
        }
      } else if (fact.denied && !existing.denied && idx !== -1) {
        skills[idx] = { name: fact.name, denied: true };
        changed = true;
      }
      if (!changed) return;
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
