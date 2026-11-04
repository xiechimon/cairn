import type { OrbCommandRunner, OrbExecOptions, OrbExecResult } from '../src/orb/provider.js';

export interface FakeContainer {
  name: string;
  image: string;
  state: 'created' | 'running' | 'exited' | 'paused';
  labels: Record<string, string>;
  create: string[];
}

type Failure = { match: (argv: readonly string[]) => boolean; result: OrbExecResult | Error };

const VALUE_FLAGS = new Set([
  '--name',
  '--label',
  '--network',
  '--cpus',
  '--memory',
  '--memory-swap',
  '--pids-limit',
  '--ulimit',
  '--volume',
  '-v',
  '--env',
  '-e',
]);

const ok = (stdout = ''): OrbExecResult => ({ code: 0, stdout, stderr: '' });
const fail = (code: number, stderr: string): OrbExecResult => ({ code, stdout: '', stderr });

export class FakePodman {
  readonly containers = new Map<string, FakeContainer>();
  readonly images = new Set<string>();
  readonly calls: string[][] = [];
  readonly execOptions: (OrbExecOptions | undefined)[] = [];
  private readonly failures: Failure[] = [];
  info: unknown = {
    version: { Version: '6.1.4' },
    host: { security: { rootless: true } },
  };
  psOutput: string | undefined;

  failWhen(match: (argv: readonly string[]) => boolean, result: OrbExecResult | Error): void {
    this.failures.push({ match, result });
  }

  callsOf(subcommand: string): string[][] {
    return this.calls.filter((argv) => argv[1] === subcommand);
  }

  readonly runner: OrbCommandRunner = async (argv, options) => {
    options?.signal?.throwIfAborted();
    this.calls.push([...argv]);
    this.execOptions.push(options);
    const injected = this.failures.find((failure) => failure.match(argv));
    if (injected) {
      if (injected.result instanceof Error) throw injected.result;
      return injected.result;
    }
    return this.handle(argv);
  };

  private handle(argv: readonly string[]): OrbExecResult {
    const [, command, ...rest] = argv;
    switch (command) {
      case 'container': {
        const name = rest.at(-1) ?? '';
        const container = this.containers.get(name);
        if (rest[0] === 'exists') return container ? ok() : fail(1, '');
        if (rest[0] === 'inspect') {
          if (!container) return { code: 125, stdout: '[]', stderr: `no such container "${name}"` };
          return ok(
            JSON.stringify([
              {
                Name: name,
                ImageName: container.image,
                State: { Status: container.state },
                Config: { Labels: container.labels },
              },
            ]),
          );
        }
        break;
      }
      case 'create':
        return this.create(rest);
      case 'start':
      case 'unpause': {
        const container = this.containers.get(rest.at(-1) ?? '');
        if (!container) return fail(125, 'no container with name or ID found: no such container');
        container.state = 'running';
        return ok(container.name);
      }
      case 'stop': {
        const container = this.containers.get(rest.at(-1) ?? '');
        if (!container) return fail(125, 'no container with name or ID found: no such container');
        container.state = 'exited';
        return ok(container.name);
      }
      case 'rm': {
        this.containers.delete(rest.at(-1) ?? '');
        return ok();
      }
      case 'commit': {
        const [name, snapshot] = rest.filter((arg) => !arg.startsWith('-')).slice(-2);
        if (!this.containers.has(name ?? '')) return fail(125, 'no such container');
        this.images.add(snapshot ?? '');
        return ok('sha256:abc');
      }
      case 'ps':
        return ok(this.psOutput ?? JSON.stringify(this.psRows()));
      case 'image':
        return this.images.has(rest.at(-1) ?? '') ? ok() : fail(1, '');
      case 'rmi':
        this.images.delete(rest.at(-1) ?? '');
        return ok();
      case 'build':
        this.images.add(rest[rest.indexOf('--tag') + 1] ?? '');
        return ok();
      case 'info':
        return ok(JSON.stringify(this.info));
      case 'exec':
        return ok('1000\n');
    }
    throw new Error(`FakePodman: unexpected command ${argv.join(' ')}`);
  }

  private psRows() {
    return [...this.containers.values()]
      .filter((container) => container.labels['cairn.orb'] === '1')
      .map((container) => ({
        Names: [container.name],
        Image: container.image,
        State: container.state,
        Labels: container.labels,
      }));
  }

  private create(args: readonly string[]): OrbExecResult {
    const labels: Record<string, string> = {};
    let name = '';
    let image = '';
    for (let index = 0; index < args.length; index++) {
      const arg = args[index] ?? '';
      if (arg === '--name') name = args[++index] ?? '';
      else if (arg === '--label') {
        const [key = '', ...value] = (args[++index] ?? '').split('=');
        labels[key] = value.join('=');
      } else if (VALUE_FLAGS.has(arg)) index++;
      else if (!arg.startsWith('-')) {
        image = arg;
        break;
      }
    }
    if (this.containers.has(name))
      return fail(125, `the container name "${name}" is already in use by abc`);
    if (!this.images.has(image)) return fail(125, `${image}: image not known`);
    this.containers.set(name, { name, image, state: 'created', labels, create: [...args] });
    return ok('abc123');
  }
}
