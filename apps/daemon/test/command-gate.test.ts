import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import {
  DEFAULT_BASH_PATTERNS,
  decideBashCommand,
  decideToolCall,
  formatGateRefusal,
  formatToolRefusal,
  gateToolCallHandler,
  type PermissionRule,
  phoneControlRefusal,
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
    'adb devices',
    'adb devices -l',
    'adb version',
    'adb mdns services',
    'adb start-server',
    'adb kill-server',
    'adb --help',
    'echo "adb shell input tap 1 2"',
    'PAGER=less git -p log',
    'GIT_EDITOR=vim git commit',
    'git -c user.name=ian commit --allow-empty',
    'git -c core.sshCommand=ssh fetch origin',
    'tar --checkpoint-action=ttyout=%u -cf x.tar a',
    'test -f /tmp/x -a -r /tmp/y',
    'test -x adb',
    'test -z "$(git status --porcelain)"',
    'test -n "$(git log --oneline -1)" && echo has-commit',
    'export TOOL=adb',
    'declare -x TOOL=adb',
    "xcodebuild test -destination 'platform=iOS Simulator,name=iPhone 15 Pro'",
    'trap -l',
    'trap -p EXIT',
    'hash -r',
    'hash -p /usr/bin/grep g',
    'hash git',
    'caffeinate ls -la',
    'arch -arm64 ls',
    'script /dev/null ls',
    'X=5 echo ok',
    'FOO=$HOME ls',
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
    ['adb shell input tap 100 200', 'ask-phone-control'],
    ['adb -s 192.168.1.20:42155 shell input tap 100 200', 'ask-phone-control'],
    ['adb -t 2 shell getprop ro.serialno', 'ask-phone-control'],
    ['adb exec-out screencap -p', 'ask-phone-control'],
    ['adb pull /sdcard/dcim ./photos', 'ask-phone-control'],
    ['adb push yadb /data/local/tmp/yadb', 'ask-phone-control'],
    ['adb pair 192.168.1.20:37001 123456', 'ask-phone-control'],
    ['adb connect 192.168.1.20:42155', 'ask-phone-control'],
    ['adb logcat', 'ask-phone-control'],
    ['adb install app.apk', 'ask-phone-control'],
    ['adb emu avd snapshot save snap1', 'ask-phone-control'],
    ['adb', 'ask-phone-control'],
    ['xcrun devicectl list devices', 'ask-phone-control'],
    ['xcrun devicectl device install app --device 00008110', 'ask-phone-control'],
    ['xcrun devicectl device copy from --device 00008110 /a /b', 'ask-phone-control'],
    ['xcrun --sdk iphoneos devicectl list devices', 'ask-phone-control'],
    ['xcrun simctl list', 'ask-phone-control'],
    ['xcodebuild -scheme WebDriverAgentRunner -destination id=x test', 'ask-phone-control'],
    ["xcodebuild test -destination 'platform=iOS,id=00008110-001234A0'", 'ask-phone-control'],
    ["xcodebuild test -destination 'platform=iOS,name=iPhone 15 Pro'", 'ask-phone-control'],
    ['iproxy 8100 8100', 'ask-phone-control'],
    ['tidevice screenshot out.png', 'ask-phone-control'],
    ['ideviceinstaller -l', 'ask-phone-control'],
    ['idevicediagnostics ioreg', 'ask-phone-control'],
    ['afcclient -l', 'ask-phone-control'],
    ['pymobiledevice3 apps list', 'ask-phone-control'],
    ['simctl list', 'ask-phone-control'],
    ['devicectl list devices', 'ask-phone-control'],
    ['ios-deploy -d', 'ask-phone-control'],
    ['idb ui describe-all', 'ask-phone-control'],
    ['gidevice screenshot /tmp/s.png', 'ask-phone-control'],
    ['ADB shell input tap 1 2', 'ask-phone-control'],
    ['XCRUN devicectl list devices', 'ask-phone-control'],
    ['IDEVICEINFO', 'ask-phone-control'],
    ['osascript -e \'do shell script "adb shell id"\'', 'ask-phone-control'],
    ['osascript -l JavaScript -e \'a.doShellScript("adb shell id")\'', 'ask-phone-control'],
    [
      'osascript -e \'tell application "Terminal" to do script "adb shell id"\'',
      'ask-phone-control',
    ],
    ["osascript -e 'set c to \"adb shell id\"' -e 'do shell script c'", 'ask-phone-control'],
    ['osascript /tmp/helper.scpt', 'ask-phone-control'],
    ['python3 -m pymobiledevice3 udid', 'ask-phone-control'],
    ['python3 -mpymobiledevice3 udid', 'ask-phone-control'],
    ['pythonw -m pymobiledevice3 udid', 'ask-phone-control'],
    ["python3 -c 'import pymobiledevice3'", 'ask-phone-control'],
    ['pipx run pymobiledevice3 udid', 'ask-phone-control'],
    ['uv run --with pymobiledevice3 python -V', 'ask-phone-control'],
    ['xcrun SIMCTL erase all', 'ask-phone-control'],
    ['xcrun DEVICectl list devices', 'ask-phone-control'],
    ['python3 -m PYMOBILEDEVICE3 udid', 'ask-phone-control'],
    ['xcodebuild -scheme WEBDRIVERAGENT test', 'ask-phone-control'],
    ['coproc X adb shell id', 'ask-phone-control'],
    ['coproc adb', 'ask-phone-control'],
    ["ssh host 'adb shell id'", 'ask-phone-control'],
    ["tmux send-keys 'adb shell id'", 'ask-phone-control'],
    ['tmux new-session adb shell id', 'ask-phone-control'],
    ['screen -dm adb shell id', 'ask-phone-control'],
    ["su -c 'adb shell id'", 'ask-phone-control'],
    ['launchctl asuser 501 adb shell id', 'ask-phone-control'],
    ["parallel 'adb shell input tap 1 1'", 'ask-phone-control'],
    ["watch 'adb shell input tap 1 1'", 'ask-phone-control'],
    ['xcrun xctrace record --template Automation --device u1', 'ask-phone-control'],
    ['osascript -l JavaScript -e \'$.system("adb shell id")\'', 'ask-phone-control'],
    ['osascript -l JavaScript -e \'$. system("adb shell id")\'', 'ask-phone-control'],
    ["osascript -l JavaScript -e \"$['system']('adb shell id')\"", 'ask-phone-control'],
    ['osascript -l JavaScript -e \'$.system.call($, "adb shell id")\'', 'ask-phone-control'],
    ["ssh -o 'ProxyCommand=adb shell input tap 1 2' host", 'ask-phone-control'],
    ["ssh -o 'LocalCommand=adb shell id' -o PermitLocalCommand=yes host", 'ask-phone-control'],
    ["ssh -oProxyCommand='adb shell id' host", 'ask-phone-control'],
    ["su --command='adb shell id'", 'ask-phone-control'],
    ['exec adb shell id', 'ask-phone-control'],
    ['xargs adb shell id', 'ask-phone-control'],
    ["let 'a[$(adb shell id)]=0'", 'ask-phone-control'],
    ["declare 'a[$(adb)]=0'", 'ask-phone-control'],
    ["printf -v 'a[$(adb shell id)]' ''", 'ask-phone-control'],
    ["read 'a[$(adb shell id)]'", 'ask-phone-control'],
    ["unset 'a[$(adb shell id)]'", 'ask-phone-control'],
    ["export 'A=$(adb shell id)'", 'ask-phone-control'],
    ["PAGER='adb shell id' git -p log", 'ask-phone-control'],
    ["EDITOR='adb shell getprop ro.serialno' crontab -e", 'ask-phone-control'],
    ["GIT_EDITOR='adb shell id' git commit --allow-empty", 'ask-phone-control'],
    ["PS4='$(adb shell id)' bash -xc ':'", 'ask-phone-control'],
    ["git -c core.sshCommand='adb shell id' fetch origin", 'ask-phone-control'],
    ["git -c alias.x='!adb shell input tap 1 1' x", 'ask-phone-control'],
    ["tar --checkpoint-action='exec=adb shell id' -cf x.tar a", 'ask-phone-control'],
    ["test -v 'a[$(adb shell id)]'", 'ask-phone-control'],
    ["test 'a[$(adb shell id)]' -eq 0", 'ask-phone-control'],
    ["trap 'adb shell id' EXIT", 'ask-phone-control'],
    ['caffeinate adb shell id', 'ask-phone-control'],
    ['arch -arm64 adb shell id', 'ask-phone-control'],
    ['script /dev/null adb shell id', 'ask-phone-control'],
    ['socat TCP:127.0.0.1:1 EXEC:adb', 'ask-phone-control'],
    ['hash -p /usr/bin/adb a', 'ask-phone-control'],
    ['hash -r -p /usr/bin/adb a', 'ask-phone-control'],
    ['hash -p/usr/bin/adb a', 'ask-phone-control'],
    ['hash -rp /usr/bin/adb a', 'ask-phone-control'],
    ['hash -p /usr/bin/osascript a', 'ask-phone-control'],
    ['hash -p /usr/bin/xcrun a', 'ask-unresolved-command'],
    ['hash -p /usr/bin/xcodebuild a', 'ask-unresolved-command'],
    [
      'script /dev/null osascript -e \'do shell script "adb shell input tap 1 1"\'',
      'ask-phone-control',
    ],
    ['ssh host osascript -e \'do shell script "adb shell id"\'', 'ask-phone-control'],
    ['xcrun osascript -e \'do shell script "adb shell id"\'', 'ask-phone-control'],
    ["xcrun xcodebuild -destination 'platform=iOS' test", 'ask-phone-control'],
    ['xcrun xcrun devicectl list devices', 'ask-phone-control'],
    ["PAGER+='adb shell id' git -p log", 'ask-phone-control'],
    ["EDITOR+='adb shell id' git commit", 'ask-phone-control'],
    ["GIT_CONFIG_PARAMETERS='alias.x=!adb shell id' git x", 'ask-phone-control'],
    ["GIT_CONFIG_PARAMETERS='a.b=1 alias.x=!adb shell id' git x", 'ask-phone-control'],
    [
      "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=alias.x GIT_CONFIG_VALUE_0='!adb shell id' git x",
      'ask-phone-control',
    ],
    ["GIT_EXTERNAL_DIFF='adb shell id' git diff", 'ask-phone-control'],
    ["LESSOPEN='|adb shell id' less x", 'ask-phone-control'],
    ["tar -xf x.tar --to-command='adb shell id'", 'ask-phone-control'],
    ['tar -cf x.tar -I adb', 'ask-phone-control'],
    ["tar --info-script='adb shell id' -cf x.tar a", 'ask-phone-control'],
    ['scp -S adb host:f .', 'ask-phone-control'],
    ['sftp -S adb host', 'ask-phone-control'],
    ['ssh host xcodebuild -destination platform=iOS', 'ask-phone-control'],
    ['osascript -e \'tell app "Terminal" to doScript("adb shell id")\'', 'ask-phone-control'],
    ['osascript -e \'do shell script ("ad" & "b shell id")\'', 'ask-phone-control'],
    ['osascript -e \'do shell script (system attribute "C")\'', 'ask-phone-control'],
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
    ["bash -c 'adb shell id'", 'ask-phone-control'],
    ['env adb shell id', 'ask-phone-control'],
    ['env ADB shell id', 'ask-phone-control'],
    ['xargs adb', 'ask-phone-control'],
    ['find /tmp -exec adb shell id \\;', 'ask-phone-control'],
    ['a${E}db shell id', 'ask-unresolved-command'],
    ['a$Edb shell id', 'ask-unresolved-command'],
    ['a`e`db shell id', 'ask-unresolved-command'],
    ['a$(x)db shell id', 'ask-unresolved-command'],
    ['doas adb shell id', 'ask-phone-control'],
    ['pkexec adb shell id', 'ask-phone-control'],
    ['run0 adb shell id', 'ask-phone-control'],
    ['watch adb shell id', 'ask-phone-control'],
    ['parallel adb shell id', 'ask-phone-control'],
    ['uvx pymobiledevice3 udid', 'ask-phone-control'],
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
    'echo $HOME',
    'xcrun --find clang',
    'xcodebuild -list',
    'osascript -e "display notification \\"hi\\""',
    'python3 -m http.server',
    'watch -t date',
    'parallel echo hi',
    'doas ls /root',
    'osascript -e "display notification \\"adb is nice\\""',
    'at now',
    'tmux list-sessions',
    'ssh host uname',
    'coproc X',
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

describe('command heads that collide with Object.prototype members', () => {
  for (const head of ['constructor', 'toString', 'hasOwnProperty', 'valueOf', '__proto__']) {
    it(`${head} --flag decides as an unknown command instead of crashing the gate`, () => {
      expect(decideBashCommand(`${head} --force ls`).action).toBe('allow');
    });
  }
  it('a fake wrapper head with a single-dash flag decides instead of crashing', () => {
    expect(decideBashCommand('constructor -x ls').action).toBe('allow');
    expect(decideBashCommand('/usr/bin/constructor -x ls').action).toBe('allow');
  });
});

describe('phoneControlRefusal on no-approval surfaces (owner Mac, orb shell)', () => {
  const refused = [
    'adb shell input tap 1 1',
    'X=adb; $X shell input tap 1 1',
    "X='rm -rf /'; $X",
    '$(echo adb) shell input tap 1 1',
    'X=adb; eval $X',
    'shopt -s expand_aliases; alias p=adb; p shell id',
    'nice -n 1 adb shell id',
    'nice -n 1 custom-tool',
    'X=$HOME/bin; $X/tool --version',
    '[a]db shell input tap 1 1',
    "x='ad'; y='b'; $x$y shell input tap 1 1",
    "parallel 'adb shell input tap 1 1'",
    "ssh host 'adb shell id'",
    "ssh -o 'ProxyCommand=adb shell input tap 1 2' host",
    "su --command='adb shell id'",
    "let 'a[$(adb shell id)]=0'",
    "B='ad'; C='b'; let 'a[$($B$C)]=0'",
    'osascript /tmp/helper.scpt',
    'xcrun devicectl list devices',
    'xcrun xctrace record --template Automation --device u1',
  ];
  for (const command of refused) {
    it(`${command} → refused`, () => {
      expect(phoneControlRefusal(command)).toMatch(/^command gate /);
    });
  }
  const allowed = [
    'adb devices -l',
    'echo $HOME',
    'echo "adb shell input tap 1 1"',
    'ls /tmp',
    'xcrun --find clang',
    'osascript -e "display notification \\"adb is nice\\""',
  ];
  for (const command of allowed) {
    it(`${command} → runs`, () => {
      expect(phoneControlRefusal(command)).toBeUndefined();
    });
  }
});

describe('rule table is programmable (caller-provided table wins over the default)', () => {
  it('a rule slot naming an Object.prototype member reads as absent, not as the inherited member', () => {
    const custom: PermissionRule[] = [
      { id: 'slot-lit', tool: '*', matches: { toString: 'literal' }, action: 'reject' },
    ];
    expect(decideBashCommand('ls', custom).action).toBe('allow');
    expect(decideToolCall('read_mcp_resource', { uri: 'secret://x' }, custom)).toBeUndefined();
  });
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

describe('folder grants bound where tool calls can reach', () => {
  let scratch: string | undefined;
  afterEach(() => {
    if (scratch !== undefined) releaseTestTempDir(scratch);
    scratch = undefined;
  });

  function folders(extraRoots: string[] = []) {
    if (scratch === undefined) scratch = makeTestTempDir('cairn-gate-');
    const cwd = join(scratch, 'work');
    const outside = join(scratch, 'outside');
    mkdirSync(cwd, { recursive: true });
    mkdirSync(outside, { recursive: true });
    return { ctx: { cwd, roots: extraRoots }, cwd, outside };
  }

  it('paths inside the cwd and an enabled root stay allowed', () => {
    const { ctx, cwd } = folders();
    writeFileSync(join(cwd, 'note.txt'), 'hi');
    expect(decideBashCommand('cat ./note.txt', undefined, ctx).action).toBe('allow');
    expect(decideBashCommand('cat note.txt', undefined, ctx).action).toBe('allow');
    expect(decideBashCommand('echo hi > out.txt', undefined, ctx).action).toBe('allow');
    const extra = join(scratch ?? '', 'extra');
    mkdirSync(extra, { recursive: true });
    const widened = { cwd: ctx.cwd, roots: [extra] };
    expect(decideBashCommand(`cat ${extra}/data`, undefined, widened).action).toBe('allow');
  });

  it('absolute, traversal and symlink-escaping paths are rejected with folder-grant', () => {
    const { ctx, cwd, outside } = folders();
    const cases = [
      `cat ${outside}/secret`,
      'cat ../escape',
      `cat ${cwd}/../escape`,
      'cp a ../../b',
      `head ${outside}/../outside/secret`,
      'cat $SECRET/dir',
    ];
    for (const command of cases) {
      const d = decideBashCommand(command, undefined, ctx);
      expect(`${command} → ${d.ruleId}`).toBe(`${command} → folder-grant`);
      expect(d.action).toBe('reject');
    }
    writeFileSync(join(outside, 'secret'), 'x');
    symlinkSync(join(outside, 'secret'), join(cwd, 'linked'));
    expect(decideBashCommand('cat ./linked', undefined, ctx).ruleId).toBe('folder-grant');
  });

  it('redirect targets are checked, and /dev/null stays usable', () => {
    const { ctx, outside } = folders();
    expect(decideBashCommand(`echo hi > ${outside}/log`, undefined, ctx).ruleId).toBe(
      'folder-grant',
    );
    expect(decideBashCommand('echo hi > /dev/null', undefined, ctx).action).toBe('allow');
    expect(decideBashCommand('cat /dev/null', undefined, ctx).action).toBe('allow');
  });

  it('empty roots deny everything outside the cwd', () => {
    const { ctx, outside } = folders();
    expect(decideToolCall('read', { path: `${outside}/f` }, undefined, ctx)).toEqual({
      action: 'reject',
      ruleId: 'folder-grant',
    });
  });

  it('skill read roots allow reads without granting writes, shell access or symlink escapes', async () => {
    const { ctx, outside } = folders();
    const skill = join(outside, 'demo');
    mkdirSync(skill);
    writeFileSync(join(skill, 'SKILL.md'), 'skill body');
    writeFileSync(join(outside, 'secret'), 'secret');
    symlinkSync(join(outside, 'secret'), join(skill, 'escape'));
    const handler = gateToolCallHandler({ folders: { ...ctx, readRoots: [skill] } });
    expect(await handler(toolEvent('read', { path: join(skill, 'SKILL.md') }))).toBeUndefined();
    for (const tool of ['write', 'edit', 'grep', 'find', 'ls']) {
      expect((await handler(toolEvent(tool, { path: join(skill, 'SKILL.md') })))?.block).toBe(true);
    }
    expect((await handler(bashEvent(`cat ${skill}/SKILL.md`)))?.block).toBe(true);
    expect((await handler(toolEvent('read', { path: join(skill, 'escape') })))?.block).toBe(true);
    expect((await handler(toolEvent('read', { path: join(outside, 'secret') })))?.block).toBe(true);
    const denied = gateToolCallHandler({
      folders: { ...ctx, readRoots: [skill] },
      rules: [{ id: 'deny-read', tool: 'read', action: 'reject' }],
    });
    expect((await denied(toolEvent('read', { path: join(skill, 'SKILL.md') })))?.reason).toContain(
      'deny-read',
    );
  });

  it('pi file tools resolve paths against the step cwd and the enabled roots', () => {
    const { ctx, cwd, outside } = folders();
    writeFileSync(join(cwd, 'a.txt'), 'x');
    for (const tool of ['read', 'edit', 'write', 'grep', 'find', 'ls']) {
      expect(decideToolCall(tool, { path: `${outside}/f` }, undefined, ctx)?.ruleId).toBe(
        'folder-grant',
      );
      expect(decideToolCall(tool, { path: 'a.txt' }, undefined, ctx)).toBeUndefined();
      expect(decideToolCall(tool, { path: '../escape' }, undefined, ctx)?.ruleId).toBe(
        'folder-grant',
      );
    }
    expect(
      decideToolCall('mcp__demo__echo', { path: `${outside}/f` }, undefined, ctx),
    ).toBeUndefined();
    expect(decideToolCall('read', { path: `${outside}/f` }, undefined)).toBeUndefined();
  });

  it('the handler blocks an outside path with the refusal wording', async () => {
    const { ctx, outside } = folders();
    const handler = gateToolCallHandler({ folders: ctx });
    const read = await handler(toolEvent('read', { path: `${outside}/f` }));
    expect(read?.block).toBe(true);
    expect(read?.reason).toContain('folder-grant');
    expect((await handler(bashEvent(`cat ${outside}/f`)))?.reason).toContain('folder-grant');
    expect(await handler(toolEvent('read', { path: 'a.txt' }))).toBeUndefined();
  });
});
