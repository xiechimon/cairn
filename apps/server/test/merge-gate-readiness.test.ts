// 合并就绪闸 S2（#1404）：mergeReadiness 纯函数。
// 失败方式先行：读不到的输入被跳过而不是拦住；chief 的 go 压过同一摘要上的
// blocking；旧摘要或未绑定 head 的判定被算作已有；抽取失败被当成通过；
// 只因自家 pacman/merge-gate status 造成的 unstable 把闸自己卡死；别家检查
// 造成的 unstable 被放过；必需检查缺席被当绿（ci-loop 的宽限）；必需清单
// 读不到退回「全部检查」；必需项由 commit status 而不是 check run 提供时
// 漏判；pr-evidence 为 skipped / neutral 被当绿；pacman/merge-gate 本身被设成
// 必需检查；blocker 顺序不稳导致 status 描述来回跳。
// /code-review 之后：只有证据或缺 blob sha 的补丁（等不来摘要）被当成可等；
// GitHub 还报 clean 时放过手上检查清单里别家未通过的检查；unstable 却看不到
// 任何未通过的检查也放过；同摘要上后来的通过清不掉 evidence_invalid；读不到
// 默认分支被当成目标分支不对而留人。
// S1 第三轮（D4 在 #1410 上的修订）之后：证据目录外看不到 diff 的文件（二进制、
// diff 过大、纯改名）被放过；证据目录里的截图被当成看不到 diff 而留人；800 行 /
// 40 文件上限只数证据之外的部分。
// S2 第四轮（pr-gate 在 #1421 首轮的建议）：读到了、形状不对的 compare 被当成可等，
// 每次巡检形状都一样，闸永远等下去；证据链只要是 head 的祖先就算，main 历史里同票
// 前一段（已 squash）的证据也算数，本 PR 却没加证据；检查列表没读全（分页没读完）
// 却被当成全量；证据前缀的大小写变体（Docs/Verify/）下看不到 diff 的文件被当成
// 证据放过。
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
/** 本 PR 较早的一个提交：在 base..head 里，不是 head。 */
const EARLIER = 'e'.repeat(40);
/** main 历史里的提交：head 的祖先，不在 base..head 里（同票前一段已 squash 进 main）。 */
const MAIN = 'f'.repeat(40);
const file = (filename: string, over: Partial<CompareFile> = {}): CompareFile => ({
  status: 'modified',
  previousFilename: null,
  sha: '1'.repeat(40),
  additions: 3,
  deletions: 1,
  patchSha: 'c'.repeat(64),
  ...over,
  filename,
});
const FILES = [
  file('apps/server/src/services/ci-loop.ts'),
  file('apps/server/test/ci-loop.test.ts'),
];
const D = computePatchDigest(FILES).patchDigest as string;
const opaque = (filename: string, over: Partial<CompareFile> = {}) =>
  file(filename, { status: 'added', additions: 0, deletions: 0, patchSha: null, ...over });
/** 本 PR 加的证据：一张截图（没有行数、没有 patch，不进摘要）。每份文件列表都带着
 * 它，body 的证据链指着它。 */
const SHOT = opaque('docs/verify/1404/shot.png');
const link = (sha: string, path = SHOT.filename) =>
  `https://raw.githubusercontent.com/xiechimon/pacman/${sha}/${path}`;
const BODY = `evidence: ${link(HEAD)}`;

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
      changedFiles: FILES.length + 1,
    },
    checks: {
      required: ['check', 'pack-smoke'],
      runs: [
        { name: 'check', status: 'completed', conclusion: 'success' },
        { name: 'pack-smoke', status: 'completed', conclusion: 'success' },
        { name: 'pr-evidence', status: 'completed', conclusion: 'success' },
      ],
      statuses: [],
      complete: true,
    },
    compare: { files: [...FILES, SHOT], commits: [EARLIER, HEAD] },
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
const compare = (i: GateInputs) => i.compare as Exclude<GateInputs['compare'], string>;
/** 换文件列表，证据截图 SHOT 随行（body 的链接要指着本 PR 的证据）。 */
const setFiles = (i: GateInputs, files: CompareFile[]) => {
  const all = [...files, SHOT];
  compare(i).files = all;
  pr(i).changedFiles = all.length;
  // 判定绑在新摘要上，让补丁类 blocker 单独出现
  const d = computePatchDigest(all).patchDigest;
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
      i.compare = 'unreadable';
    },
  ],
  [
    'compare-malformed',
    (i) => {
      i.compare = 'malformed';
    },
  ],
  [
    'compare-truncated',
    (i) => {
      pr(i).changedFiles += 1;
    },
  ],
  ['patch-unbindable', (i) => setFiles(i, [file('docs/verify/1404/result.json')])],
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
  ['opaque-file', (i) => setFiles(i, [...FILES, opaque('apps/web/src/assets/logo.png')])],
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
      pr(i).body = `evidence: ${link(MAIN)}`;
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
  [
    'verify-evidence-invalid',
    (i) => {
      i.verdicts = [
        ...i.verdicts.filter((x) => x.kind !== 'verify'),
        v('verify', 'evidence_invalid'),
      ];
    },
  ],
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
const classesOf = (i: GateInputs) =>
  mergeReadiness(i).blockers.map((b) => [b.code, b.class, ...b.detail]);

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

  test('证据链指向别的票或钉在旧 SHA（不在 base..head）：不算', () => {
    const a = green();
    pr(a).body = link(HEAD, 'docs/verify/1403/shot.png');
    expect(codesOf(a)).toEqual(['evidence-link-missing']);
    const b = green();
    pr(b).body = link(OLD);
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
    // 证据截图随行，代码文件 n - 1 个，合计 n 个
    const files = (n: number) => {
      const i = green();
      setFiles(
        i,
        Array.from({ length: n - 1 }, (_, k) =>
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
    i.compare = { files: [], commits: [] };
    pr(i).changedFiles = 0;
    i.verdicts = [];
    expect(() => mergeReadiness(i)).not.toThrow();
  });
});

describe('mergeReadiness：等不来的留人，读不到的可等，检查以手上的为准（/code-review 后）', () => {
  test('只有证据的补丁、空补丁：摘要等不来，留人（human），不是可等的 patch-unavailable', () => {
    const a = green();
    setFiles(a, [file('docs/verify/1404/result.json')]);
    expect(classesOf(a)).toEqual([['patch-unbindable', 'human', 'empty']]);
    const b = green();
    setFiles(b, []);
    expect(classesOf(b)).toEqual([['patch-unbindable', 'human', 'empty']]);
  });

  test('有文件缺 blob sha（子模块之类）：摘要等不来，留人', () => {
    const i = green();
    setFiles(i, [...FILES, file('apps/server/src/vendored', { sha: null })]);
    expect(classesOf(i)).toEqual([['patch-unbindable', 'human', 'null-sha']]);
  });

  test('读不到 compare：仍是可等的 patch-unavailable；截断仍是留人的 compare-truncated', () => {
    const a = green();
    a.compare = 'unreadable';
    expect(classesOf(a)).toEqual([['patch-unavailable', 'transient', 'compare unreadable']]);
    const b = green();
    pr(b).changedFiles += 1;
    expect(classesOf(b)).toEqual([['compare-truncated', 'human', 'count-mismatch']]);
  });

  test('GitHub 还报 clean，手上的检查里有别家失败：拦，并点名', () => {
    const i = green();
    checks(i).runs.push({
      name: 'Cursor Security Agent',
      status: 'completed',
      conclusion: 'failure',
    });
    const [b, ...rest] = mergeReadiness(i).blockers;
    expect(rest).toEqual([]);
    expect(b).toMatchObject({ code: 'mergeable-state', class: 'transient' });
    expect(b?.detail.join(' ')).toContain('Cursor Security Agent');
  });

  test('has_hooks 同样：别家 commit status 失败、别家检查还在跑，都拦', () => {
    const a = green();
    pr(a).mergeableState = 'has_hooks';
    checks(a).statuses = [{ context: 'codecov/patch', state: 'failure' }];
    expect(mergeReadiness(a).blockers.map((b) => [b.code, b.class])).toEqual([
      ['mergeable-state', 'transient'],
    ]);
    const b = green();
    pr(b).mergeableState = 'has_hooks';
    checks(b).runs.push({ name: 'lighthouse', status: 'in_progress', conclusion: null });
    expect(mergeReadiness(b).blockers.map((x) => [x.code, x.class])).toEqual([
      ['mergeable-state', 'transient'],
    ]);
  });

  test('clean 时：自家 status 未通过不拦；必需检查与 pr-evidence 失败只记各自的码', () => {
    const a = green();
    checks(a).statuses = [{ context: 'pacman/merge-gate', state: 'failure' }];
    expect(codesOf(a)).toEqual([]);
    const b = green();
    checks(b).runs[2] = { name: 'pr-evidence', status: 'completed', conclusion: 'failure' };
    expect(codesOf(b)).toEqual(['pr-evidence-not-green']);
    const c = green();
    checks(c).required = ['check', 'legacy-ci'];
    checks(c).statuses = [{ context: 'Legacy-CI', state: 'failure' }];
    expect(codesOf(c)).toEqual(['required-check-failed']);
  });

  test('unstable 却看不到任何未通过的检查（自家 status 也是 success）：拦', () => {
    const a = green();
    pr(a).mergeableState = 'unstable';
    expect(mergeReadiness(a).blockers.map((b) => [b.code, b.class])).toEqual([
      ['mergeable-state', 'transient'],
    ]);
    const b = green();
    pr(b).mergeableState = 'unstable';
    checks(b).statuses = [{ context: 'pacman/merge-gate', state: 'success' }];
    expect(mergeReadiness(b).blockers.map((x) => [x.code, x.class])).toEqual([
      ['mergeable-state', 'transient'],
    ]);
  });

  test('同摘要上 evidence_invalid 之后又通过：清掉（与 extraction_failed 同理）', () => {
    const i = green();
    i.verdicts = [v('verify', 'evidence_invalid'), ...i.verdicts];
    expect(codesOf(i)).toEqual([]);
  });

  test('通过在另一份补丁上：清不掉同摘要的 evidence_invalid', () => {
    const i = green();
    i.verdicts = [
      ...i.verdicts.filter((x) => x.kind !== 'verify'),
      v('verify', 'evidence_invalid'),
      v('verify', 'pass', null, 'pd1:old'),
    ];
    expect(mergeReadiness(i).blockers.map((b) => [b.code, b.class])).toEqual([
      ['verify-evidence-invalid', 'transient'],
    ]);
  });

  test('读不到默认分支：可等的 pr-unreadable，不是留人的 base-not-default', () => {
    const i = green();
    i.repo.defaultBranch = null;
    expect(classesOf(i)).toEqual([['pr-unreadable', 'transient', 'default branch unreadable']]);
  });

  test('读到了默认分支、PR 指向别处：仍是留人的 base-not-default', () => {
    const i = green();
    pr(i).baseRef = 'release';
    expect(mergeReadiness(i).blockers.map((b) => [b.code, b.class])).toEqual([
      ['base-not-default', 'human'],
    ]);
  });
});

describe('mergeReadiness：看不到 diff 的文件留人，上限按整张补丁算（S1 第三轮后）', () => {
  const many = (n: number, at: (k: number) => string, over: Partial<CompareFile> = {}) =>
    Array.from({ length: n }, (_, k) => file(at(k), { additions: 1, deletions: 0, ...over }));

  test('证据目录外的二进制与纯改名：opaque-file，留人，逐个点名（改名两头都列）', () => {
    const i = green();
    setFiles(i, [
      ...FILES,
      opaque('apps/web/src/assets/logo.png'),
      opaque('apps/server/src/b.ts', {
        status: 'renamed',
        previousFilename: 'apps/server/src/a.ts',
      }),
    ]);
    const r = mergeReadiness(i);
    expect(r.ready).toBe(false);
    expect(r.blockers).toEqual([
      {
        code: 'opaque-file',
        class: 'human',
        label: '证据目录外有看不到 diff 的文件（二进制、diff 过大或纯改名）',
        detail: ['apps/web/src/assets/logo.png', 'apps/server/src/b.ts', 'apps/server/src/a.ts'],
      },
    ]);
  });

  test('证据目录里的截图（没有 patch）不留人', () => {
    const i = green();
    setFiles(i, [...FILES, opaque('docs/verify/1404/after.png')]);
    expect(codesOf(i)).toEqual([]);
  });

  test('opaque-file 在词表里排在 D4 路径码之间：删测试之后、别票证据之前', () => {
    const i = green();
    setFiles(i, [
      ...FILES,
      file('docs/verify/926/x.json'),
      opaque('apps/web/src/assets/logo.png'),
      file('apps/server/test/old.test.ts', { status: 'removed' }),
      file('apps/server/drizzle/0044_x.sql', { status: 'added' }),
    ]);
    expect(codesOf(i)).toEqual([
      'protected-path',
      'test-deleted',
      'opaque-file',
      'evidence-outside-ticket',
    ]);
  });

  test('40 文件上限计入证据：35 个代码文件加 10 个证据文件拦，30 加 10 不拦', () => {
    // 证据 9 个文本加随行的截图 SHOT（0 行），共 10 个
    const withEvidence = (code: number) => {
      const i = green();
      setFiles(i, [
        ...many(code, (k) => `apps/server/src/f${k}.ts`),
        ...many(9, (k) => `docs/verify/1404/e${k}.txt`, { status: 'added' }),
      ]);
      return classesOf(i);
    };
    expect(withEvidence(30)).toEqual([]);
    expect(withEvidence(35)).toEqual([['size-cap', 'human', '44 lines, 45 files']]);
  });

  test('800 行上限计入证据：代码 700 行，证据 100 行不拦，101 行拦', () => {
    const withEvidence = (n: number) => {
      const i = green();
      setFiles(i, [
        file('apps/server/src/a.ts', { additions: 699, deletions: 0 }),
        file('apps/server/test/a.test.ts', { additions: 1, deletions: 0 }),
        file('docs/verify/1404/log.txt', { status: 'added', additions: n, deletions: 0 }),
      ]);
      return classesOf(i);
    };
    expect(withEvidence(100)).toEqual([]);
    expect(withEvidence(101)).toEqual([['size-cap', 'human', '801 lines, 4 files']]);
  });
});

describe('mergeReadiness：形状不对的 compare 留人，证据出自本 PR，检查读全才信（S2 第四轮）', () => {
  test('compare 读到了、形状不对：留人的 compare-malformed，不是可等的 patch-unavailable', () => {
    const a = green();
    a.compare = 'malformed';
    expect(classesOf(a)).toEqual([['compare-malformed', 'human']]);
    const b = green();
    b.compare = 'unreadable';
    expect(classesOf(b)).toEqual([['patch-unavailable', 'transient', 'compare unreadable']]);
  });

  test('证据链钉在 main 历史上（head 的祖先、不在 base..head）：不算，路径是本 PR 的证据也不算', () => {
    const i = green();
    pr(i).body = `evidence: ${link(MAIN)}`;
    expect(classesOf(i)).toEqual([
      [
        'evidence-link-missing',
        'transient',
        '1 link(s) to docs/verify/1404/, none at a commit of this PR to a file it adds or changes',
      ],
    ]);
  });

  test('证据链钉在本 PR 的提交上（不必是 head）、指向本 PR 加的证据：算', () => {
    const i = green();
    pr(i).body = `evidence: ${link(EARLIER)}`;
    expect(codesOf(i)).toEqual([]);
  });

  test('钉在本 PR 的提交上、指向本 PR 没增改的证据（同票前一段留在 main 的）：不算', () => {
    const i = green();
    pr(i).body = `evidence: ${link(HEAD, 'docs/verify/1404/s1-result.json')}`;
    expect(codesOf(i)).toEqual(['evidence-link-missing']);
  });

  test('指向本 PR 删掉的证据：不算', () => {
    const i = green();
    setFiles(i, [...FILES, opaque('docs/verify/1404/old.png', { status: 'removed' })]);
    pr(i).body = `evidence: ${link(EARLIER, 'docs/verify/1404/old.png')}`;
    expect(codesOf(i)).toEqual(['evidence-link-missing']);
  });

  test('多条链接有一条合格即可：钉在 main 历史上的那条不拖累', () => {
    const i = green();
    pr(i).body = `${link(MAIN)}\n${link(EARLIER)}`;
    expect(codesOf(i)).toEqual([]);
  });

  test('检查列表没读全：整份按读不到处理（可等），不拿半张清单判 missing / not-green', () => {
    const incomplete = [['required-checks-unreadable', 'transient', 'check list incomplete']];
    const a = green();
    checks(a).complete = false;
    expect(classesOf(a)).toEqual(incomplete);
    const b = green();
    checks(b).complete = false;
    checks(b).runs = checks(b).runs.slice(0, 1);
    expect(classesOf(b)).toEqual(incomplete);
  });

  test('证据前缀的大小写变体（Docs/Verify/）不算证据：看不到 diff 的照样 opaque-file 留人', () => {
    const i = green();
    setFiles(i, [
      ...FILES,
      opaque('Docs/Verify/1404/b.png'),
      opaque('docs/verify/1404/c.png', {
        status: 'renamed',
        previousFilename: 'DOCS/verify/1404/c.png',
      }),
    ]);
    expect(classesOf(i)).toEqual([
      ['opaque-file', 'human', 'Docs/Verify/1404/b.png', 'DOCS/verify/1404/c.png'],
    ]);
  });
});
