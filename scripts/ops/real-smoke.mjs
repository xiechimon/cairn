import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { smokeCommand } from '../../apps/daemon/src/backend/smoke-command.mjs';

export function runSmoke({
  env = process.env,
  run = smokeCommand,
  orb = existsSync(new URL('../../apps/daemon/src/orb/', import.meta.url)),
  now = () => new Date(),
} = {}) {
  if (env.CI && !['false', '0'].includes(env.CI)) throw new Error('Real smoke must not run in CI');
  const stateDir = env.CAIRN_HOME ?? join(homedir(), '.cairn');
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const model = env.CAIRN_SMOKE_MODEL ?? 'sonnet';
  const record = { ok: false, at: now().toISOString(), model };
  const file = join(stateDir, 'smoke.json');
  const save = () => {
    const temporary = `${file}.${randomUUID()}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(record)}\n`, { mode: 0o600 });
    renameSync(temporary, file);
  };
  save();
  const sandbox = mkdtempSync(join(tmpdir(), 'cairn-real-smoke-'));
  const name = `cairn-orb-smoke-${randomUUID().slice(0, 8)}`;
  let created = false;
  let failure;
  try {
    chmodSync(sandbox, 0o755);
    run(['git', 'init', '--quiet', sandbox], { env });
    writeFileSync(join(sandbox, 'SMOKE.txt'), 'CAIRN_SMOKE_OK\n');
    const argv = [
      'claude',
      '--print',
      '--output-format',
      'json',
      '--model',
      model,
      '--max-turns',
      '2',
      '--setting-sources',
      '',
      '--settings',
      '{"disableAllHooks":true}',
      '--disable-slash-commands',
      '--no-session-persistence',
      '--tools',
      'Read',
      '--allowedTools',
      'Read',
      '--strict-mcp-config',
      '--mcp-config',
      '{"mcpServers":{}}',
      'Read SMOKE.txt and reply with only its contents.',
    ];
    let output;
    if (orb) {
      run(['machinectl', 'clone', 'cairn-orb-base', name], { env });
      created = true;
      run(['machinectl', 'start', name], { env });
      run(['machinectl', 'bind', name, sandbox, '/smoke', '--read-only', '--mkdir'], { env });
      output = run(
        [
          'systemd-run',
          '-M',
          name,
          '--uid=agent',
          '--wait',
          '--pipe',
          '--collect',
          '--quiet',
          ...[
            'CLAUDE_CODE_OAUTH_TOKEN',
            'ANTHROPIC_API_KEY',
            'ANTHROPIC_AUTH_TOKEN',
            'ANTHROPIC_BASE_URL',
          ]
            .filter((key) => env[key])
            .map((key) => `--setenv=${key}`),
          '--working-directory=/smoke',
          '--setenv=CAIRN_ORB=1',
          ...argv,
        ],
        { env },
      );
    } else {
      output = run(argv, { cwd: sandbox, env });
    }
    const response = JSON.parse(output);
    if (
      response.type !== 'result' ||
      response.subtype !== 'success' ||
      response.is_error !== false ||
      response.result?.trim() !== 'CAIRN_SMOKE_OK'
    )
      throw new Error('Real Claude Code smoke did not complete');
    const models = Object.keys(response.modelUsage ?? {});
    if (models.length !== 1) throw new Error('Real Claude Code smoke did not identify its model');
    record.model = models[0];
    record.ok = true;
  } catch (error) {
    failure = error;
  }
  try {
    if (created) {
      try {
        run(['systemctl', 'stop', `systemd-nspawn@${name}.service`], { env });
      } finally {
        run(['machinectl', 'remove', name], { env });
      }
    }
  } catch (error) {
    record.ok = false;
    failure ??= error;
  }
  try {
    rmSync(sandbox, { recursive: true, force: true });
  } catch (error) {
    record.ok = false;
    failure ??= error;
  }
  record.at = now().toISOString();
  save();
  if (failure !== undefined) throw failure;
  return record;
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  try {
    const record = runSmoke();
    console.log(JSON.stringify(record));
  } catch {
    console.error('Real smoke incomplete');
    process.exitCode = 1;
  }
}
