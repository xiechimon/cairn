import { describe, expect, test } from 'vitest';
import { mergedPulls } from '../src/services/scheduling/collect.js';
import {
  parseIssueDependencies,
  planSchedule,
  type ScheduleInput,
  type ScheduleIssue,
} from '../src/services/scheduling/plan.js';

function issue(over: Partial<ScheduleIssue> & { number: number }): ScheduleIssue {
  return {
    title: `issue ${over.number}`,
    body: '',
    labels: [],
    state: 'open',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    url: `https://github.com/o/r/issues/${over.number}`,
    ...over,
  };
}

function baseInput(over: Partial<ScheduleInput> = {}): ScheduleInput {
  return {
    generatedAt: 1_700_000_000_000,
    mainSha: 'a'.repeat(40),
    issues: [],
    mergedPulls: [],
    specLedger: [],
    inFlight: new Map(),
    ...over,
  };
}

describe('parseIssueDependencies', () => {
  test('reads the 依赖 / Blocked-By / 等 #N shapes and keeps unresolvable text as-is', () => {
    const parsed = parseIssueDependencies(
      ['依赖 #12、#13', 'Blocked-By: #14', '等 #15 合并', '等待上游设计确认'].join('\n'),
    );
    expect(parsed.issues).toEqual([12, 13, 14, 15]);
    expect(parsed.unparsed).toEqual(['等待上游设计确认']);
  });

  test('a dependency line without a number is reported, never guessed', () => {
    const parsed = parseIssueDependencies('依赖: 调度器先落地');
    expect(parsed.issues).toEqual([]);
    expect(parsed.unparsed).toEqual(['依赖: 调度器先落地']);
  });
});

describe('planSchedule groups', () => {
  test('a ticket with an unmerged dependency never enters now', () => {
    const report = planSchedule(
      baseInput({
        issues: [
          issue({ number: 1, title: '[P1] 依赖 #2 先落地' }),
          issue({ number: 2, labels: ['ready-for-agent'] }),
        ],
      }),
    );
    const now = report.groups.now;
    expect(now).not.toContain(1);
    expect(now).toContain(2);
    const item = report.items.find((i) => i.issue === 1);
    expect(item?.group).toBe('next');
    expect(item?.deps).toEqual([2]);
  });

  test('a dependency already merged on main stops blocking', () => {
    const report = planSchedule(
      baseInput({
        issues: [issue({ number: 1, body: '依赖 #2', labels: ['ready-for-agent'] })],
        mergedPulls: [{ number: 2, title: 'feat: land it', mergedAt: 1, url: 'u' }],
      }),
    );
    expect(report.items.find((i) => i.issue === 1)?.group).toBe('now');
    expect(report.items.find((i) => i.issue === 1)?.deps).toEqual([]);
  });

  test('ready-for-agent is the only way into now when the dependency chain is clear', () => {
    const report = planSchedule(
      baseInput({
        issues: [issue({ number: 1 }), issue({ number: 2, labels: ['ready-for-agent'] })],
      }),
    );
    expect(report.groups.now).toEqual([2]);
    expect(report.groups.next).toEqual([1]);
  });

  test('a ticket with an in-flight build is marked as being worked on and never unlabelled', () => {
    const report = planSchedule(
      baseInput({
        issues: [issue({ number: 1, labels: ['ready-for-agent'] })],
        inFlight: new Map([[1, 'lane/1']]),
      }),
    );
    const item = report.items.find((i) => i.issue === 1);
    expect(item?.executor).toBe('已在做');
    expect(item?.reason).toContain('已在做');
    expect(item?.labelChange).toBeNull();
  });
});

const CHECKED_BODY = '- [x] 排期落地\n- [x] 报告可读';

describe('planSchedule close suggestions', () => {
  test('a merged pull that names the ticket is concrete evidence for done', () => {
    const report = planSchedule(
      baseInput({
        issues: [issue({ number: 1394, title: 'scheduler: weekly sweep', body: CHECKED_BODY })],
        mergedPulls: [
          {
            number: 1500,
            title: 'scheduler: weekly sweep (#1394)',
            body: 'Closes #1394',
            mergedAt: 1,
            url: 'p',
          },
        ],
      }),
    );
    const item = report.items.find((i) => i.issue === 1394);
    expect(item?.group).toBe('close');
    expect(item?.closeReason).toBe('done');
    expect(item?.evidence).toEqual([{ kind: 'merged-pull', ref: '#1500', url: 'p' }]);
  });

  test('a merged pull naming the ticket is not enough when acceptance boxes are unchecked', () => {
    const body = ['## 验收', '- [x] first', '- [ ] second', '- [ ] third'].join('\n');
    const report = planSchedule(
      baseInput({
        issues: [issue({ number: 1394, title: 'scheduler: weekly sweep', body })],
        mergedPulls: [
          {
            number: 1500,
            title: 'scheduler: weekly sweep (#1394)',
            body: 'Closes #1394',
            mergedAt: 1,
            url: 'p',
          },
        ],
      }),
    );
    const item = report.items.find((i) => i.issue === 1394);
    expect(item?.group).not.toBe('close');
    expect(item?.closeReason).toBeNull();
    expect(item?.labelChange).toBeNull();
    expect(item?.reason).toContain('#1500');
    expect(item?.reason).toContain('2');
  });

  test('a ticket without acceptance boxes requires human judgment', () => {
    const report = planSchedule(
      baseInput({
        issues: [issue({ number: 1394, title: 'scheduler: weekly sweep' })],
        mergedPulls: [
          {
            number: 1500,
            title: 'scheduler: weekly sweep (#1394)',
            body: 'Closes #1394',
            mergedAt: 1,
            url: 'p',
          },
        ],
      }),
    );
    const item = report.items.find((i) => i.issue === 1394);
    expect(item?.group).not.toBe('close');
    expect(item?.closeReason).toBeNull();
  });

  test('unchecked acceptance boxes block a close when the only evidence is a merged pull', () => {
    const report = planSchedule(
      baseInput({
        issues: [
          issue({
            number: 1403,
            title: 'spec 28 §8 收尾',
            body: ['## 验收', '- [x] done', '- [ ] pending'].join('\n'),
          }),
        ],
        mergedPulls: [{ number: 1414, title: 'segment 1 (#1403)', mergedAt: 1, url: 'p' }],
      }),
    );
    const item = report.items.find((i) => i.issue === 1403);
    expect(item?.group).not.toBe('close');
    expect(item?.reason).toContain('1');
  });

  test('a maintained ledger row cannot override an unchecked box', () => {
    const report = planSchedule(
      baseInput({
        issues: [
          issue({
            number: 1403,
            title: 'spec 28 §8 收尾',
            body: ['## 验收', '- [x] done', '- [ ] pending'].join('\n'),
          }),
        ],
        specLedger: ['| P2 | #1403 | #1414 (segment 1, merged, b616110) |'],
      }),
    );
    const item = report.items.find((i) => i.issue === 1403);
    expect(item?.group).not.toBe('close');
    expect(item?.closeReason).toBeNull();
  });

  test('a delivering-pull comment cannot override unchecked boxes', () => {
    const report = planSchedule(
      baseInput({
        issues: [
          issue({
            number: 1528,
            title: 'turn repeated review findings into machine checks',
            body: ['## 验收', '- [ ] merged list', '- [ ] top three checks'].join('\n'),
            comments: [
              'closed on 2026-10-23: split into #1541, #1542, #1543, landed by #1546, #1548, #1547',
            ],
          }),
        ],
        mergedPulls: [
          {
            number: 1546,
            title: 'chore(1541): advisory closing-line check',
            mergedAt: 1,
            url: 'p1',
          },
          { number: 1547, title: 'chore(1543): advisory helper check', mergedAt: 2, url: 'p2' },
          { number: 1548, title: 'chore(1542): advisory e2e check', mergedAt: 3, url: 'p3' },
        ],
      }),
    );
    const item = report.items.find((i) => i.issue === 1528);
    expect(item?.group).not.toBe('close');
    expect(item?.closeReason).toBeNull();
  });

  test('a ledger line alone requires human judgment', () => {
    const report = planSchedule(
      baseInput({
        issues: [issue({ number: 1403, title: 'spec 28 §8 收尾', body: CHECKED_BODY })],
        specLedger: ['| 28 §8 | 收尾 | done (#1403) |'],
      }),
    );
    const item = report.items.find((i) => i.issue === 1403);
    expect(item?.group).not.toBe('close');
    expect(item?.closeReason).toBeNull();
  });

  test('a superseding ticket stated on the ticket is evidence for superseded', () => {
    const report = planSchedule(
      baseInput({
        issues: [
          issue({ number: 1528, body: `${CHECKED_BODY}\n已被 #1600 取代` }),
          issue({ number: 1600 }),
        ],
        mergedPulls: [
          { number: 1500, title: 'delivery', body: 'Closes #1528', mergedAt: 1, url: 'p' },
        ],
      }),
    );
    const item = report.items.find((i) => i.issue === 1528);
    expect(item?.group).toBe('close');
    expect(item?.closeReason).toBe('superseded');
    expect(item?.evidence[0]).toEqual({
      kind: 'superseding-issue',
      ref: '#1600',
      url: 'https://github.com/o/r/issues/1600',
    });
  });

  test('no evidence means later, never close', () => {
    const report = planSchedule(
      baseInput({ issues: [issue({ number: 1555, title: '看起来已经做完了' })] }),
    );
    expect(report.items.find((i) => i.issue === 1555)?.group).not.toBe('close');
  });

  test('a ticket with an in-flight build is never offered a label change', () => {
    const report = planSchedule(
      baseInput({
        issues: [issue({ number: 1, labels: ['ready-for-agent'], body: '依赖 #2' })],
        mergedPulls: [{ number: 2, title: 'x', mergedAt: 1, url: 'p' }],
        inFlight: new Map([[1, 'lane/1']]),
      }),
    );
    const item = report.items.find((i) => i.issue === 1);
    expect(item?.group).toBe('next');
    expect(item?.labelChange).toBeNull();
  });

  test('a close suggestion removes the ready label when the ticket carries it', () => {
    const report = planSchedule(
      baseInput({
        issues: [issue({ number: 1, labels: ['ready-for-agent'], body: CHECKED_BODY })],
        mergedPulls: [{ number: 2, title: 'done (#1)', body: 'Closes #1', mergedAt: 1, url: 'p' }],
      }),
    );
    expect(report.items.find((i) => i.issue === 1)?.labelChange).toEqual({
      add: [],
      remove: ['ready-for-agent'],
    });
  });

  test('a blocked ticket that carries ready-for-agent is offered its removal', () => {
    const report = planSchedule(
      baseInput({
        issues: [
          issue({ number: 1, body: '依赖 #2', labels: ['ready-for-agent'] }),
          issue({ number: 2, labels: ['ready-for-agent'] }),
        ],
      }),
    );
    const blocked = report.items.find((i) => i.issue === 1);
    expect(blocked?.group).toBe('next');
    expect(blocked?.labelChange).toEqual({ add: [], remove: ['ready-for-agent'] });
    expect(blocked?.reason).toContain('轮询');
  });

  test('a group-now ticket that already carries the label has no label change', () => {
    const report = planSchedule(
      baseInput({ issues: [issue({ number: 1, labels: ['ready-for-agent'] })] }),
    );
    expect(report.items.find((i) => i.issue === 1)?.group).toBe('now');
    expect(report.items.find((i) => i.issue === 1)?.labelChange).toBeNull();
  });

  test('a later ticket that carries ready-for-agent is offered its removal', () => {
    const report = planSchedule(
      baseInput({
        issues: [
          issue({ number: 1, labels: ['ready-for-agent'], body: '依赖 #9' }),
          issue({ number: 9, labels: ['ready-for-agent'] }),
        ],
        mergedPulls: [],
      }),
    );
    const item = report.items.find((i) => i.issue === 1);
    expect(item?.group).toBe('next');
    expect(item?.labelChange).toEqual({ add: [], remove: ['ready-for-agent'] });
  });
});

describe('planSchedule dependency ordering', () => {
  test('inside a group, a ticket that unlocks another comes first', () => {
    const report = planSchedule(
      baseInput({
        issues: [issue({ number: 3, body: '依赖 #4' }), issue({ number: 4 })],
      }),
    );
    expect(report.groups.next).toEqual([4, 3]);
  });

  test('a ticket that unlocks more tickets wins the tie over one that unlocks fewer', () => {
    const report = planSchedule(
      baseInput({
        issues: [
          issue({ number: 11 }),
          issue({ number: 12, body: '依赖 #11' }),
          issue({ number: 13, body: '依赖 #11' }),
          issue({ number: 21 }),
          issue({ number: 22, body: '依赖 #21' }),
        ],
      }),
    );
    expect(report.groups.next).toEqual([11, 21, 12, 13, 22]);
    const unlockFirst = planSchedule(
      baseInput({
        issues: [
          issue({ number: 40 }),
          issue({ number: 41, body: '依赖 #40' }),
          issue({ number: 42, body: '依赖 #40' }),
          issue({ number: 30 }),
        ],
      }),
    );
    expect(unlockFirst.groups.next).toEqual([40, 30, 41, 42]);
  });

  test('the same ordering holds inside now', () => {
    const report = planSchedule(
      baseInput({
        issues: [
          issue({ number: 11, labels: ['ready-for-agent'] }),
          issue({ number: 12, body: '依赖 #11', labels: ['ready-for-agent'] }),
          issue({ number: 10, body: '依赖 #11', labels: ['ready-for-agent'] }),
        ],
      }),
    );
    expect(report.groups.now).toEqual([11]);
    expect(report.groups.next).toEqual([10, 12]);
  });
});

describe('planSchedule empty-board safety', () => {
  test('an empty input yields an empty report rather than throwing', () => {
    const report = planSchedule(baseInput());
    expect(report.items).toEqual([]);
    expect(report.groups.now).toEqual([]);
  });
});

describe('review round two closure safety', () => {
  test.each([
    { body: '- [ ] pending\nSuperseded by #1600', comments: [] },
    { body: '- [ ] pending', comments: ['delivered by #1500'] },
    { body: '- [ ] pending\n被 spec 28 替代', comments: [] },
  ])('unfinished acceptance cannot be bypassed by $body', ({ body, comments }) => {
    const report = planSchedule(
      baseInput({
        issues: [issue({ number: 1394, body, comments }), issue({ number: 1600 })],
        mergedPulls: [
          { number: 1500, title: 'delivery', body: 'Closes #1394', mergedAt: 1, url: 'p' },
        ],
        specLedger: ['done #1394'],
      }),
    );
    const item = report.items.find((entry) => entry.issue === 1394);
    expect(item?.group).not.toBe('close');
    expect(item?.closeReason).toBeNull();
  });

  test.each([
    { body: CHECKED_BODY, title: 'delivery (#1394)', pullBody: '' },
    { body: '', title: 'delivery', pullBody: 'Closes #1394' },
    { body: CHECKED_BODY, title: 'delivery', pullBody: '' },
  ])(
    'requires completed acceptance and merged pull body evidence: $title / $body',
    ({ body, title, pullBody }) => {
      const report = planSchedule(
        baseInput({
          issues: [issue({ number: 1394, body })],
          mergedPulls: [{ number: 1500, title, body: pullBody, mergedAt: 1, url: 'p' }],
          specLedger: ['done #1394'],
        }),
      );
      expect(report.items[0]?.group).not.toBe('close');
    },
  );

  test('completed acceptance and a merged pull body permit a close suggestion', () => {
    const report = planSchedule(
      baseInput({
        issues: [issue({ number: 1394, body: CHECKED_BODY })],
        mergedPulls: [
          { number: 1500, title: 'delivery', body: 'Closes #1394', mergedAt: 1, url: 'p' },
        ],
      }),
    );
    expect(report.items[0]?.group).toBe('close');
  });
});

test('the scheduling collector retains merged pull body evidence', async () => {
  const pulls = await mergedPulls(
    async (url: string | URL) =>
      new Response(
        JSON.stringify(
          String(url).includes('/pulls/1500')
            ? { body: 'Closes #1394' }
            : [
                {
                  number: 1500,
                  title: 'delivery',
                  state: 'closed',
                  merged_at: '2026-10-23T00:00:00Z',
                },
              ],
        ),
        { status: 200 },
      ),
    'token',
    'owner',
    'repo',
  );
  expect(pulls).toEqual([
    {
      number: 1500,
      title: 'delivery',
      body: 'Closes #1394',
      mergedAt: Date.parse('2026-10-23T00:00:00Z'),
      url: 'https://github.com/owner/repo/pull/1500',
    },
  ]);
});
