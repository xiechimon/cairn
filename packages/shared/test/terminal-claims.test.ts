import { describe, expect, it } from 'vitest';
import {
  createClaimShield,
  findTerminalClaims,
  NO_TERMINAL_CLAIM_FACTS,
  rewriteTerminalClaims,
  type TerminalClaimFacts,
  unbackedTerminalClaims,
} from '../src/records/terminal-claims.js';

const facts = (over: Partial<TerminalClaimFacts> = {}): TerminalClaimFacts => ({
  ...NO_TERMINAL_CLAIM_FACTS,
  ...over,
});

describe('findTerminalClaims', () => {
  it('finds the Chinese and English forms of every terminal outcome', () => {
    const text =
      '已合并。已推送。已部署。测试全部通过。The change is merged, pushed, deployed and all tests pass.';
    expect(findTerminalClaims(text).map((claim) => claim.outcome)).toEqual([
      'merged',
      'pushed',
      'deployed',
      'tests',
      'merged',
      'pushed',
      'deployed',
      'tests',
    ]);
  });

  it('ignores phrases inside fenced code blocks', () => {
    const text = '```\ngit log --oneline\nabc123 merged\n```\n还没有动静。';
    expect(findTerminalClaims(text)).toEqual([]);
  });

  it('marks a claim attributed when its sentence names its source', () => {
    const [attributed] = findTerminalClaims('任务报告说 PR 已合并。');
    expect(attributed?.attributed).toBe(true);
    const [bare] = findTerminalClaims('已经合并了，你放心。');
    expect(bare?.attributed).toBe(false);
  });
});

describe('unbackedTerminalClaims', () => {
  it('allows a claim the recorded state confirms', () => {
    expect(unbackedTerminalClaims('已合并。', facts({ merge: 'done' }))).toEqual([]);
  });

  it('stops a merge claim while the merge step is still in flight', () => {
    expect(unbackedTerminalClaims('已合并。', facts({ merge: 'in-flight' }))).toHaveLength(1);
  });

  it('lets the Coordinator relay an outcome the server cannot record', () => {
    expect(unbackedTerminalClaims('任务报告里写着测试全部通过。', facts())).toEqual([]);
  });

  it('does not let attribution excuse a merge claim the record contradicts', () => {
    expect(
      unbackedTerminalClaims('任务报告说 PR 已合并。', facts({ merge: 'in-flight' })),
    ).toHaveLength(1);
  });
});

describe('rewriteTerminalClaims', () => {
  it('replaces a premature merge claim with the recorded state', () => {
    expect(
      rewriteTerminalClaims('已合并。改动进了主线。', facts({ merge: 'in-flight' })).text,
    ).toBe('还在合并、尚未完成。改动进了主线。');
  });

  it('says a failed merge did not succeed rather than that it is running', () => {
    expect(rewriteTerminalClaims('已合并。', facts({ merge: 'failed' })).text).toBe(
      '合并没有成功。',
    );
  });

  it('leaves backed and attributed claims untouched', () => {
    const text = '已合并。任务报告说测试全部通过。';
    const rewritten = rewriteTerminalClaims(text, facts({ merge: 'done' }));
    expect(rewritten.text).toBe(text);
    expect(rewritten.rewritten).toEqual([]);
  });
});

describe('createClaimShield', () => {
  const run = (chunks: readonly string[], shieldFacts: TerminalClaimFacts): string => {
    const shield = createClaimShield(shieldFacts);
    return chunks.map((chunk) => shield.push(chunk)).join('') + shield.flush();
  };

  it('rewrites a claim split across three deltas', () => {
    expect(run(['已', '合', '并。'], facts({ merge: 'in-flight' }))).toBe('还在合并、尚未完成。');
  });

  it('streams ordinary prose without holding anything', () => {
    const shield = createClaimShield(facts());
    expect(shield.push('x'.repeat(40))).toBe('x'.repeat(40));
    expect(shield.push('正在梳理需求')).toBe('正在梳理需求');
  });

  it('holds a phrase prefix at the tail until it resolves', () => {
    const shield = createClaimShield(facts());
    expect(shield.push('任务已')).toBe('任务');
    expect(shield.push('经合并')).toBe('还没合并');
    expect(shield.flush()).toBe('');
  });

  it('does not paint an unbacked latin claim before the word ends', () => {
    const shield = createClaimShield(facts());
    expect(shield.push('merged')).toBe('');
    expect(shield.push('d')).toBe('mergedd');
    expect(shield.flush()).toBe('');
  });

  it('does not rewrite a claim inside a latin word', () => {
    expect(run(['un', 'merged', '.'], facts())).toBe('unmerged.');
    expect(run(['re', 'deployed', ' it'], facts())).toBe('redeployed it');
  });

  it('streams a backed claim verbatim', () => {
    const shield = createClaimShield(facts({ merge: 'done' }));
    expect(shield.push('merged')).toBe('merged');
  });

  it('reassembles the same text as a whole-message rewrite', () => {
    const text = '修好了保存按钮。已合并，你放心。核心改动在 SaveButton。';
    const chunks = [...text].reduce<string[]>((acc, char, index) => {
      if (index % 3 === 0) acc.push('');
      acc[acc.length - 1] += char;
      return acc;
    }, []);
    expect(run(chunks, facts({ merge: 'in-flight' }))).toBe(
      rewriteTerminalClaims(text, facts({ merge: 'in-flight' })).text,
    );
    expect(run(chunks, facts())).not.toContain('已合并');
  });
});
