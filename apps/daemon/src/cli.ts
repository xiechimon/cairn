import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  statSync,
} from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { BRAND, PROVIDER_COMMAND_NOTICE } from '@cairn/shared';
import { Command } from 'commander';
import {
  type DaemonConfig,
  type DaemonConfigInput,
  loadDaemonConfig,
  WorkspacesDirError,
} from './config.js';
import { createDaemonLogger } from './log.js';
import { runMachine } from './machine-loop.js';
import { forgetMachine, loadDaemonJson, loadMachineJson, statePaths } from './state.js';
import { isAlive, runSupervisor, spawnSupervisor, stopSupervisor } from './supervisor.js';
import { DAEMON_VERSION } from './version.js';

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

export async function runForeground(opts: StartOptions): Promise<void> {
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
  await handle.done;
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name(BRAND.cliCommandName)
    .description('cairn executor daemon (02 §5.1 command face)')
    .version(DAEMON_VERSION, '-v, --version');

  program
    .command('start')
    .description('Start the daemon (detached + supervisor by default)')
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
      const { pid } = spawnSupervisor({
        home: config.home,
        runnerArgv: passthroughArgv(opts),
      });
      process.stdout.write(`Started in background (pid ${pid})\n`);
    });

  program
    .command('supervise', { hidden: true })
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .helpOption(false)
    .action(async () => {
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
    .action(async (_opts: StartOptions, cmd: Command) => {
      const config = loadDaemonConfig({});
      await stopSupervisor(config.home);
      const { pid } = spawnSupervisor({
        home: config.home,
        runnerArgv: passthroughArgv(cmd.opts<StartOptions>()),
      });
      process.stdout.write(`Started in background (pid ${pid})\n`);
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
        await new Promise((r) => setTimeout(r, 500));
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
