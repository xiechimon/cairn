// 合并就绪闸 S2（#1404）：mergeReadiness 纯函数。
// 失败方式先行：读不到的输入被跳过而不是拦住；chief 的 go 压过同一摘要上的
// blocking；旧摘要或未绑定 head 的判定被算作已有；抽取失败被当成通过；
// 只因自家 pacman/merge-gate status 造成的 unstable 把闸自己卡死；别家检查
// 造成的 unstable 被放过；必需检查缺席被当绿（ci-loop 的宽限）；必需清单
// 读不到退回「全部检查」；必需项由 commit status 而不是 check run 提供时
// 漏判；pr-evidence 为 skipped / neutral 被当绿；pacman/merge-gate 本身被设成
// 必需检查；blocker 顺序不稳导致 status 描述来回跳。
// 每个 blocker 一真一假两腿：基线全绿（假腿），每行只打开一个（真腿）。

import { type CompareFile, MERGE_BLOCKER_CODES, type MergeBlockerCode } from '@pacman/shared';
import { describe, expect, test } from 'vitest';
import { computePatchDigest } from '../src/services/merge-gate/digest.js';
import {
  type GateInputs,
  type GateVerdictView,
  mergeReadiness,
} from '../src/services/merge-gate/readiness.js';

const HEAD = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const file = (filename: string, over: Partial<CompareFile> = {}): CompareFile => ({
  status: 'modified',
  previousFilename: null,
  sha: '1'.repeat(40),
  additions: 3,
  deletions: 1,
  ...over,
  filename,
});
const FILES = [
  file('apps/server/src/services/ci-loop.ts'),
  file('apps/server/test/ci-loop.test.ts'),
];
const D = computePatchDigest(FILES).patchDigest as string;
const BODY = `evidence: https://raw.githubusercontent.com/xiechimon/pacman/${HEAD}/docs/verify/1404/result.json`;

const v = (
  kind: GateVerdictView['kind'],
  outcome: GateVerdictView['outcome'],
  perspective: string | null = null,
  patchDigest: string | null = D,
): GateVerdictView => ({
  kind,
  outcome,
  perspective,
  patchDigest,
});

function green(): GateInputs {
  return {
    policy: { mergePolicy: 'autonomous', autonomyPaused: false },
    build: { isGithubPr: true, isCurrent: true, phase: 'review', stepsInFlight: 0 },
    repo: { owner: 'xiechimon', name: 'pacman', defaultBranch: 'main' },
    ticketRef: '1404',
    issueNumber: 1404,
    pr: {
      state: 'open',
      merged: false,
      draft: false,
      mergeableState: 'clean',
      headSha: HEAD,
      baseRef: 'main',
      baseRepoFullName: 'xiechimon/pacman',
      headRepoFullName: 'xiechimon/pacman',
      body: BODY,
      changedFiles: FILES.length,
    },
    checks: {
      required: ['check', 'pack-smoke'],
      runs: [
        { name: 'check', status: 'completed', conclusion: 'success' },
        { name: 'pack-smoke', status: 'completed', conclusion: 'success' },
        { name: 'pr-evidence', status: 'completed', conclusion: 'success' },
      ],
      statuses: [],
    },
    compareFiles: FILES,
    evidenceLinkAncestry: { [HEAD]: true },
    verdicts: [
      v('verify', 'pass'),
      v('review', 'pass', 'correctness'),
      v('review', 'pass', 'security'),
      v('review', 'pass', 'design'),
      v('decision', 'pass', 'chief'),
    ],
    round: {
      perspectives: ['correctness', 'security', 'design'],
      timedOut: [],
      fixRoundsExhausted: false,
      fixNoChange: false,
      gateRoundsExhausted: false,
    },
    availability: {
      reviewerPerspectives: ['correctness', 'security', 'design'],
      verifier: true,
      decider: true,
    },
  };
}

type Row = [MergeBlockerCode, (i: GateInputs) => void];
const pr = (i: GateInputs) => i.pr as NonNullable<GateInputs['pr']>;
const checks = (i: GateInputs) => i.checks as NonNullable<GateInputs['checks']>;
const round = (i: GateInputs) => i.round as NonNullable<GateInputs['round']>;
const setFiles = (i: GateInputs, files: CompareFile[]) => {
  i.compareFiles = files;
  pr(i).changedFiles = files.length;
  // 判定绑在新摘要上，让补丁类 blocker 单独出现
  const d = computePatchDigest(files).patchDigest;
  i.verdicts = i.verdicts.map((x) => ({ ...x, patchDigest: d }));
};

const ROWS: Row[] = [
  [
    'policy-human',
    (i) => {
      i.policy.mergePolicy = 'human';
    },
  ],
  [
    'autonomy-paused',
    (i) => {
      i.policy.autonomyPaused = true;
    },
  ],
  [
    'not-applicable',
    (i) => {
      i.build.isGithubPr = false;
    },
  ],
  [
    'not-current-build',
    (i) => {
      i.build.isCurrent = false;
    },
  ],
  [
    'phase-not-review',
    (i) => {
      i.build.phase = 'building';
    },
  ],
  [
    'work-in-flight',
    (i) => {
      i.build.stepsInFlight = 1;
    },
  ],
  [
    'pr-unreadable',
    (i) => {
      i.pr = null;
    },
  ],
  [
    'pr-not-open',
    (i) => {
      pr(i).state = 'closed';
    },
  ],
  [
    'pr-draft',
    (i) => {
      pr(i).draft = true;
    },
  ],
  [
    'pr-from-fork',
    (i) => {
      pr(i).headRepoFullName = 'someone/pacman';
    },
  ],
  [
    'base-not-default',
    (i) => {
      pr(i).baseRef = 'release';
    },
  ],
  [
    'mergeable-state',
    (i) => {
      pr(i).mergeableState = 'behind';
    },
  ],
  [
    'self-required',
    (i) => {
      checks(i).required = ['check', 'pacman/merge-gate'];
      checks(i).statuses = [{ context: 'pacman/merge-gate', state: 'success' }];
    },
  ],
  [
    'required-checks-unreadable',
    (i) => {
      checks(i).required = null;
    },
  ],
  [
    'required-checks-none',
    (i) => {
      checks(i).required = [];
    },
  ],
  [
    'required-check-missing',
    (i) => {
      checks(i).required = ['check', 'pack-smoke', 'e2e-gate'];
    },
  ],
  [
    'required-check-pending',
    (i) => {
      checks(i).runs[0] = { name: 'check', status: 'in_progress', conclusion: null };
    },
  ],
  [
    'required-check-failed',
    (i) => {
      checks(i).runs[0] = { name: 'check', status: 'completed', conclusion: 'failure' };
    },
  ],
  [
    'pr-evidence-not-green',
    (i) => {
      checks(i).runs[2] = {
        name: 'pr-evidence',
        status: 'completed',
        conclusion: 'skipped',
      };
    },
  ],
  [
    'patch-unavailable',
    (i) => {
      i.compareFiles = null;
    },
  ],
  [
    'compare-truncated',
    (i) => {
      pr(i).changedFiles = FILES.length + 1;
    },
  ],
  [
    'size-cap',
    (i) =>
      setFiles(i, [
        file('apps/server/src/services/ci-loop.ts', { additions: 790 }),
        file('apps/server/test/ci-loop.test.ts', { additions: 20 }),
      ]),
  ],
  [
    'protected-path',
    (i) => setFiles(i, [...FILES, file('apps/server/drizzle/0044_x.sql', { status: 'added' })]),
  ],
  ['outside-auto-merge', (i) => setFiles(i, [...FILES, file('README.md')])],
  [
    'test-deleted',
    (i) => setFiles(i, [...FILES, file('apps/server/test/old.test.ts', { status: 'removed' })]),
  ],
  ['evidence-outside-ticket', (i) => setFiles(i, [...FILES, file('docs/verify/926/x.json')])],
  [
    'evidence-executable',
    (i) => setFiles(i, [...FILES, file('docs/verify/1404/probe.mjs', { status: 'added' })]),
  ],
  [
    'issue-ref-missing',
    (i) => {
      i.issueNumber = null;
    },
  ],
  [
    'evidence-link-missing',
    (i) => {
      i.evidenceLinkAncestry = { [HEAD]: false };
    },
  ],
  [
    'verify-missing',
    (i) => {
      i.verdicts = i.verdicts.filter((x) => x.kind !== 'verify');
    },
  ],
  ['verify-failed', (i) => i.verdicts.push(v('verify', 'block'))],
  [
    'verify-extraction-failed',
    (i) => {
      i.verdicts = [
        ...i.verdicts.filter((x) => x.kind !== 'verify'),
        v('verify', 'extraction_failed'),
      ];
    },
  ],
  ['verify-evidence-invalid', (i) => i.verdicts.push(v('verify', 'evidence_invalid'))],
  ['verify-tampered', (i) => i.verdicts.push(v('verify', 'tampered', null, 'pd1:old'))],
  [
    'review-missing',
    (i) => {
      i.verdicts = i.verdicts.filter((x) => x.perspective !== 'design');
    },
  ],
  ['review-blocking', (i) => i.verdicts.push(v('review', 'block', 'security'))],
  [
    'review-extraction-failed',
    (i) => {
      i.verdicts = [
        ...i.verdicts.filter((x) => x.perspective !== 'design'),
        v('review', 'extraction_failed', 'design'),
      ];
    },
  ],
  [
    'perspective-timed-out',
    (i) => {
      round(i).timedOut = ['design'];
    },
  ],
  [
    'decision-missing',
    (i) => {
      i.verdicts = i.verdicts.filter((x) => x.kind !== 'decision');
    },
  ],
  ['decision-no-go', (i) => i.verdicts.push(v('decision', 'block', 'chief'))],
  [
    'decision-extraction-failed',
    (i) => {
      i.verdicts = [
        ...i.verdicts.filter((x) => x.kind !== 'decision'),
        v('decision', 'extraction_failed', 'chief'),
      ];
    },
  ],
  [
    'fix-rounds-exhausted',
    (i) => {
      round(i).fixRoundsExhausted = true;
    },
  ],
  [
    'fix-no-change',
    (i) => {
      round(i).fixNoChange = true;
    },
  ],
  [
    'gate-rounds-exhausted',
    (i) => {
      round(i).gateRoundsExhausted = true;
    },
  ],
  [
    'no-reviewers',
    (i) => {
      i.availability.reviewerPerspectives = [];
      i.round = null;
    },
  ],
  [
    'no-verifier',
    (i) => {
      i.availability.verifier = false;
    },
  ],
  [
    'no-decider',
    (i) => {
      i.availability.decider = false;
    },
  ],
];

const codesOf = (i: GateInputs) => mergeReadiness(i).blockers.map((b) => b.code);

describe('mergeReadiness：每个 blocker 一真一假', () => {
  test('基线全绿：ready，没有 blocker（每个 blocker 的假腿）', () => {
    const r = mergeReadiness(green());
    expect(r.blockers).toEqual([]);
    expect(r.ready).toBe(true);
    expect(r.headSha).toBe(HEAD);
    expect(r.patchDigest).toBe(D);
  });

  test('每个 blocker 码都有一行真腿（加码不写腿即变红）', () => {
    expect(ROWS.map(([c]) => c).sort()).toEqual([...MERGE_BLOCKER_CODES].sort());
  });

  for (const [code, flip] of ROWS) {
    test(`${code}：只打开它`, () => {
      const i = green();
      flip(i);
      const r = mergeReadiness(i);
      expect(r.blockers.map((b) => b.code)).toEqual([code]);
      expect(r.ready).toBe(false);
    });
  }
});

describe('mergeReadiness：设计点名的组合', () => {
  test('chief 的 go 与同一摘要上的 blocking 同在：不 ready', () => {
    const i = green();
    i.verdicts.push(v('review', 'block', 'design'));
    expect(codesOf(i)).toContain('review-blocking');
  });

  test('blocking 之后同视角又通过一次：仍拦（不允许重掷）', () => {
    const i = green();
    i.verdicts = [v('review', 'block', 'design'), ...i.verdicts];
    expect(codesOf(i)).toEqual(['review-blocking']);
  });

  test('旧摘要上的通过不算：review-missing / verify-missing / decision-missing', () => {
    const i = green();
    i.verdicts = i.verdicts.map((x) => ({ ...x, patchDigest: 'pd1:old' }));
    expect(codesOf(i)).toEqual(['verify-missing', 'review-missing', 'decision-missing']);
  });

  test('未绑定 head 的判定（patchDigest 为空）不算', () => {
    const i = green();
    i.verdicts = i.verdicts.map((x) =>
      x.kind === 'verify' ? { ...x, patchDigest: null, outcome: 'unbound' } : x,
    );
    expect(codesOf(i)).toEqual(['verify-missing']);
  });

  test('只因自家 pacman/merge-gate status 而 unstable：不拦', () => {
    const i = green();
    pr(i).mergeableState = 'unstable';
    checks(i).statuses = [{ context: 'pacman/merge-gate', state: 'pending' }];
    expect(codesOf(i)).toEqual([]);
  });

  test('别家检查让它 unstable：拦，并在细节里点名', () => {
    const i = green();
    pr(i).mergeableState = 'unstable';
    checks(i).runs.push({
      name: 'Cursor Security Agent',
      status: 'completed',
      conclusion: 'failure',
    });
    const r = mergeReadiness(i);
    expect(r.blockers.map((b) => b.code)).toEqual(['mergeable-state']);
    expect(r.blockers[0]?.detail.join(' ')).toContain('Cursor Security Agent');
  });

  test('has_hooks 与 clean 同等对待；unknown 拦（GitHub 还在算）', () => {
    const a = green();
    pr(a).mergeableState = 'has_hooks';
    expect(codesOf(a)).toEqual([]);
    const b = green();
    pr(b).mergeableState = null;
    const r = mergeReadiness(b);
    expect(r.blockers.map((x) => x.code)).toEqual(['mergeable-state']);
    expect(r.blockers[0]?.detail).toEqual(['GitHub still computing']);
  });

  test('verify 步失败（没有结论）不算有判定：verify-missing', () => {
    const i = green();
    i.verdicts = [...i.verdicts.filter((x) => x.kind !== 'verify'), v('verify', 'step_failed')];
    expect(codesOf(i)).toEqual(['verify-missing']);
  });

  test('必需项由 commit status 提供也认；status 为 pending / error 分别记 pending / failed', () => {
    const i = green();
    checks(i).required = ['check', 'legacy-ci'];
    checks(i).statuses = [{ context: 'legacy-ci', state: 'success' }];
    expect(codesOf(i)).toEqual([]);
    checks(i).statuses = [{ context: 'legacy-ci', state: 'pending' }];
    expect(codesOf(i)).toEqual(['required-check-pending']);
    checks(i).statuses = [{ context: 'legacy-ci', state: 'error' }];
    expect(codesOf(i)).toEqual(['required-check-failed']);
  });

  test('必需检查 neutral / skipped 算通过（与分支保护一致），pr-evidence 只认 success', () => {
    const i = green();
    checks(i).runs[1] = { name: 'pack-smoke', status: 'completed', conclusion: 'skipped' };
    expect(codesOf(i)).toEqual([]);
    checks(i).runs[2] = { name: 'pr-evidence', status: 'completed', conclusion: 'neutral' };
    expect(codesOf(i)).toEqual(['pr-evidence-not-green']);
  });

  test('读不到检查：拦，不退回「全部检查」', () => {
    const i = green();
    i.checks = null;
    expect(codesOf(i)).toEqual(['required-checks-unreadable']);
  });

  test('证据链的 SHA 不知道是否是 head 的祖先：不算', () => {
    const i = green();
    i.evidenceLinkAncestry = { [HEAD]: null };
    expect(codesOf(i)).toEqual(['evidence-link-missing']);
  });

  test('证据链指向别的票或钉在旧 SHA（不是祖先）：不算', () => {
    const a = green();
    pr(a).body =
      `https://raw.githubusercontent.com/xiechimon/pacman/${HEAD}/docs/verify/1403/x.json`;
    expect(codesOf(a)).toEqual(['evidence-link-missing']);
    const b = green();
    pr(b).body =
      `https://raw.githubusercontent.com/xiechimon/pacman/${OLD}/docs/verify/1404/x.json`;
    b.evidenceLinkAncestry = { [OLD]: false };
    expect(codesOf(b)).toEqual(['evidence-link-missing']);
  });

  test('审核视角按轮次冻结的集合算，不按团队当前的', () => {
    const i = green();
    i.availability.reviewerPerspectives = ['correctness', 'security', 'design', 'perf'];
    expect(codesOf(i)).toEqual([]);
  });

  test('blocker 顺序固定：同一输入两次结果相同，且按词表顺序', () => {
    const i = green();
    i.policy.mergePolicy = 'human';
    i.issueNumber = null;
    pr(i).draft = true;
    const a = codesOf(i);
    expect(a).toEqual(['policy-human', 'pr-draft', 'issue-ref-missing']);
    expect(codesOf(i)).toEqual(a);
  });

  test('插入顺序与词表顺序不同时，按词表排', () => {
    // 代码先判 verify-tampered、后判 verify-failed，词表里 failed 在前
    const i = green();
    i.verdicts.push(v('verify', 'tampered', null, 'pd1:old'), v('verify', 'block'));
    expect(codesOf(i)).toEqual(['verify-failed', 'verify-tampered']);
  });

  test('800 行、40 个文件整数边界：恰好不拦，多一即拦', () => {
    const lines = (n: number) => {
      const i = green();
      setFiles(i, [
        file('apps/server/src/a.ts', { additions: n - 1, deletions: 0 }),
        file('apps/server/test/a.test.ts', { additions: 1, deletions: 0 }),
      ]);
      return codesOf(i);
    };
    expect(lines(800)).toEqual([]);
    expect(lines(801)).toEqual(['size-cap']);
    const files = (n: number) => {
      const i = green();
      setFiles(
        i,
        Array.from({ length: n }, (_, k) =>
          file(`apps/server/src/f${k}.ts`, { additions: 1, deletions: 0 }),
        ),
      );
      return codesOf(i);
    };
    expect(files(40)).toEqual([]);
    expect(files(41)).toEqual(['size-cap']);
  });

  test('每个 blocker 带类别与固定文案', () => {
    const i = green();
    i.policy.mergePolicy = 'human';
    const [b] = mergeReadiness(i).blockers;
    expect(b).toMatchObject({ code: 'policy-human', class: 'policy', label: '项目策略为人工合并' });
  });

  test('不抛：空 body、空文件列表、空判定', () => {
    const i = green();
    pr(i).body = '';
    i.compareFiles = [];
    pr(i).changedFiles = 0;
    i.verdicts = [];
    expect(() => mergeReadiness(i)).not.toThrow();
  });
});
