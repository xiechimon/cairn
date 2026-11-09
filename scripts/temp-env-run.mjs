import { createTempEnvironment } from '../packages/shared/src/node/temp-environment.ts';
import { spawnOwned } from './owned-process.mjs';

const [separator, command, ...args] = process.argv.slice(2);
if (separator !== '--' || !command) {
  console.error('Usage: node scripts/temp-env-run.mjs -- <command> [args...]');
  process.exit(2);
}
const temporary = createTempEnvironment();
try {
  const owned = spawnOwned(command, args, {
    env: { ...process.env, ...temporary.env },
    stdio: 'inherit',
    name: 'disk-temp-run',
    graceMs: 1_000,
  });
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => {
      process.exitCode = 1;
      owned.stop();
    });
  }
  const { code, error } = await owned.exited;
  process.exitCode = error ? 1 : (code ?? 1);
} finally {
  temporary.cleanup();
}
