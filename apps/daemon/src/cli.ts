import { spawnSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { BRAND, ENV_VARS, PROVIDER_COMMAND_NOTICE, sleep } from '@cairn/shared';
import { activeManagedBin } from '@cairn/shared/managed-bin';
import { parentPidFromEnv, watchParentProcess } from '@cairn/shared/parent-watch';
import { runTokenCommand } from '@cairn/shared/token-command';
import { Command } from 'commander';
import { shutdownDaemonOtel } from './backend/otel.js';
import { runPiHost } from './backend/pi-host.js';
import { claudeInstallRoot } from './backend/runtime-channels.js';
import { childEnv } from './child-env.js';
import { bundledClaudeCodePath } from './claude-code-bin.js';
import {
  type DaemonConfig,
  type DaemonConfigInput,
  loadDaemonConfig,
  WorkspacesDirError,
} from './config.js';
import { realDoctorEnv, runDoctorCommand } from './doctor.js';
import { importAgentConfig } from './import-agent-config.js';
import { createDaemonLogger } from './log.js';
import { machineNameSuffix, pendingEnrollmentUrl } from './machine-enroll.js';
import { runMachine } from './machine-loop.js';
import { ORB_RELAY_TOKEN_ENV } from './orb/protocol.js';
import { runOrbServicesEnsure } from './orb/services-runtime.js';
import { orbAgentHome, runOrbWorker } from './orb/worker.js';
import { ensurePrivateDir } from './private-fs.js';
import { claudeConfigHome } from './runtime-homes.js';
import { ensureDaemonShellEnv } from './shell-env.js';
import { forgetMachine, loadDaemonJson, loadMachineJson, statePaths } from './state.js';
import {
  isAlive,
  runSupervisor,
  type SupervisorStart,
  spawnSupervisor,
  stopSupervisor,
} from './supervisor.js';
import { DAEMON_VERSION } from './version.js';
import {
  activateWebTools,
  agentReachEnabled,
  ensureWebTools,
  readScrapling,
  runAgentReach,
  setAgentReachEnabled,
} from './web-tools.js';

interface StartOptions {
  foreground?: boolean;
  apiKey?: string;
  team?: string;
  name?: string;
  server?: string;
  workspacesDir?: string;
}

function configInput(opts: StartOptions): DaemonConfigInput {
  return {
    ...(opts.foreground !== undefined ? { foreground: opts.foreground } : {}),
    ...(opts.apiKey !== undefined ? { apiKey: opts.apiKey } : {}),
    ...(opts.team !== undefined ? { teamId: opts.team } : {}),
    ...(opts.name !== undefined ? { name: opts.name } : {}),
    ...(opts.server !== undefined ? { serverUrl: opts.server } : {}),
    ...(opts.workspacesDir !== undefined ? { workspacesDir: opts.workspacesDir } : {}),
  };
}

function passthroughArgv(opts: StartOptions): string[] {
  const argv = ['start', '--foreground'];
  if (opts.apiKey) argv.push('--api-key', opts.apiKey);
  if (opts.team) argv.push('--team', opts.team);
  if (opts.name) argv.push('--name', opts.name);
  if (opts.server) argv.push('--server', opts.server);
  if (opts.workspacesDir) argv.push('--workspaces-dir', opts.workspacesDir);
  return argv;
}

function reportStarted(started: SupervisorStart): void {
  if (started.unit !== null) {
    process.stdout.write(
      `Started in background as systemd user unit ${started.unit} (pid ${started.pid})\n`,
    );
    return;
  }
  process.stdout.write(`Started in background (pid ${started.pid})\n`);
  if (started.unitFailure !== null) {
    process.stderr.write(
      `warning: could not start the daemon as a systemd user unit (${started.unitFailure}).\n` +
        'The Runner will show Online but cannot start its task sandbox, so it will not take tasks.\n' +
        'Run it under systemd instead: https://github.com/xiechimon/cairn/blob/main/docs/getting-started.md#keep-the-daemon-running-on-linux\n',
    );
  }
}

export { ensureDaemonShellEnv } from './shell-env.js';

export async function runForeground(opts: StartOptions): Promise<void> {
  await ensureDaemonShellEnv();
  let config: DaemonConfig;
  try {
    config = loadDaemonConfig(configInput(opts));
  } catch (err) {
    if (err instanceof WorkspacesDirError) {
      process.stderr.write(`${err.message}\n`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }
  const paths = statePaths(config.home, config.workspacesDir);
  const logger = createDaemonLogger({ logFile: paths.daemonLog, stdout: true });
  process.env.CAIRN_HOME = config.home;
  activateWebTools(config.home);
  const handle = await runMachine({
    config,
    paths,
    logger,
    idleSleepPrevention: true,
    hookTimeoutMs: config.hookTimeoutMs,
  });
  const onSignal = (signal: string) => {
    void handle.stop(signal);
  };
  process.on('SIGTERM', () => onSignal('SIGTERM'));
  process.on('SIGINT', () => onSignal('SIGINT'));
  const parentPid = parentPidFromEnv(process.env);
  const stopParentWatch =
    parentPid === null
      ? () => {}
      : watchParentProcess({ pid: parentPid, onDead: () => onSignal('parent') });
  try {
    await handle.done;
  } finally {
    stopParentWatch();
    await shutdownDaemonOtel();
  }
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name(BRAND.cliCommandName)
    .description('cairn executor daemon (02 §5.1 command face)')
    .version(DAEMON_VERSION, '-v, --version');

  program
    .command('start')
    .description('Start the daemon in the background (a systemd user unit on Linux)')
    .option('-f, --foreground', 'run attached (for pm2/systemd/containers)')
    .option('--api-key <k>', 'API key for non-interactive enroll (overrides existing enroll)')
    .option('--team <id>', 'team id for non-interactive enroll')
    .option('--name <name>', 'machine name (default hostname)')
    .option('--server <url>', 'server URL')
    .option('--workspaces-dir <dir>', 'persistent workspaces root (parent must exist)')
    .action(async (opts: StartOptions) => {
      if (opts.foreground) {
        await runForeground(opts);
        return;
      }
      await ensureDaemonShellEnv();
      let config: DaemonConfig;
      try {
        config = loadDaemonConfig(configInput(opts));
      } catch (err) {
        if (err instanceof WorkspacesDirError) {
          process.stderr.write(`${err.message}\n`);
          process.exitCode = 1;
          return;
        }
        throw err;
      }
      reportStarted(
        spawnSupervisor({
          home: config.home,
          runnerArgv: passthroughArgv(opts),
        }),
      );
      await printEnrollmentUrl(config.home, config.serverUrl, config.name);
    });

  program
    .command('supervise', { hidden: true })
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .helpOption(false)
    .action(async () => {
      await ensureDaemonShellEnv();
      const argv = process.argv.slice(2);
      const idx = argv.indexOf('supervise');
      const runnerArgv = idx >= 0 ? argv.slice(idx + 1) : argv;
      const config = loadDaemonConfig({});
      await runSupervisor({ home: config.home, runnerArgv });
    });

  program
    .command('stop')
    .description('Stop the background daemon')
    .action(async () => {
      const config = loadDaemonConfig({});
      const stopped = await stopSupervisor(config.home);
      process.stdout.write(stopped ? 'Stopped\n' : 'Daemon was not running\n');
    });

  program
    .command('restart')
    .description('Restart the background daemon')
    .option('--server <url>', 'server URL (default: the one this machine enrolled with)')
    .action(async (_opts: StartOptions, cmd: Command) => {
      await ensureDaemonShellEnv();
      const config = loadDaemonConfig(configInput(cmd.opts<StartOptions>()));
      await stopSupervisor(config.home);
      reportStarted(
        spawnSupervisor({
          home: config.home,
          runnerArgv: passthroughArgv(cmd.opts<StartOptions>()),
        }),
      );
      await printEnrollmentUrl(config.home, config.serverUrl, config.name);
    });

  program
    .command('logs')
    .description('Print daemon.log (tail); -f follows')
    .option('-f, --follow', 'follow new lines')
    .action(async (opts: { follow?: boolean }) => {
      const config = loadDaemonConfig({});
      const logPath = statePaths(config.home).daemonLog;
      if (!existsSync(logPath)) {
        process.stdout.write('(no daemon.log yet)\n');
        return;
      }
      process.stdout.write(readFileSync(logPath, 'utf8'));
      if (!opts.follow) return;
      let offset = statSync(logPath).size;
      for (;;) {
        await sleep(500);
        if (!existsSync(logPath)) continue;
        const size = statSync(logPath).size;
        if (size > offset) {
          const buf = Buffer.alloc(size - offset);
          const fd = openSync(logPath, 'r');
          readSync(fd, buf, 0, buf.length, offset);
          closeSync(fd);
          process.stdout.write(buf.toString('utf8'));
          offset = size;
        }
      }
    });

  program
    .command('logout')
    .description('Forget this machine locally (server record is kept)')
    .action(async () => {
      const config = loadDaemonConfig({});
      await stopSupervisor(config.home);
      const forgot = forgetMachine(statePaths(config.home, config.workspacesDir));
      process.stdout.write(
        forgot
          ? 'Forgot this machine (server-side record kept; re-enroll reuses the same machineId)\n'
          : 'Not enrolled\n',
      );
    });

  program
    .command('status')
    .description('Show local machine/daemon state')
    .action(() => {
      const config = loadDaemonConfig({});
      const paths = statePaths(config.home, config.workspacesDir);
      const machine = loadMachineJson(paths);
      const daemon = loadDaemonJson(paths);
      process.stdout.write(
        machine
          ? `Enrolled: machine ${machine.machineId} (team ${machine.teamId}, server ${machine.serverUrl})\n`
          : 'Not enrolled\n',
      );
      process.stdout.write(
        daemon && isAlive(daemon.pid)
          ? `Running: pid ${daemon.pid} (since ${new Date(daemon.startedAt).toISOString()})\n`
          : 'Not running\n',
      );
    });

  program
    .command('token')
    .description('Print the server access token and its location; --rotate writes a new one')
    .option('--rotate', 'write a new token to the token file ($CAIRN_HOME/token)')
    .action((opts: { rotate?: boolean }) => {
      const code = runTokenCommand(
        { rotate: opts.rotate === true },
        { env: process.env, writeOut: (text) => process.stdout.write(text) },
      );
      if (code !== 0) process.exitCode = code;
    });

  program
    .command('doctor')
    .description('Check whether this machine is ready to run Cairn tasks')
    .option('--json', 'print the result as JSON')
    .action((opts: { json?: boolean }) => {
      const code = runDoctorCommand(opts, {
        env: realDoctorEnv(),
        writeOut: (text) => process.stdout.write(text),
      });
      if (code !== 0) process.exitCode = code;
    });

  program
    .command('version')
    .description('Print the daemon version')
    .action(() => {
      process.stdout.write(`${DAEMON_VERSION}\n`);
    });

  program
    .command('provider')
    .description('Provider management notice')
    .action(() => {
      process.stdout.write(`${PROVIDER_COMMAND_NOTICE}\n`);
    });

  const agentConfig = program
    .command('agent-config')
    .description('Managed runtime homes and imports');
  agentConfig
    .command('import')
    .description(
      'Copy skills and MCP servers from your own Claude/Codex config into the managed homes',
    )
    .option('--force', 'run again even though the import already ran once')
    .action((opts: { force?: boolean }) => {
      const config = loadDaemonConfig({});
      const report = importAgentConfig({ cairnHome: config.home, force: opts.force === true });
      if (report === null) {
        process.stdout.write('Import already ran once; pass --force to run it again.\n');
        return;
      }
      for (const item of report.copied) process.stdout.write(`copied  ${item}\n`);
      for (const { item, reason } of report.skipped)
        process.stdout.write(`skipped ${item} (${reason})\n`);
      for (const { item, reason } of report.failed)
        process.stdout.write(`failed  ${item} (${reason})\n`);
      if (report.failed.length > 0) process.exitCode = 1;
    });

  const claude = program.command('claude').description('Managed Claude Code');
  claude
    .command('login')
    .description(
      'Sign in to the managed Claude Code (writes into the Cairn-managed home, not your own)',
    )
    .action(() => {
      const config = loadDaemonConfig({});
      const command =
        process.env[ENV_VARS.claudeBin] ??
        activeManagedBin(claudeInstallRoot(config.home))?.command ??
        bundledClaudeCodePath();
      if (command === null) {
        process.stderr.write(
          'No managed claude binary is installed (SDK platform package missing).\n',
        );
        process.exitCode = 1;
        return;
      }
      const claudeHome = claudeConfigHome(config.home);
      ensurePrivateDir(config.home);
      ensurePrivateDir(claudeHome);
      const result = spawnSync(command, ['auth', 'login'], {
        stdio: 'inherit',
        env: childEnv({ CLAUDE_CONFIG_DIR: claudeHome }),
      });
      if (result.error !== undefined) throw result.error;
      process.exitCode = result.status ?? 1;
    });

  program
    .command('pi-host', { hidden: true })
    .description('Run one confined Pi session over the JSONL host protocol')
    .action(async () => {
      await runPiHost();
    });

  program
    .command('orb-step', { hidden: true })
    .option('--socket <path>', 'Per-step relay socket')
    .option('--stdio', 'Carry the relay over stdin and stdout (remote sandbox orbs)')
    .action(async (opts: { socket?: string; stdio?: boolean }) => {
      if (process.env.CAIRN_ORB !== '1') throw new Error('Orb worker requires CAIRN_ORB=1');
      process.env.CAIRN_HOME = join(orbAgentHome(), '.cairn');
      activateWebTools(process.env.CAIRN_HOME);
      if (opts.stdio) {
        const token = process.env[ORB_RELAY_TOKEN_ENV];
        delete process.env[ORB_RELAY_TOKEN_ENV];
        if (!token) throw new Error(`Orb stdio worker requires ${ORB_RELAY_TOKEN_ENV}`);
        await runOrbWorker({
          stdio: { input: process.stdin, output: process.stdout, token },
        });
        process.stdin.destroy();
        return;
      }
      if (!opts.socket) throw new Error('Orb worker requires --socket or --stdio');
      await runOrbWorker({ socketPath: opts.socket });
    });

  const webTools = program
    .command('web-tools')
    .description('Public-web tools and optional platform channels');
  webTools
    .command('install')
    .description('Install or repair Scrapling HTTP fetching (no browsers)')
    .action(async () => {
      const { home } = loadDaemonConfig({});
      await ensureWebTools(home, (message) => process.stdout.write(`${message}\n`));
      if (!(await readScrapling(home))) process.exitCode = 1;
    });
  webTools
    .command('agent-reach')
    .description('Opt in to Agent Reach; leaves existing tools and logins untouched')
    .argument('[args...]', 'Agent Reach command, such as doctor or add <channel>')
    .option('--enable', 'install if missing and enable channel discovery')
    .option('--disable', 'disable discovery without uninstalling')
    .action(async (args: string[], opts: { enable?: boolean; disable?: boolean }) => {
      const { home } = loadDaemonConfig({});
      if (opts.enable && opts.disable) throw new Error('Choose --enable or --disable');
      if (opts.enable || opts.disable) await setAgentReachEnabled(home, opts.enable === true);
      if (args.length > 0) {
        process.stdout.write(await runAgentReach(home, args));
        return;
      }
      process.stdout.write(`Agent Reach: ${agentReachEnabled(home) ? 'enabled' : 'disabled'}\n`);
      if (opts.enable)
        process.stdout.write(
          'Restart the Runner. Then run cairn web-tools agent-reach doctor; add only the channel you need with cairn web-tools agent-reach add <channel> and follow its setup/login instructions. No channel is logged in automatically.\n',
        );
      if (opts.disable)
        process.stdout.write(
          'Restart the Runner. Installed tools, skills and credentials were not removed.\n',
        );
    });

  const orb = program.command('orb').description('Orb host helpers');
  orb
    .command('services')
    .command('ensure')
    .description('Start missing services from .agents/services.yaml and wait until ready')
    .option('--json', 'print JSON status')
    .option('--file <path>', 'services file (default .agents/services.yaml)')
    .action(async (opts: { json?: boolean; file?: string }) => {
      const code = await runOrbServicesEnsure(opts);
      if (code !== 0) process.exitCode = code;
    });

  return program;
}

export async function main(argv: string[] = process.argv): Promise<void> {
  await buildProgram().parseAsync(argv);
}

function isMainModule(): boolean {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (isMainModule()) void main();

async function printEnrollmentUrl(home: string, serverUrl: string, name: string): Promise<void> {
  const url = await pendingEnrollmentUrl(
    statePaths(home),
    serverUrl,
    2_000,
    sleep,
    () => Date.now(),
    name,
  );
  if (url !== null)
    process.stdout.write(`Approve this machine in a browser: ${url}${machineNameSuffix(name)}\n`);
}
