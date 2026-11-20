import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const settingsPath = fileURLToPath(new URL('./batch-sandbox.settings.json', import.meta.url));
const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));

function homeRelative(rule) {
  assert.ok(rule.startsWith('~/'), `rule must be home-relative: ${rule}`);
  return rule.slice(2).replace(/\/+$/, '');
}

function coveredByDenyRead(secret) {
  return (settings.sandbox?.filesystem?.denyRead ?? []).some(
    (rule) => secret === homeRelative(rule) || secret.startsWith(`${homeRelative(rule)}/`),
  );
}

const MAC_SECRETS = [
  '.cairn/cairnwright.private-key.pem',
  '.cairn/server/secretbox.key',
  '.cairn/server.hdd-old/secretbox.key',
  '.config/cairn/server.env',
  '.cairn/token',
  '.cairn/server/server.db',
  '.cairn/server.hdd-old/server.db',
  '.local/share/devin/credentials.toml',
  '.local/share/opencode/auth.json',
  'Library/Application Support/@cairn/desktop/runner/machine.json',
  'Library/Application Support/@cairn/desktop/runner/daemon.log',
  'Library/Application Support/Claude/claude_desktop_config.json',
  '.cargo/credentials.toml',
  '.pypirc',
  '.zsh_history',
  '.local/share/fish/fish_history',
  '.cache/huggingface/token',
  'Library/Application Support/@cairn/desktop/Network/Cookies',
  'Library/Application Support/@cairn/desktop/Local Storage/leveldb/CURRENT',
  'Library/Application Support/Code/User/globalStorage/state.vscdb',
];

const MAC_REAL_FILES = [
  '.config/cairn/slack-app.env',
  '.config/cairn/composio.env',
  '.config/cairn/telegram.env',
  'Library/Application Support/@cairn/desktop/otel.env',
  'Library/pnpm/rc',
  '.npmrc',
  '.zshrc',
  '.zshenv',
  '.zprofile',
  '.bashrc',
  '.bash_profile',
  '.profile',
  '.claude.json.backup',
];

const WORKSPACE_CARVE_OUTS = [
  '.cairn/workspaces',
  '.cairn/plans',
  'Library/Application Support/@cairn/desktop/runner/workspaces',
];

test('batch settings force the sandbox and forbid unsandboxed retries', () => {
  assert.equal(settings.sandbox?.enabled, true);
  assert.equal(settings.sandbox?.failIfUnavailable, true);
  assert.equal(settings.sandbox?.allowUnsandboxedCommands, false);
  assert.equal(settings.sandbox?.autoAllowBashIfSandboxed, true);
});

test('denyRead covers every secret in the canary Mac inventory', () => {
  for (const secret of MAC_SECRETS) {
    assert.ok(coveredByDenyRead(secret), `denyRead does not cover ~/${secret}`);
  }
});

test('denyRead covers the real secret files present on the owner Mac', () => {
  for (const file of MAC_REAL_FILES) {
    assert.ok(coveredByDenyRead(file), `denyRead does not cover ~/${file}`);
  }
});

test('denyRead keeps batch workspaces and the plan handoff dir reachable', () => {
  const allowRead = (settings.sandbox?.filesystem?.allowRead ?? []).map(homeRelative);
  for (const path of WORKSPACE_CARVE_OUTS) assert.ok(allowRead.includes(path), path);
});

test('allowWrite keeps the caches heavy-slots and pnpm need writable', () => {
  const allowWrite = (settings.sandbox?.filesystem?.allowWrite ?? []).map(homeRelative);
  for (const path of ['.cache', 'Library/pnpm', '.cairn/plans'])
    assert.ok(allowWrite.includes(path), path);
});

test('denyWrite blocks writes an unsandboxed process would later trust', () => {
  const denyWrite = settings.sandbox?.filesystem?.denyWrite ?? [];
  for (const rule of [
    '~/.cache/lane-tmp',
    '~/Library/pnpm/rc',
    '.claude',
    'CLAUDE.md',
    'AGENTS.md',
  ]) {
    assert.ok(denyWrite.includes(rule), rule);
  }
});

test('permissions deny covers the secret paths for the file tools', () => {
  const deny = settings.permissions?.deny ?? [];
  for (const rule of [
    'Read(~/.cairn/cairnwright.private-key.pem)',
    'Read(~/.cairn/server/**)',
    'Read(~/.config/**)',
    'Read(~/.cairn/token)',
    'Read(~/Library/Application Support/@cairn/desktop/otel.env)',
    'Read(~/Library/Application Support/@cairn/desktop/runner/machine.json)',
    'Read(~/Library/Application Support/@cairn/desktop/runner/claude/**)',
    'Read(~/Library/pnpm/rc)',
    'Read(~/.local/share/devin/**)',
    'Read(~/.claude/**)',
    'Read(~/.npmrc)',
    'Read(~/Library/Application Support/Claude/**)',
  ]) {
    assert.ok(deny.includes(rule), rule);
  }
});

test('permissions deny stops the file tools from editing trusted files', () => {
  const deny = settings.permissions?.deny ?? [];
  for (const rule of [
    'Edit(**/.claude/**)',
    'Edit(**/CLAUDE.md)',
    'Edit(**/CLAUDE.local.md)',
    'Edit(**/AGENTS.md)',
    'Edit(**/AGENTS.local.md)',
    'Edit(**/.git)',
    'Edit(**/.git/**)',
    'Edit(~/.cache/lane-tmp/**)',
  ]) {
    assert.ok(deny.includes(rule), rule);
  }
});

test('the batch file carries no hooks or network exemptions', () => {
  assert.equal(settings.hooks, undefined);
  assert.equal(settings.sandbox?.network, undefined);
  assert.equal(settings.sandbox?.excludedCommands, undefined);
});
