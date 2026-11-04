import { describe, expect, it } from 'vitest';
import { matchPermissionRule, type PermissionRule } from '../src/index.js';

const rules: PermissionRule[] = [
  { id: 'allow-git', tool: 'Bash', matches: { command: '*git *' }, action: 'allow' },
  { id: 'ask-rm-root', tool: 'Bash', matches: { command: '*rm* -rf /*' }, action: 'ask' },
  { id: 'reject-fork', tool: 'Bash', matches: { command: '*:(){*' }, action: 'reject' },
];

describe('default allow (first failure mode: legitimate command blocked)', () => {
  it('empty rule table allows everything', () => {
    expect(matchPermissionRule([], 'Bash', { command: 'rm -rf /' })).toBeUndefined();
  });
  it('rules not hit always allowed', () => {
    expect(matchPermissionRule(rules, 'Bash', { command: 'pnpm test' })).toBeUndefined();
  });
  it('wrong tool name does not match', () => {
    expect(matchPermissionRule(rules, 'Write', { command: 'rm -rf /' })).toBeUndefined();
  });
  it('wildcard tool name matches all tools', () => {
    const r: PermissionRule[] = [{ id: 'all', tool: '*', action: 'ask' }];
    expect(matchPermissionRule(r, 'Anything', {})?.id).toBe('all');
  });
});

describe('first hit wins (order is priority)', () => {
  it('allow written before ask wins', () => {
    const hit = matchPermissionRule(rules, 'Bash', { command: 'git rm -rf /tmp' });
    expect(hit?.id).toBe('allow-git');
  });
  it('rules missing matches hit every call of that tool', () => {
    const r: PermissionRule[] = [{ id: 'deny-all-bash', tool: 'Bash', action: 'reject' }];
    expect(matchPermissionRule(r, 'Bash', { command: 'ls' })?.action).toBe('reject');
  });
  it('multiple matches slots must all hit', () => {
    const r: PermissionRule[] = [
      { id: 'both', tool: 'Bash', matches: { command: '*rm*', cwd: '/tmp/*' }, action: 'ask' },
    ];
    expect(matchPermissionRule(r, 'Bash', { command: 'rm x' })?.id).toBeUndefined();
    expect(matchPermissionRule(r, 'Bash', { command: 'rm x', cwd: '/tmp/a' })?.id).toBe('both');
  });
  it('missing parameter slots match as empty string (* matches all, literal does not)', () => {
    const star: PermissionRule[] = [
      { id: 's', tool: 'Bash', matches: { cwd: '*' }, action: 'ask' },
    ];
    expect(matchPermissionRule(star, 'Bash', {})?.id).toBe('s');
    const lit: PermissionRule[] = [
      { id: 'l', tool: 'Bash', matches: { cwd: '/tmp' }, action: 'ask' },
    ];
    expect(matchPermissionRule(lit, 'Bash', {})).toBeUndefined();
  });
});

describe('glob semantics (* wildcard, case-sensitive)', () => {
  it('* matches the empty string and any string', () => {
    expect(matchPermissionRule(rules, 'Bash', { command: 'git status' })?.id).toBe('allow-git');
  });
  it('case-sensitive: RM != rm', () => {
    const r: PermissionRule[] = [
      { id: 'x', tool: 'Bash', matches: { command: '*rm*' }, action: 'ask' },
    ];
    expect(matchPermissionRule(r, 'Bash', { command: 'RM -rf /' })).toBeUndefined();
  });
  it('special chars match literally (. is not a wildcard)', () => {
    const r: PermissionRule[] = [
      { id: 'x', tool: 'Bash', matches: { command: 'a.c' }, action: 'ask' },
    ];
    expect(matchPermissionRule(r, 'Bash', { command: 'abc' })).toBeUndefined();
    expect(matchPermissionRule(r, 'Bash', { command: 'a.c' })?.id).toBe('x');
  });
});
