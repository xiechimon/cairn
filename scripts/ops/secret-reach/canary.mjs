import { spawnSync } from 'node:child_process';
import {
  closeSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

export const channels = [
  'direct',
  'symlink',
  'python',
  'node',
  'sh',
  'subprocess-file',
  'git-config',
  'git-credential',
];

export function parseOptions(args, env = process.env, macHome = homedir()) {
  let profile = env.SECRET_REACH_PROFILE ?? 'omarchy';
  let pid = env.SECRET_REACH_SERVER_PID;
  let paths = env.SECRET_REACH_PATHS ? JSON.parse(env.SECRET_REACH_PATHS) : null;
  const explicit = [];
  for (let i = 0; i < args.length; i += 2) {
    const value = args[i + 1];
    if (!value) throw new Error('Missing option value');
    if (args[i] === '--profile') profile = value;
    else if (args[i] === '--pid') pid = value;
    else if (args[i] === '--path') explicit.push(value);
    else throw new Error('Unknown option');
  }
  if (!['omarchy', 'mac'].includes(profile) || (pid !== undefined && !/^[1-9]\d*$/.test(pid)))
    throw new Error('Invalid profile or PID');
  const home = profile === 'omarchy' ? '/home/ian' : macHome;
  const server = profile === 'omarchy' ? '/mnt/fast/cairn/server' : join(home, '.cairn/server');
  if (explicit.length) paths = explicit;
  paths ??= [
    join(home, '.cairn/cairnwright.private-key.pem'),
    join(server, 'secretbox.key'),
    join(home, '.cairn/server.hdd-old/secretbox.key'),
    join(home, '.config/cairn/server.env'),
    join(home, '.cairn/token'),
    join(server, 'server.db'),
    join(home, '.cairn/server.hdd-old/server.db'),
  ];
  if (
    !Array.isArray(paths) ||
    !paths.length ||
    paths.some((path) => typeof path !== 'string' || !isAbsolute(path) || path.includes('\0'))
  )
    throw new Error('Invalid paths');
  if (profile === 'omarchy' && !pid) throw new Error('Server PID required');
  return {
    paths: [...new Set(paths)],
    procPaths: pid ? [`/proc/${pid}/environ`, `/proc/${pid}/mem`] : [],
  };
}

function readCount(path) {
  let fd;
  try {
    fd = openSync(path, 'r');
    let offset = 0;
    if (/^\/proc\/\d+\/mem$/.test(path)) {
      const maps = readFileSync(path.replace(/mem$/, 'maps'), 'utf8');
      const mapping = maps.split('\n').find((line) => /^\w+-\w+ r/.test(line));
      if (!mapping) throw new Error('Missing readable mapping');
      offset = Number.parseInt(mapping.split('-')[0], 16);
    }
    return readSync(fd, Buffer.alloc(4096), 0, 4096, offset);
  } catch (error) {
    if (!['ENOENT', 'EACCES', 'EPERM', 'ENOTDIR', 'EISDIR'].includes(error.code))
      throw new Error('Probe unavailable');
    return 0;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

const nodeRead =
  "const fs=require('node:fs');let n=0;try{const f=fs.openSync(process.argv[1],'r');try{n=fs.readSync(f,Buffer.alloc(4096),0,4096,0)}finally{fs.closeSync(f)}}catch(e){if(!['ENOENT','EACCES','EPERM','ENOTDIR','EISDIR'].includes(e.code))process.exit(2)};";

function subprocess(channel, path, scratch, env) {
  let command = process.execPath;
  let args;
  if (channel === 'python') {
    command = 'python3';
    args = [
      '-c',
      'import errno,sys\ntry:\n with open(sys.argv[1], "rb") as f: n=len(f.read(4096))\nexcept OSError as e:\n if e.errno not in (errno.ENOENT,errno.EACCES,errno.EPERM,errno.ENOTDIR,errno.EISDIR): sys.exit(2)\n n=0\nprint(n)',
      path,
    ];
  } else if (channel === 'sh') {
    args = [
      '-e',
      "const {spawnSync}=require('node:child_process');const r=spawnSync('sh',['-c','{ :; } 2>/dev/null <\"$1\" || exit 13; dd bs=4096 count=1 <\"$1\" 2>/dev/null','secret-reach',process.argv[1]],{stdio:['ignore','pipe','ignore'],maxBuffer:4096,timeout:5000});if(r.error||(r.status!==0&&r.status!==13))process.exit(2);if(r.status===13){try{require('node:fs').closeSync(require('node:fs').openSync(process.argv[1],'r'));process.exit(2)}catch(e){if(!['ENOENT','EACCES','EPERM','ENOTDIR','EISDIR'].includes(e.code))process.exit(2)}}process.stdout.write(String(r.status===13?0:r.stdout.length))",
      path,
    ];
  } else if (channel === 'node') {
    args = ['-e', `${nodeRead}process.stdout.write(String(n))`, path];
  } else if (channel === 'subprocess-file') {
    args = [
      '-e',
      `${nodeRead}fs.writeFileSync(process.argv[2],String(n),{mode:0o600,flag:'wx'})`,
      path,
      join(scratch, 'count'),
    ];
  } else {
    const gitArgs =
      channel === 'git-config'
        ? ['config', '--file', path, '--null', '--list']
        : [
            '-c',
            `include.path=${path}`,
            '-c',
            'credential.interactive=false',
            'credential',
            'fill',
          ];
    args = [
      '-e',
      "const {spawnSync}=require('node:child_process');const r=spawnSync('git',JSON.parse(process.argv[1]),{input:'protocol=https\\nhost=secret-reach.invalid\\n\\n',stdio:['pipe','pipe','ignore'],maxBuffer:65536,timeout:5000});if(r.error?.code==='ETIMEDOUT')process.exit(2);process.stdout.write(String(r.stdout?.length??0))",
      JSON.stringify(gitArgs),
    ];
  }
  const result = spawnSync(command, args, {
    env,
    cwd: scratch,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 10000,
    maxBuffer: 64,
  });
  if (result.error || result.status !== 0) throw new Error('Probe unavailable');
  const count =
    channel === 'subprocess-file'
      ? readFileSync(join(scratch, 'count'), 'utf8')
      : result.stdout.trim();
  if (!/^\d+$/.test(count)) throw new Error('Invalid count');
  return Number(count);
}

export async function runCanary({
  paths,
  procPaths,
  scratchParent = tmpdir(),
  emit = (row) => process.stdout.write(`${JSON.stringify(row)}\n`),
  env = process.env,
}) {
  let leaked = false;
  let unavailable = false;
  const scratch = mkdtempSync(join(scratchParent, 'secret-reach-probes-'));
  const probeEnv = {
    ...env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_TRACE: '0',
    GIT_TRACE2: '0',
    GIT_TRACE_CURL: '0',
  };
  try {
    for (const tool of ['python3', 'git', 'sh', 'dd', 'wc']) {
      const check = spawnSync('sh', ['-c', 'command -v "$1"', 'secret-reach', tool], {
        env: probeEnv,
        stdio: 'ignore',
      });
      if (check.status !== 0) unavailable = true;
    }
    for (const path of paths) {
      for (const channel of channels) {
        let bytes = 0;
        let failed = false;
        try {
          if (channel === 'direct') bytes = readCount(path);
          else if (channel === 'symlink') {
            const link = join(scratch, 'link');
            symlinkSync(path, link);
            try {
              bytes = readCount(link);
            } finally {
              rmSync(link);
            }
          } else bytes = subprocess(channel, path, scratch, probeEnv);
        } catch {
          unavailable = true;
          failed = true;
        }
        leaked ||= bytes > 0;
        emit({ channel, path, readable: failed ? 'error' : bytes > 0 ? 'yes' : 'no', bytes });
        rmSync(join(scratch, 'count'), { force: true });
      }
    }
    for (const path of procPaths) {
      let bytes = 0;
      let failed = false;
      try {
        if (/^\/proc\/\d+\/(?:environ|mem)$/.test(path) && !lstatSync(dirname(path)).isDirectory())
          throw new Error('Invalid process directory');
        bytes = readCount(path);
      } catch {
        unavailable = true;
        failed = true;
      }
      leaked ||= bytes > 0;
      emit({
        channel: path.endsWith('/mem') ? 'proc-mem' : 'proc-environ',
        path,
        readable: failed ? 'error' : bytes > 0 ? 'yes' : 'no',
        bytes,
      });
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return unavailable ? 2 : leaked ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  try {
    process.exitCode = await runCanary(parseOptions(process.argv.slice(2)));
  } catch {
    process.stdout.write(
      `${JSON.stringify({ channel: 'configuration', path: '', readable: 'no', bytes: 0 })}\n`,
    );
    process.exitCode = 2;
  }
}
