// 命令闸规则表（#866 T5 tracer：对齐 AMP 闸门哲学 + cairn 双闸）。
// AMP 哲学（docs/research/amp-native-sandbox-orb.md §2.1）：可逆免闸（Git 让
// 改错成本趋零），闸只设在不可逆处（部署、生产库）。本仓双闸（confirm = 方案
// 审批、review = 改后审计）是流程闸；本表是第三道执行层闸（命令闸），永不替
// 代前两者——ask 在无人值守 daemon 面按拒执行（无审批面），人的判断仍在
// confirm/review。
// 威胁模型 = agent 失误，不是恶意 agent：正则只能拦住写错的命令，变量展开/
// 转义/编码绕行不在本表射程内（防误不防恶，见 stripQuotedUnix 与实现票注释）。
import { describe, expect, it } from 'vitest';
import { matchPermissionRule, type PermissionRule } from '../src/index.js';

const rules: PermissionRule[] = [
  { id: 'allow-git', tool: 'Bash', matches: { command: '*git *' }, action: 'allow' },
  { id: 'ask-rm-root', tool: 'Bash', matches: { command: '*rm* -rf /*' }, action: 'ask' },
  { id: 'reject-fork', tool: 'Bash', matches: { command: '*:(){*' }, action: 'reject' },
];

describe('默认放行（第一失败方式：合法命令被拦）', () => {
  it('空表一律放行', () => {
    expect(matchPermissionRule([], 'Bash', { command: 'rm -rf /' })).toBeUndefined();
  });
  it('未命中规则一律放行', () => {
    expect(matchPermissionRule(rules, 'Bash', { command: 'pnpm test' })).toBeUndefined();
  });
  it('工具名不对不命中', () => {
    expect(matchPermissionRule(rules, 'Write', { command: 'rm -rf /' })).toBeUndefined();
  });
  it('通配工具名命中一切工具', () => {
    const r: PermissionRule[] = [{ id: 'all', tool: '*', action: 'ask' }];
    expect(matchPermissionRule(r, 'Anything', {})?.id).toBe('all');
  });
});

describe('首命中胜出（顺序即优先级）', () => {
  it('allow 写在 ask 之前则放行', () => {
    const hit = matchPermissionRule(rules, 'Bash', { command: 'git rm -rf /tmp' });
    expect(hit?.id).toBe('allow-git');
  });
  it('缺 matches 的规则命中该工具一切调用', () => {
    const r: PermissionRule[] = [{ id: 'deny-all-bash', tool: 'Bash', action: 'reject' }];
    expect(matchPermissionRule(r, 'Bash', { command: 'ls' })?.action).toBe('reject');
  });
  it('多 matches 槽必须全中', () => {
    const r: PermissionRule[] = [
      { id: 'both', tool: 'Bash', matches: { command: '*rm*', cwd: '/tmp/*' }, action: 'ask' },
    ];
    expect(matchPermissionRule(r, 'Bash', { command: 'rm x' })?.id).toBeUndefined();
    expect(matchPermissionRule(r, 'Bash', { command: 'rm x', cwd: '/tmp/a' })?.id).toBe('both');
  });
  it('缺失的参数槽按空串匹配（* 全通，字面量不中）', () => {
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

describe('glob 语义（* 通配，大小写敏感）', () => {
  it('* 匹配空串与任意串', () => {
    expect(matchPermissionRule(rules, 'Bash', { command: 'git status' })?.id).toBe('allow-git');
  });
  it('大小写敏感：RM ≠ rm', () => {
    const r: PermissionRule[] = [
      { id: 'x', tool: 'Bash', matches: { command: '*rm*' }, action: 'ask' },
    ];
    expect(matchPermissionRule(r, 'Bash', { command: 'RM -rf /' })).toBeUndefined();
  });
  it('特殊字符按字面匹配（. 不是通配）', () => {
    const r: PermissionRule[] = [
      { id: 'x', tool: 'Bash', matches: { command: 'a.c' }, action: 'ask' },
    ];
    expect(matchPermissionRule(r, 'Bash', { command: 'abc' })).toBeUndefined();
    expect(matchPermissionRule(r, 'Bash', { command: 'a.c' })?.id).toBe('x');
  });
});
