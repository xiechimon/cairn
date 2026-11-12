import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_BASH_PATTERNS,
  decideBashCommand,
  decideToolCall,
  formatGateRefusal,
  formatToolRefusal,
  gateToolCallHandler,
  type PermissionRule,
} from '../src/backend/command-gate.js';

function bashEvent(command: string) {
  return { type: 'tool_call' as const, toolCallId: 't1', toolName: 'bash', input: { command } };
}
function toolEvent(toolName: string, input: Record<string, unknown> = {}) {
  return { type: 'tool_call' as const, toolCallId: 't2', toolName, input };
}

describe('allow by default (F1: legitimate commands always allow)', () => {
  const allowed = [
    'ls -la',
    'pnpm test',
    'pnpm --filter @cairn/web e2e:affected',
    'git status && git diff --stat',
    'git push origin session-123',
    'git push --force-with-lease origin session-123',
    'rm -rf ./dist',
    'rm -rf apps/web/dist node_modules/.cache',
    'rm -rf /tmp/cairn-before-main',
    'grep -r "rm -rf /" .',
    'echo "rm -rf /"',
    "echo 'mkfs.ext4 /dev/sda'",
    'find . -name "*.log" -delete',
    'vite build --mode fixture',
    '',
    '   ',
  ];
  for (const command of allowed) {
    it(JSON.stringify(command), () => {
      expect(decideBashCommand(command).action).toBe('allow');
    });
  }
});

describe('gate only irreversible shapes (nothing else)', () => {
  const asked: Array<[string, string]> = [
    ['rm -rf /', 'ask-rm-rf-root'],
    ['sudo rm -rf /', 'ask-rm-rf-root'],
    ['rm -rf /*', 'ask-rm-rf-root'],
    ['rm -rf ~', 'ask-rm-rf-home'],
    ['rm -rf $HOME', 'ask-rm-rf-home'],
    [`rm -rf ${'$'}{HOME}`, 'ask-rm-rf-home'],
    [`rm -rf ${'$'}{HOME}/tmp`, 'ask-rm-rf-home'],
    ['rm -rf / --no-preserve-root', 'ask-rm-rf-root'],
    ['rm --recursive --force /', 'ask-rm-rf-root'],
    ['true; rm -rf /', 'ask-rm-rf-root'],
    ['ls /tmp && rm -rf ~', 'ask-rm-rf-home'],
    ['mkfs.ext4 /dev/sda1', 'ask-mkfs'],
    ['sudo mkfs -t ext4 /dev/sdb', 'ask-mkfs'],
    ['dd if=/dev/zero of=/dev/sda bs=1M', 'ask-dd-disk'],
    ['shutdown -h now', 'ask-power'],
    ['sudo reboot', 'ask-power'],
    ['halt', 'ask-power'],
  ];
  for (const [command, ruleId] of asked) {
    it(`${command} → ${ruleId}`, () => {
      const d = decideBashCommand(command);
      expect(d.action).toBe('ask');
      expect(d.ruleId).toBe(ruleId);
    });
  }
  it('fork bomb rejected outright (reject: never a legitimate use)', () => {
    const d = decideBashCommand(':(){ :|:& };:');
    expect(d.action).toBe('reject');
    expect(d.ruleId).toBe('reject-forkbomb');
  });
});

describe('shell syntax does not hide a gated command', () => {
  const asked: Array<[string, string]> = [
    ["'rm' -rf '/'", 'ask-rm-rf-root'],
    ['rm -rf "$HOME"', 'ask-rm-rf-home'],
    ['sudo -n /bin/rm -rf /', 'ask-rm-rf-root'],
    ['exec /usr/bin/../bin/rm -rf /', 'ask-rm-rf-root'],
    ["bash -c 'rm -rf /'", 'ask-rm-rf-root'],
    ["eval 'shutdown -h now'", 'ask-power'],
    ['true & rm -rf /', 'ask-rm-rf-root'],
    ['true |& mkfs.ext4 /dev/sda1', 'ask-mkfs'],
    ['(rm -rf /)', 'ask-rm-rf-root'],
    ['{ rm -rf ~; }', 'ask-rm-rf-home'],
    ['$(rm -rf /)', 'ask-rm-rf-root'],
    ['echo $(dd if=/dev/zero of=/dev/sda)', 'ask-dd-disk'],
    ['`reboot`', 'ask-power'],
    ['if true; then rm -rf /; fi', 'ask-rm-rf-root'],
    ['</dev/null rm -rf /', 'ask-rm-rf-root'],
    ['FOO=1 rm -rf /', 'ask-rm-rf-root'],
    ['command -p /bin/rm -rf /', 'ask-rm-rf-root'],
    ['env -i /sbin/halt', 'ask-power'],
    ['nice -n 19 rm -rf /', 'ask-unresolved-command'],
    ['timeout 1 rm -rf /', 'ask-rm-rf-root'],
    ['find / -exec rm -rf / \\;', 'ask-rm-rf-root'],
    ['xargs rm -rf /', 'ask-rm-rf-root'],
    ['echo "$(rm -rf /)"', 'ask-rm-rf-root'],
    ['echo "`reboot`"', 'ask-power'],
    ['$(echo rm) -rf /', 'ask-rm-rf-root'],
    ['"$(echo rm)" -rf /', 'ask-rm-rf-root'],
    ['chroot / rm -rf /', 'ask-rm-rf-root'],
    ['unshare rm -rf /', 'ask-rm-rf-root'],
    ['echo ok # comment\nreboot', 'ask-power'],
    ['echo foo#bar; reboot', 'ask-power'],
    ['dd of="/dev/null" of=/dev/sda if=/dev/zero', 'ask-dd-disk'],
    ['echo "$(reboot)"', 'ask-power'],
    ["$(echo 'rm -rf /')", 'ask-unresolved-command'],
    ['"$(echo reboot)"', 'ask-unresolved-command'],
    ['echo `echo \\`reboot\\``', 'ask-power'],
    ['cat <<EOF\n$(reboot)\nEOF', 'ask-power'],
    ["cat <<'EOF'; reboot\ntext\nEOF", 'ask-power'],
    ["flock /tmp/lock -c 'reboot'", 'ask-power'],
    ['flock -E 1 /tmp/lock reboot', 'ask-unresolved-command'],
    ['unshare --kill-child reboot', 'ask-power'],
    ['nsenter -t 1 --mount reboot', 'ask-unresolved-command'],
    ['/bin/r[m] -rf /', 'ask-unresolved-command'],
    ['/usr/sbin/reboo[t]', 'ask-unresolved-command'],
    ['bash <<< reboot', 'ask-power'],
    ["sh <<< 'rm -rf /'", 'ask-rm-rf-root'],
    ["bash <(printf 'reboot\\n')", 'ask-unresolved-command'],
    ["source <(printf 'reboot\\n')", 'ask-unresolved-command'],
    ['find . -maxdepth 0 -ok reboot \\;', 'ask-power'],
    ['xargs -e reboot', 'ask-power'],
    ['xargs --eof reboot', 'ask-power'],
    ["printf '%s\\n' \"<<'EOF'\"\nreboot\nEOF", 'ask-power'],
    ['find . -maxdepth 0 -exec true \\; -exec reboot \\;', 'ask-power'],
  ];
  for (const [command, ruleId] of asked) {
    it(`${command} → ${ruleId}`, () => {
      const d = decideBashCommand(command);
      expect(d.action).toBe('ask');
      expect(d.ruleId).toBe(ruleId);
    });
  }

  const allowed = [
    'echo "rm -rf /"',
    "echo 'mkfs.ext4 /dev/sda'",
    "echo '$(rm -rf /)'",
    'echo $(date)',
    'command -v rm',
    `rm -rf '${'$'}{HOME}'`,
    'dd if=/dev/zero of=/dev/null',
    "dd of='/dev/null'",
    'rm -rf ./dist',
    '/bin/echo ok',
    'sh -c \'echo "rm -rf /"\'',
    'echo "\\$(reboot)"',
    'echo ok # reboot',
    'echo foo#bar',
    'dd of=/dev/sda of=/dev/null',
  ];
  for (const command of allowed) {
    it(`${JSON.stringify(command)} stays allow`, () => {
      expect(decideBashCommand(command).action).toBe('allow');
    });
  }

  it('fork bomb inside a shell string is still rejected', () => {
    const d = decideBashCommand("eval ':(){ :|:& };:'");
    expect(d.action).toBe('reject');
    expect(d.ruleId).toBe('reject-forkbomb');
  });
  it('quoted fork-bomb text is not a command', () => {
    expect(decideBashCommand("echo ':(){ :|:& };:'").action).toBe('allow');
  });
  it('a non-static shell script is not allowed', () => {
    const d = decideBashCommand('bash -c "$(echo rm -rf /)"');
    expect(d.action).toBe('ask');
    expect(d.ruleId).toBe('ask-unresolved-command');
  });
  it('a parameter expansion in command position is not allowed', () => {
    const d = decideBashCommand('$BIN -rf /');
    expect(d.action).toBe('ask');
    expect(d.ruleId).toBe('ask-rm-rf-root');
  });
  it('a parameter expansion with no gated shape is still not allowed', () => {
    const d = decideBashCommand('$BIN status');
    expect(d.action).toBe('ask');
    expect(d.ruleId).toBe('ask-unresolved-command');
  });
});

describe('rule table is programmable (caller-provided table wins over the default)', () => {
  it('custom table hit → verdict per the custom table', () => {
    const custom: PermissionRule[] = [
      { id: 'deny-test', tool: 'Bash', matches: { command: '*test*' }, action: 'reject' },
    ];
    const d = decideBashCommand('pnpm test', custom);
    expect(d).toEqual({ action: 'reject', ruleId: 'deny-test' });
  });
  it('custom table miss → fall back to the default table', () => {
    const custom: PermissionRule[] = [
      { id: 'other', tool: 'Bash', matches: { command: '*nope*' }, action: 'reject' },
    ];
    const d = decideBashCommand('rm -rf /', custom);
    expect(d.action).toBe('ask');
  });
  it('default modes non-empty, ids unique and all lowercase-hyphenated (audit shape)', () => {
    expect(DEFAULT_BASH_PATTERNS.length).toBeGreaterThan(0);
    const ids = DEFAULT_BASH_PATTERNS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9-]*$/);
  });
});

describe('rejection wording (the agent can act on it)', () => {
  it('contains rule id, action, and a suggested alternative', () => {
    const text = formatGateRefusal('rm -rf /', { action: 'ask', ruleId: 'ask-rm-rf-root' });
    expect(text).toContain('ask-rm-rf-root');
    expect(text).toContain('rm -rf /');
    expect(text).toMatch(/confirm|review|replan/i);
  });
  it('tool-surface rejection wording same family (contains tool name and rule id)', () => {
    const text = formatToolRefusal('mcp__demo__echo', { action: 'reject', ruleId: 'deny-echo' });
    expect(text).toContain('deny-echo');
    expect(text).toContain('mcp__demo__echo');
    expect(text).toMatch(/confirm|review|replan/i);
  });
});

describe('rule table generic verdict (F6: non-bash tools go through the same gate)', () => {
  it('exact MCP tool-name rule hit → verdict per the table', () => {
    const rules: PermissionRule[] = [
      { id: 'deny-echo', tool: 'mcp__demo__echo', action: 'reject' },
    ];
    expect(decideToolCall('mcp__demo__echo', { text: 'hi' }, rules)).toEqual({
      action: 'reject',
      ruleId: 'deny-echo',
    });
  });
  it('`*` all-tools rule hits MCP calls (including argument-slot globs)', () => {
    const rules: PermissionRule[] = [
      { id: 'deny-write', tool: '*', matches: { uri: 'secret:*' }, action: 'ask' },
    ];
    expect(decideToolCall('read_mcp_resource', { uri: 'secret://x' }, rules)?.ruleId).toBe(
      'deny-write',
    );
    expect(decideToolCall('read_mcp_resource', { uri: 'public://x' }, rules)).toBeUndefined();
  });
  it('first hit wins; miss / no rule table = undefined (allow by default)', () => {
    const rules: PermissionRule[] = [
      { id: 'allow-demo', tool: 'mcp__demo__echo', action: 'allow' },
      { id: 'deny-all', tool: '*', action: 'reject' },
    ];
    expect(decideToolCall('mcp__demo__echo', {}, rules)).toEqual({
      action: 'allow',
      ruleId: 'allow-demo',
    });
    expect(decideToolCall('mcp__other__t', {}, rules)?.ruleId).toBe('deny-all');
    expect(decideToolCall('mcp__demo__echo', {})).toBeUndefined();
    expect(decideToolCall('mcp__demo__echo', {}, [])).toBeUndefined();
  });
  it('non-string argument slots match as empty string (glob does not crash)', () => {
    const rules: PermissionRule[] = [
      { id: 'slot', tool: 'mcp__demo__echo', matches: { n: '*' }, action: 'reject' },
    ];
    expect(decideToolCall('mcp__demo__echo', { n: 3 }, rules)?.ruleId).toBe('slot');
  });
});

describe('tool_call blocking handler (#929 hook; F4 unattended)', () => {
  it('bash ask → block + reason (contains rule id and command), no interactive surface required', async () => {
    const handler = gateToolCallHandler({});
    const result = await handler(bashEvent('rm -rf /'));
    expect(result?.block).toBe(true);
    expect(result?.reason).toContain('ask-rm-rf-root');
    expect(result?.reason).toContain('rm -rf /');
  });
  it('bash allow → undefined (execution surface uninvolved, pi built-in bash runs as-is)', async () => {
    const handler = gateToolCallHandler({});
    expect(await handler(bashEvent('ls -la'))).toBeUndefined();
  });
  it('non-bash without rules → undefined (MCP calls pass as usual)', async () => {
    const handler = gateToolCallHandler({});
    expect(await handler(toolEvent('mcp__demo__echo', { text: 'hi' }))).toBeUndefined();
  });
  it('non-bash rule hit (MCP surface) → block + tool-surface wording', async () => {
    const handler = gateToolCallHandler({
      rules: [{ id: 'deny-echo', tool: 'mcp__demo__echo', action: 'reject' }],
    });
    const result = await handler(toolEvent('mcp__demo__echo', { text: 'hi' }));
    expect(result?.block).toBe(true);
    expect(result?.reason).toContain('deny-echo');
    expect(result?.reason).toContain('mcp__demo__echo');
  });
  it("bash dual-name rule unchanged (F7: both 'bash'/'Bash' hit)", async () => {
    const handler = gateToolCallHandler({
      rules: [
        { id: 'deny-test', tool: 'Bash', matches: { command: '*secret*' }, action: 'reject' },
      ],
    });
    expect((await handler(bashEvent('echo secret-data')))?.reason).toContain('deny-test');
  });
  it('ask/reject log one gate line; allow is silent (no tax on the non-steady state)', async () => {
    const log = vi.fn();
    const handler = gateToolCallHandler({ log });
    await handler(bashEvent('ls -la'));
    await handler(toolEvent('mcp__demo__echo'));
    expect(log).not.toHaveBeenCalled();
    await handler(bashEvent('rm -rf /'));
    await gateToolCallHandler({
      rules: [{ id: 'deny-echo', tool: 'mcp__demo__echo', action: 'reject' }],
      log,
    })(toolEvent('mcp__demo__echo'));
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[0]?.[0]).toContain('ask-rm-rf-root');
    expect(log.mock.calls[1]?.[0]).toContain('deny-echo');
  });
});
