import type { MergeBlocker, MergeReadiness } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { type PrCardFacts, type PrCardModel, isVerdictStale, prCardModel } from '../src/components/thread/pr-card-model.js';
import { pillOf } from '../src/components/thread/pr-card.js';

const HEAD = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

const FACTS: PrCardFacts = {
  number: 2512,
  title: 'web: PR card',
  branch: 'cairn/pr-card',
  currentHead: HEAD,
  merged: false,
  conflicts: false,
  checks: { passed: 6, failed: 0, running: 0, total: 6 },
};

function blocker(code: string, cls: MergeBlocker['class'], label = code): MergeBlocker {
  return { code, class: cls, label, detail: [] } as MergeBlocker;
}

function readiness(over: Partial<MergeReadiness> = {}): MergeReadiness {
  return {
    ready: true,
    headSha: HEAD,
    patchDigest: 'pd2:x',
    policy: 'autonomous',
    blockers: [],
    ...over,
  };
}

describe('prCardModel', () => {
  test('a ready readiness on the current head is review-pass bound to the short head', () => {
    const pr = prCardModel(FACTS, readiness());
    expect(pr.state).toBe('review-pass');
    expect(pr.verdict?.judgedHead).toBe('a1b2c3d');
    expect(pr.currentHead).toBe('a1b2c3d');
  });

  test('a verdict judged on an older head keeps its judged head apart from the current head', () => {
    const pr = prCardModel(
      { ...FACTS, currentHead: 'ffff0000ffff0000ffff0000ffff0000ffff0000' },
      readiness(),
    );
    expect(pr.verdict?.judgedHead).toBe('a1b2c3d');
    expect(pr.currentHead).toBe('ffff000');
    expect(pr.verdict?.judgedHead).not.toBe(pr.currentHead);
  });

  test('blockers of class human route the card to the owner', () => {
    const pr = prCardModel(
      FACTS,
      readiness({
        ready: false,
        blockers: [
          blocker('outside-auto-merge', 'human', 'outside the auto-merge set'),
          blocker('policy-human', 'policy'),
        ],
      }),
    );
    expect(pr.state).toBe('owner-route');
    expect(pr.ownerRoute).toBe('outside the auto-merge set');
  });

  test('no readiness means no verdict and an open card', () => {
    const pr = prCardModel(FACTS, null);
    expect(pr.verdict).toBeNull();
    expect(pr.state).toBe('open');
  });

  test('a readiness without a head has no verdict', () => {
    expect(prCardModel(FACTS, readiness({ ready: false, headSha: null })).verdict).toBeNull();
  });

  test('a missing review is no verdict yet, not a pass', () => {
    const pr = prCardModel(
      FACTS,
      readiness({ ready: false, blockers: [blocker('review-missing', 'transient')] }),
    );
    expect(pr.verdict).toBeNull();
    expect(pr.state).toBe('open');
  });

  test('a blocking review is review-block with its blockers listed', () => {
    const pr = prCardModel(
      FACTS,
      readiness({ ready: false, blockers: [blocker('review-blocking', 'transient', 'blocking')] }),
    );
    expect(pr.state).toBe('review-block');
    expect(pr.verdict?.result).toBe('block');
    expect(pr.blockers).toEqual(['blocking']);
  });

  test('conflicts and checks outrank the review verdict', () => {
    expect(prCardModel({ ...FACTS, conflicts: true }, readiness()).state).toBe('conflicts');
    expect(
      prCardModel({ ...FACTS, checks: { passed: 4, failed: 2, running: 0, total: 6 } }, readiness())
        .state,
    ).toBe('checks-failed');
    expect(
      prCardModel({ ...FACTS, checks: { passed: 3, failed: 0, running: 3, total: 6 } }, readiness())
        .state,
    ).toBe('checks-running');
  });

  test('queued carries its position and merged wins over everything, hiding the closed-PR blocker', () => {
    const queued = prCardModel({ ...FACTS, queuePosition: 2 }, readiness());
    expect(queued.state).toBe('queued');
    expect(queued.queuePosition).toBe(2);
    const merged = prCardModel(
      { ...FACTS, merged: true, queuePosition: 2 },
      readiness({ ready: false, blockers: [blocker('pr-not-open', 'human')] }),
    );
    expect(merged.state).toBe('merged');
    expect(merged.queuePosition).toBeUndefined();
    expect(merged.blockers).toBeUndefined();
    expect(merged.ownerRoute).toBeUndefined();
  });
});

describe('a finished PR is never reported as needing re-review', () => {
  const verdict = { result: 'pass', judgedHead: 'a1b2c3d' } as const;
  const stale = { verdict, currentHead: 'f00ba12' };

  test.each(['merged', 'closed'] as const)('%s with an old verdict is not stale', (state) => {
    expect(isVerdictStale({ ...stale, state })).toBe(false);
  });

  test.each(['open', 'draft', 'review-pass'] as const)('%s with an old verdict is stale', (state) => {
    expect(isVerdictStale({ ...stale, state })).toBe(true);
  });

  test('the pill of a closed PR with an old verdict says closed', () => {
    const model = { number: 1, title: 't', state: 'closed', checks: { passed: 1, failed: 0, running: 0, total: 1 }, ...stale } as PrCardModel;
    expect(pillOf(model, (key) => key).label).toBe('已关闭');
  });
});
