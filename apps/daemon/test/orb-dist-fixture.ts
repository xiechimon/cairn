import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type OrbCommandRunner, runOrbCommand } from '../src/orb/provider.js';

export function createOrbCheckout(root: string) {
  const checkout = join(root, 'checkout');
  const daemon = join(checkout, 'apps/daemon');
  const distSource = join(daemon, 'dist');
  mkdirSync(distSource, { recursive: true });
  writeFileSync(
    join(daemon, 'package.json'),
    JSON.stringify({ name: '@xiechimon/cairn-cli', version: '0.2.2' }),
  );
  writeFileSync(join(checkout, '.gitignore'), 'apps/daemon/dist/\n');
  writeFileSync(join(checkout, 'pnpm-lock.yaml'), 'fixture lockfile');
  writeFileSync(join(checkout, 'source.txt'), 'first');
  writeFileSync(join(distSource, 'cli.mjs'), 'first');
  execFileSync('git', ['init', '-b', 'main', checkout]);
  execFileSync('git', [
    '-C',
    checkout,
    'add',
    '.gitignore',
    'apps/daemon/package.json',
    'pnpm-lock.yaml',
    'source.txt',
  ]);
  execFileSync('git', [
    '-C',
    checkout,
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.test',
    'commit',
    '-m',
    'Initial fixture',
  ]);
  const sha = execFileSync('git', ['-C', checkout, 'rev-parse', '--short', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  const deployments: string[] = [];
  const runner: OrbCommandRunner = async (argv, options) => {
    if (argv[0] === 'git') {
      if (argv[1] !== '-C' || argv[2] !== checkout) throw new Error('Wrong host checkout');
      return runOrbCommand(argv, options);
    }
    if (argv[0] !== 'pnpm') throw new Error('Registry install or unexpected dist command');
    const target = argv.at(-1);
    if (!target) throw new Error('Missing deploy destination');
    if (
      JSON.stringify(argv.slice(0, -1)) !==
      JSON.stringify([
        'pnpm',
        '--dir',
        checkout,
        'deploy',
        '--filter',
        '@xiechimon/cairn-cli',
        '--prod',
        '--prefer-offline',
      ])
    )
      throw new Error('Deploy must use the host checkout and its offline lockfile');
    if (!options?.signal || options.env?.PNPM_CONFIG_IGNORE_SCRIPTS !== 'true')
      throw new Error('Deploy must be bounded and disable install scripts');
    deployments.push(target);
    mkdirSync(join(target, 'node_modules/host-build'), { recursive: true });
    writeFileSync(
      join(target, 'node_modules/host-build/package.json'),
      JSON.stringify({ name: 'host-build', type: 'module', main: 'index.js' }),
    );
    writeFileSync(
      join(target, 'node_modules/host-build/index.js'),
      `export default ${JSON.stringify(sha)};`,
    );
    writeFileSync(join(target, 'package.json'), readFileSync(join(daemon, 'package.json')));
    return { code: 0, stdout: '', stderr: '' };
  };
  return { checkout, distSource, sha, deployments, runner };
}
