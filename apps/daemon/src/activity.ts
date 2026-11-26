import type {
  AgentTokenUsage,
  SkillFact,
  StepActivityPhase,
  StepActivityReport,
} from '@cairn/shared';

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
  noteUsage: (usage: AgentTokenUsage) => void;
}

type ActivityBase = Pick<StepActivityReport, 'phase' | 'tool' | 'attempt' | 'resetLive'>;

export function createActivityTracker(deps: ActivityTrackerDeps): ActivityTracker {
  const now = deps.now ?? (() => Date.now());
  const repeatMs = deps.repeatMs ?? ACTIVITY_REPEAT_MS;
  const pendingTools = new Map<string, string>();
  const skills: SkillFact[] = [];
  let tokens: StepActivityReport['tokens'];
  let cacheRead: StepActivityReport['cacheRead'];
  let cacheWrite: StepActivityReport['cacheWrite'];
  let contextTokens: StepActivityReport['contextTokens'];
  let contextWindow: StepActivityReport['contextWindow'];
  let compactAt: StepActivityReport['compactAt'];
  let costTotal: StepActivityReport['costTotal'];
  let base: ActivityBase | null = null;
  let current: StepActivityReport | null = null;
  let lastSent: StepActivityReport | null = null;
  let lastSentAt = Number.NEGATIVE_INFINITY;
  let lastEventAt = 0;
  let lastSentEventAt = 0;

  function withSkills(report: ActivityBase): StepActivityReport {
    return {
      ...report,
      ...(skills.length > 0 ? { skills: [...skills] } : {}),
      ...(tokens !== undefined ? { tokens } : {}),
      ...(cacheRead !== undefined ? { cacheRead } : {}),
      ...(cacheWrite !== undefined ? { cacheWrite } : {}),
      ...(contextTokens !== undefined ? { contextTokens } : {}),
      ...(contextWindow !== undefined ? { contextWindow } : {}),
      ...(compactAt !== undefined ? { compactAt } : {}),
      ...(costTotal !== undefined ? { costTotal } : {}),
    };
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
    noteUsage(usage) {
      let input = 0;
      let output = 0;
      let read = 0;
      let write = 0;
      let latestContextTokens: number | undefined;
      let latestContextWindow: number | undefined;
      let latestCompactAt: number | undefined;
      let hasAllCosts = usage.length > 0;
      let costSum = 0;
      for (const row of usage) {
        input += row.input + row.cacheRead + row.cacheWrite;
        output += row.output;
        read += row.cacheRead;
        write += row.cacheWrite;
        if (row.contextTokens !== undefined) latestContextTokens = row.contextTokens;
        if (row.contextWindow !== undefined) latestContextWindow = row.contextWindow;
        if (row.compactAt !== undefined) latestCompactAt = row.compactAt;
        if (row.cost === undefined) hasAllCosts = false;
        else costSum += row.cost.total;
      }
      const nextContextTokens = latestContextTokens ?? contextTokens;
      const nextContextWindow = latestContextWindow ?? contextWindow;
      const nextCompactAt = latestCompactAt ?? compactAt;
      const nextCostTotal =
        hasAllCosts && costSum > 0 ? Math.max(costSum, costTotal ?? 0) : costTotal;
      if (
        input === 0 &&
        output === 0 &&
        nextContextTokens === undefined &&
        nextCostTotal === undefined
      ) {
        return;
      }
      const nextTokens =
        input > 0 || output > 0 || tokens !== undefined
          ? {
              input: Math.max(input, tokens?.input ?? 0),
              output: Math.max(output, tokens?.output ?? 0),
            }
          : undefined;
      const nextCacheRead =
        read > 0 || cacheRead !== undefined ? Math.max(read, cacheRead ?? 0) : undefined;
      const nextCacheWrite =
        write > 0 || cacheWrite !== undefined ? Math.max(write, cacheWrite ?? 0) : undefined;
      if (
        nextTokens?.input === tokens?.input &&
        nextTokens?.output === tokens?.output &&
        nextCacheRead === cacheRead &&
        nextCacheWrite === cacheWrite &&
        nextContextTokens === contextTokens &&
        nextContextWindow === contextWindow &&
        nextCompactAt === compactAt &&
        nextCostTotal === costTotal
      ) {
        return;
      }
      tokens = nextTokens;
      cacheRead = nextCacheRead;
      cacheWrite = nextCacheWrite;
      contextTokens = nextContextTokens;
      contextWindow = nextContextWindow;
      compactAt = nextCompactAt;
      costTotal = nextCostTotal;
      if (base !== null) current = withSkills(base);
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
    a.tokens?.input === b.tokens?.input &&
    a.tokens?.output === b.tokens?.output &&
    a.cacheRead === b.cacheRead &&
    a.cacheWrite === b.cacheWrite &&
    a.contextTokens === b.contextTokens &&
    a.contextWindow === b.contextWindow &&
    a.compactAt === b.compactAt &&
    a.costTotal === b.costTotal &&
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
