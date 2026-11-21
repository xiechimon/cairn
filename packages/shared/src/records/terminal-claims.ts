export type TerminalOutcome = 'merged' | 'landed' | 'pushed' | 'deployed' | 'tests';

export type MergeRecord = 'none' | 'in-flight' | 'done' | 'failed';

export interface TerminalClaimFacts {
  merge: MergeRecord;
  pushed: boolean;
  deployed: boolean;
  tests: boolean;
}

export const NO_TERMINAL_CLAIM_FACTS: TerminalClaimFacts = {
  merge: 'none',
  pushed: false,
  deployed: false,
  tests: false,
};

export interface TerminalClaim {
  outcome: TerminalOutcome;
  phrase: string;
  start: number;
  end: number;
  attributed: boolean;
}

interface ClaimPhrase {
  outcome: TerminalOutcome;
  text: string;
}

const CLAIM_PHRASES: readonly ClaimPhrase[] = [
  { outcome: 'merged', text: '已经合并' },
  { outcome: 'merged', text: '已合并' },
  { outcome: 'merged', text: '合并完成' },
  { outcome: 'merged', text: '合并好了' },
  { outcome: 'merged', text: '已进了主线' },
  { outcome: 'merged', text: '已进主线' },
  { outcome: 'merged', text: '已经进了主线' },
  { outcome: 'merged', text: '已经进主线' },
  { outcome: 'merged', text: '已经落到了主分支' },
  { outcome: 'merged', text: '已经落到了默认分支' },
  { outcome: 'merged', text: '已经落到主分支' },
  { outcome: 'merged', text: '已经落到默认分支' },
  { outcome: 'merged', text: '已落到了主分支' },
  { outcome: 'merged', text: '已落到了默认分支' },
  { outcome: 'merged', text: '已落到主分支' },
  { outcome: 'merged', text: '已落到默认分支' },
  { outcome: 'merged', text: 'merged' },
  { outcome: 'landed', text: '已经落地' },
  { outcome: 'landed', text: '已落地' },
  { outcome: 'landed', text: '落地完成' },
  { outcome: 'landed', text: 'landed' },
  { outcome: 'pushed', text: '已推送' },
  { outcome: 'pushed', text: '已经推送' },
  { outcome: 'pushed', text: '推送成功' },
  { outcome: 'pushed', text: '推送完成' },
  { outcome: 'pushed', text: '已推送到' },
  { outcome: 'pushed', text: 'pushed' },
  { outcome: 'deployed', text: '已部署' },
  { outcome: 'deployed', text: '已经部署' },
  { outcome: 'deployed', text: '部署完成' },
  { outcome: 'deployed', text: '已上线' },
  { outcome: 'deployed', text: '已经上线' },
  { outcome: 'deployed', text: 'deployed' },
  { outcome: 'tests', text: '测试全部通过' },
  { outcome: 'tests', text: '测试全都通过' },
  { outcome: 'tests', text: '测试都通过' },
  { outcome: 'tests', text: '测试均通过' },
  { outcome: 'tests', text: '测试已通过' },
  { outcome: 'tests', text: '测试通过' },
  { outcome: 'tests', text: '全部测试通过' },
  { outcome: 'tests', text: '测试全过' },
  { outcome: 'tests', text: 'tests pass' },
  { outcome: 'tests', text: 'test pass' },
  { outcome: 'tests', text: 'tests passed' },
  { outcome: 'tests', text: 'test passed' },
  { outcome: 'tests', text: 'all tests pass' },
  { outcome: 'tests', text: 'all test pass' },
];

const LATIN_PHRASE = /^[a-z ]+$/i;

const isLatinPhrase = (text: string): boolean => LATIN_PHRASE.test(text);

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface ClaimPattern {
  outcome: TerminalOutcome;
  source: RegExp;
}

const CLAIM_OUTCOMES: readonly TerminalOutcome[] = [
  'merged',
  'landed',
  'pushed',
  'deployed',
  'tests',
];

const CLAIM_PATTERNS: readonly ClaimPattern[] = CLAIM_OUTCOMES.map((outcome) => {
  const plain: string[] = [];
  const latin: string[] = [];
  for (const phrase of CLAIM_PHRASES) {
    if (phrase.outcome !== outcome) continue;
    (isLatinPhrase(phrase.text) ? latin : plain).push(escapeRegExp(phrase.text));
  }
  const branches = [...plain];
  if (latin.length > 0) branches.push(`(?<![a-z])(?:${latin.join('|')})(?![a-z])`);
  return { outcome, source: new RegExp(branches.join('|'), 'gi') };
});

const ATTRIBUTION_CUES: readonly string[] = [
  '报告',
  '任务',
  '线程',
  '日志',
  '执行步',
  '结论',
  '摘要',
  '摘录',
  '转述',
  'report',
  'thread',
  'log',
  'task',
  'summary',
];

const OPENING_FENCE = /^\s*```/;
const SENTENCE_BREAK = /[。！？!?\n]/;

function blankFencedBlocks(text: string): string {
  const lines = text.split('\n');
  let fenced = false;
  const blanked = lines.map((line) => {
    if (OPENING_FENCE.test(line)) {
      fenced = !fenced;
      return ' '.repeat(line.length);
    }
    return fenced ? ' '.repeat(line.length) : line;
  });
  return blanked.join('\n');
}

function sentenceOf(text: string, index: number): string {
  let start = index;
  while (start > 0 && !SENTENCE_BREAK.test(text[start - 1] ?? '')) start -= 1;
  let end = index;
  while (end < text.length && !SENTENCE_BREAK.test(text[end] ?? '')) end += 1;
  return text.slice(start, end);
}

export function findTerminalClaims(text: string): TerminalClaim[] {
  const scanned = blankFencedBlocks(text);
  const claims: TerminalClaim[] = [];
  for (const pattern of CLAIM_PATTERNS) {
    const re = new RegExp(pattern.source.source, pattern.source.flags);
    for (const match of scanned.matchAll(re)) {
      const phrase = match[0];
      if (phrase === '' || match.index === undefined) continue;
      const start = match.index;
      const end = start + phrase.length;
      if (claims.some((claim) => start < claim.end && end > claim.start)) continue;
      const sentence = sentenceOf(scanned, start).toLowerCase();
      claims.push({
        outcome: pattern.outcome,
        phrase,
        start,
        end,
        attributed: ATTRIBUTION_CUES.some((cue) => sentence.includes(cue.toLowerCase())),
      });
    }
  }
  return claims.sort((a, b) => a.start - b.start);
}

export function claimBacked(claim: TerminalClaim, facts: TerminalClaimFacts): boolean {
  switch (claim.outcome) {
    case 'merged':
    case 'landed':
      return facts.merge === 'done';
    case 'pushed':
      return facts.pushed;
    case 'deployed':
      return facts.deployed;
    case 'tests':
      return facts.tests;
  }
}

const ATTRIBUTION_ESCAPES: readonly TerminalOutcome[] = ['tests', 'deployed'];

export function unbackedTerminalClaims(text: string, facts: TerminalClaimFacts): TerminalClaim[] {
  return findTerminalClaims(text).filter(
    (claim) =>
      !claimBacked(claim, facts) &&
      !(claim.attributed && ATTRIBUTION_ESCAPES.includes(claim.outcome)),
  );
}

export function groundedPhrase(claim: TerminalClaim, facts: TerminalClaimFacts): string {
  switch (claim.outcome) {
    case 'merged':
    case 'landed':
      switch (facts.merge) {
        case 'in-flight':
          return '还在合并、尚未完成';
        case 'failed':
          return '合并没有成功';
        case 'done':
          return claim.phrase;
        case 'none':
          return '还没合并';
      }
      break;
    case 'pushed':
      return facts.pushed ? claim.phrase : '推送还没确认';
    case 'deployed':
      return facts.deployed ? claim.phrase : '部署没有记录';
    case 'tests':
      return facts.tests ? claim.phrase : '测试结果以任务报告为准';
  }
  return claim.phrase;
}

export interface TerminalClaimRewrite {
  text: string;
  rewritten: TerminalClaim[];
}

export function rewriteTerminalClaims(
  text: string,
  facts: TerminalClaimFacts,
): TerminalClaimRewrite {
  const rewritten = unbackedTerminalClaims(text, facts);
  if (rewritten.length === 0) return { text, rewritten };
  let out = '';
  let cursor = 0;
  for (const claim of rewritten) {
    out += text.slice(cursor, claim.start);
    out += groundedPhrase(claim, facts);
    cursor = claim.end;
  }
  return { text: out + text.slice(cursor), rewritten };
}

export interface ClaimShield {
  push(chunk: string): string;
  flush(): string;
}

const CLAIM_PREFIXES = new Map<string, boolean>();
let CLAIM_MAX_PREFIX = 0;
for (const phrase of CLAIM_PHRASES) {
  const lower = phrase.text.toLowerCase();
  const latin = isLatinPhrase(phrase.text);
  for (let i = 1; i < lower.length; i += 1) {
    const prefix = lower.slice(0, i);
    if (!CLAIM_PREFIXES.has(prefix)) CLAIM_PREFIXES.set(prefix, latin);
  }
  CLAIM_MAX_PREFIX = Math.max(CLAIM_MAX_PREFIX, lower.length - 1);
}

const LATIN_CHAR = /[a-z]/i;

function holdLength(pending: string, edge: string): number {
  let best = 0;
  const limit = Math.min(CLAIM_MAX_PREFIX, pending.length);
  for (let h = 1; h <= limit; h += 1) {
    const needsBoundary = CLAIM_PREFIXES.get(pending.slice(pending.length - h).toLowerCase());
    if (needsBoundary === undefined) continue;
    if (needsBoundary) {
      const before = pending.length === h ? edge : pending[pending.length - h - 1];
      if (before !== undefined && LATIN_CHAR.test(before)) continue;
    }
    if (h > best) best = h;
  }
  return best;
}

export function createClaimShield(facts: TerminalClaimFacts): ClaimShield {
  let pending = '';
  let edge = '';
  const drain = (final: boolean): string => {
    let out = '';
    const emit = (part: string): void => {
      if (part === '') return;
      out += part;
      edge = part[part.length - 1] ?? edge;
    };
    for (;;) {
      const offset = edge === '' ? 0 : 1;
      const first = unbackedTerminalClaims(edge + pending, facts).find(
        (claim) => claim.start >= offset,
      );
      if (first !== undefined) {
        const start = first.start - offset;
        const end = first.end - offset;
        if (final || end < pending.length || !isLatinPhrase(first.phrase)) {
          emit(pending.slice(0, start));
          emit(groundedPhrase(first, facts));
          pending = pending.slice(end);
          continue;
        }
        emit(pending.slice(0, start));
        pending = pending.slice(start);
        break;
      }
      if (final) {
        emit(pending);
        pending = '';
        break;
      }
      const hold = holdLength(pending, edge);
      emit(pending.slice(0, pending.length - hold));
      pending = pending.slice(pending.length - hold);
      break;
    }
    return out;
  };
  return {
    push: (chunk) => {
      pending += chunk;
      return drain(false);
    },
    flush: () => drain(true),
  };
}
