import { STEP_ACTIVITY_PHASES, type StepActivityReport } from '@cairn/shared';
import { describe, expect, it } from 'vitest';
import { createActivityTracker, SKILL_FACTS_CAP } from '../src/activity.js';

function harness(opts: { repeatMs?: number } = {}) {
  const sent: { at: number; report: StepActivityReport }[] = [];
  let t = 1_000;
  const tracker = createActivityTracker({
    send: (report) => sent.push({ at: t, report }),
    now: () => t,
    ...(opts.repeatMs !== undefined ? { repeatMs: opts.repeatMs } : {}),
  });
  return {
    sent,
    tracker,
    advance(ms: number) {
      t += ms;
    },
  };
}

describe('activity tracker', () => {
  it('F3: phase change sends immediately with the new report', () => {
    const h = harness();
    h.tracker.setPhase('preparing');
    expect(h.sent).toEqual([{ at: 1_000, report: { phase: 'preparing' } }]);
    h.tracker.setPhase('starting');
    expect(h.sent.at(-1)?.report).toEqual({ phase: 'starting' });
  });

  it('F2: repeated same-phase sets do not re-send', () => {
    const h = harness();
    h.tracker.setPhase('thinking');
    h.tracker.setPhase('thinking');
    h.tracker.setPhase('thinking');
    expect(h.sent).toHaveLength(1);
  });

  it('F1: silent windows never re-send; flowing events re-send after repeatMs', () => {
    const h = harness({ repeatMs: 5_000 });
    h.tracker.setPhase('thinking');
    expect(h.sent).toHaveLength(1);
    h.tracker.noteEvent();
    h.advance(60_000);
    expect(h.sent).toHaveLength(1);
    h.advance(5_000);
    h.tracker.noteEvent();
    expect(h.sent).toHaveLength(2);
    expect(h.sent.at(-1)?.report).toEqual({ phase: 'thinking' });
    h.tracker.noteEvent();
    h.tracker.noteEvent();
    expect(h.sent).toHaveLength(2);
    h.advance(5_000);
    h.tracker.noteEvent();
    expect(h.sent).toHaveLength(3);
  });

  it('F1: no events, no re-send even after many repeat windows', () => {
    const h = harness({ repeatMs: 1_000 });
    h.tracker.setPhase('tool', { tool: 'bash' });
    h.advance(30_000);
    expect(h.sent).toHaveLength(1);
  });

  it('F4: parallel tools — latest start shows; out-of-order ends keep phase until empty', () => {
    const h = harness();
    h.tracker.toolStarted('call-1', 'read');
    expect(h.sent.at(-1)?.report).toEqual({ phase: 'tool', tool: 'read' });
    h.tracker.toolStarted('call-2', 'bash');
    expect(h.sent.at(-1)?.report).toEqual({ phase: 'tool', tool: 'bash' });
    h.tracker.toolEnded('call-2');
    expect(h.sent.at(-1)?.report).toEqual({ phase: 'tool', tool: 'read' });
    h.tracker.toolEnded('call-1');
    expect(h.sent.at(-1)?.report).toEqual({ phase: 'awaiting_model' });
    const before = h.sent.length;
    h.tracker.toolEnded('call-unknown');
    expect(h.sent).toHaveLength(before);
  });

  it('F5: tool end while compacting does not steal the phase', () => {
    const h = harness();
    h.tracker.toolStarted('call-1', 'bash');
    h.tracker.setPhase('compacting');
    h.tracker.toolEnded('call-1');
    expect(h.sent.at(-1)?.report).toEqual({ phase: 'compacting' });
  });

  it('F6: sink errors do not bubble; later changes still attempt sends', () => {
    const reports: StepActivityReport[] = [];
    let fail = true;
    const tracker = createActivityTracker({
      send: (report) => {
        if (fail) throw new Error('machine api 400');
        reports.push(report);
      },
      now: () => 1,
    });
    expect(() => tracker.setPhase('thinking')).not.toThrow();
    fail = false;
    tracker.setPhase('responding');
    expect(reports).toEqual([{ phase: 'responding' }]);
  });

  it('F7: re-send carries the current report after an unsent extra change', () => {
    const h = harness({ repeatMs: 5_000 });
    h.tracker.setPhase('thinking');
    h.tracker.setPhase('retrying', { attempt: 2 });
    expect(h.sent.at(-1)?.report).toEqual({ phase: 'retrying', attempt: 2 });
    h.advance(5_000);
    h.tracker.noteEvent();
    expect(h.sent.at(-1)?.report).toEqual({ phase: 'retrying', attempt: 2 });
  });

  it('F8: skill fact sends immediately, riding the current phase report', () => {
    const h = harness();
    h.tracker.setPhase('tool', { tool: 'skill: to-spec' });
    const before = h.sent.length;
    h.tracker.noteSkill({ name: 'to-spec', denied: false });
    expect(h.sent).toHaveLength(before + 1);
    expect(h.sent.at(-1)?.report).toEqual({
      phase: 'tool',
      tool: 'skill: to-spec',
      skills: [{ name: 'to-spec', denied: false }],
    });
  });

  it('F9: dedupe by name; denied is sticky and upgrades once', () => {
    const h = harness();
    h.tracker.setPhase('thinking');
    h.tracker.noteSkill({ name: 'a', denied: false });
    const afterFirst = h.sent.length;
    h.tracker.noteSkill({ name: 'a', denied: false });
    expect(h.sent).toHaveLength(afterFirst);
    h.tracker.noteSkill({ name: 'a', denied: true });
    expect(h.sent).toHaveLength(afterFirst + 1);
    expect(h.sent.at(-1)?.report.skills).toEqual([{ name: 'a', denied: true }]);
    h.tracker.noteSkill({ name: 'a', denied: false });
    expect(h.sent).toHaveLength(afterFirst + 1);
    expect(h.sent.at(-1)?.report.skills).toEqual([{ name: 'a', denied: true }]);
    h.tracker.noteSkill({ name: 'b', denied: false });
    expect(h.sent.at(-1)?.report.skills).toEqual([
      { name: 'a', denied: true },
      { name: 'b', denied: false },
    ]);
  });

  it('F10: skill list is capped; denied upgrades still apply past the cap', () => {
    const h = harness();
    h.tracker.setPhase('tool', { tool: 'read' });
    for (let i = 0; i < SKILL_FACTS_CAP + 5; i++) {
      h.tracker.noteSkill({ name: `s${i}`, denied: false });
    }
    expect(h.sent.at(-1)?.report.skills).toHaveLength(SKILL_FACTS_CAP);
    h.tracker.noteSkill({ name: 's0', denied: true });
    expect(h.sent.at(-1)?.report.skills?.[0]).toEqual({ name: 's0', denied: true });
    expect(h.sent.at(-1)?.report.skills).toHaveLength(SKILL_FACTS_CAP);
  });

  it('F11: cumulative skills ride later phase changes and throttled re-sends', () => {
    const h = harness({ repeatMs: 1_000 });
    h.tracker.setPhase('thinking');
    h.tracker.noteSkill({ name: 'kami', denied: false });
    h.tracker.setPhase('responding');
    expect(h.sent.at(-1)?.report).toEqual({
      phase: 'responding',
      skills: [{ name: 'kami', denied: false }],
    });
    h.advance(1_000);
    h.tracker.noteEvent();
    expect(h.sent.at(-1)?.report).toEqual({
      phase: 'responding',
      skills: [{ name: 'kami', denied: false }],
    });
  });

  it('F12: skill fact before any phase does not fabricate a report', () => {
    const h = harness();
    h.tracker.noteSkill({ name: 'early', denied: false });
    expect(h.sent).toHaveLength(0);
    h.tracker.setPhase('preparing');
    expect(h.sent).toEqual([
      { at: 1_000, report: { phase: 'preparing', skills: [{ name: 'early', denied: false }] } },
    ]);
  });

  it('phase vocabulary is closed: every phase is settable with its extras', () => {
    const h = harness();
    for (const phase of STEP_ACTIVITY_PHASES) {
      h.tracker.setPhase(phase);
    }
    expect(h.sent.map((s) => s.report.phase)).toEqual([...STEP_ACTIVITY_PHASES]);
  });
});
