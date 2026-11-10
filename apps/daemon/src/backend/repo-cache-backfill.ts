import { type Dirent, existsSync, lstatSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { READONLY_EXPORT_MARKER } from '@cairn/shared';
import { repositoryCacheRefPrefix } from '@cairn/shared/repo-cache';
import { gitPrim, runGitOk } from '../git.js';

async function hasVerifiedRefs(cache: string, prefix: string): Promise<boolean> {
  return (
    (await runGitOk(['for-each-ref', '--count=1', '--format=%(refname)', `${prefix}/`], {
      cwd: cache,
      timeoutMs: 15_000,
    })) !== ''
  );
}

export async function backfillRepositoryCaches(
  root: string,
  log: (message: string) => void,
): Promise<void> {
  if (!existsSync(root)) return;
  let base: string;
  let entries: Dirent[];
  try {
    base = realpathSync(root);
    entries = readdirSync(base, { withFileTypes: true });
  } catch {
    log('Repository cache backfill could not scan the workspace root; check directory permissions');
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[A-Za-z0-9_-]+$/.test(entry.name)) continue;
    const project = join(base, entry.name);
    if (existsSync(join(project, '.git')) || existsSync(join(project, READONLY_EXPORT_MARKER)))
      continue;
    const cache = join(project, 'repo');
    try {
      if (!existsSync(cache) || realpathSync(cache) !== cache) continue;
      const gitDir = join(cache, '.git');
      const metadata = existsSync(gitDir) ? gitDir : cache;
      if (
        realpathSync(metadata) !== metadata ||
        !lstatSync(metadata).isDirectory() ||
        !existsSync(join(metadata, 'HEAD')) ||
        !existsSync(join(metadata, 'objects'))
      )
        continue;
      const common = await gitPrim.commonGitDir(cache);
      if (common === null || realpathSync(common) !== metadata) continue;
      const origin = await gitPrim.originConfigUrl(cache);
      if (origin === null) continue;
      const prefix = repositoryCacheRefPrefix(origin);
      if (await hasVerifiedRefs(cache, prefix)) continue;
      await gitPrim.fetch(cache, null, { origin, timeoutMs: 30_000 });
      if ((await gitPrim.originConfigUrl(cache)) !== origin) {
        log(`Repository cache ${entry.name} changed origin during backfill; verification deferred`);
        continue;
      }
      if (!(await hasVerifiedRefs(cache, prefix))) {
        log(`Repository cache ${entry.name} has no fetched refs; verification remains pending`);
        continue;
      }
      log(`Repository cache ${entry.name} provenance backfill completed`);
    } catch {
      log(
        `Repository cache ${entry.name} verification failed; check repository access and restart the daemon or prepare the project again`,
      );
    }
  }
}
