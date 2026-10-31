import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

export function daemonNodeMajor({
  major,
  run = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', timeout: 10_000 }),
} = {}) {
  const fail = () => {
    throw new Error(
      'Cannot determine host daemon Node major from cairn-daemon.service ExecStart; set CAIRN_ORB_NODE_MAJOR to its Node major (for example 26)',
    );
  };
  if (major === undefined || major === '') {
    const service = run('systemctl', [
      '--user',
      'show',
      'cairn-daemon.service',
      '-p',
      'ExecStart',
      '--value',
    ]);
    if (service.status !== 0) fail();
    const binary = /(?:^|[\s{])path=(\/[^\s;{}]+)\s*;/.exec(service.stdout ?? '')?.[1];
    if (!binary) fail();
    const node = run(binary, ['--version']);
    if (node.status !== 0) fail();
    major = /^v(\d+)\.\d+\.\d+\s*$/.exec(node.stdout ?? '')?.[1];
  }
  if (
    typeof major !== 'string' ||
    !/^[1-9]\d*$/.test(major) ||
    !Number.isSafeInteger(Number(major)) ||
    Number(major) < 22
  )
    fail();
  return Number(major);
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  console.log(daemonNodeMajor({ major: process.argv[2] }));
}
