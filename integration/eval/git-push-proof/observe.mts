import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gitPrim } from '../../../apps/daemon/src/git.js';

const repoRoot = resolve(import.meta.dirname, '../../..');
const sourcePaths = ['apps/daemon/src/git.ts', 'apps/daemon/src/workspace.ts'];
const fixture = mkdtempSync(join(tmpdir(), 'cairn-2047-observation-'));
const remote = join(fixture, 'origin.git');
const work = join(fixture, 'work');
const publisher = join(fixture, 'publisher');
const git = (cwd: string, args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

git(fixture, ['init', '--bare', remote]);
git(remote, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
git(fixture, ['clone', remote, work]);
git(work, ['config', 'user.name', 'Observation fixture']);
git(work, ['config', 'user.email', 'observation@example.invalid']);
git(work, ['checkout', '-b', 'main']);
writeFileSync(join(work, 'seed.txt'), 'seed\n');
git(work, ['add', 'seed.txt']);
git(work, ['commit', '-m', 'seed']);
git(work, ['push', 'origin', 'main']);
git(work, ['checkout', '-b', 'work']);
writeFileSync(join(work, 'local.txt'), 'local\n');
git(work, ['add', 'local.txt']);
git(work, ['commit', '-m', 'local work']);
git(work, ['push', 'origin', 'work']);
const local = git(work, ['rev-parse', 'HEAD']);
git(fixture, ['clone', remote, publisher]);
git(publisher, ['config', 'user.name', 'Observation fixture']);
git(publisher, ['config', 'user.email', 'observation@example.invalid']);
git(publisher, ['checkout', '-b', 'work', 'origin/work']);
writeFileSync(join(publisher, 'remote.txt'), 'remote advancement\n');
git(publisher, ['add', 'remote.txt']);
git(publisher, ['commit', '-m', 'advance remote']);
git(publisher, ['push', 'origin', 'work']);
const actualTip = git(publisher, ['rev-parse', 'HEAD']);
const fetchHead = join(work, '.git', 'FETCH_HEAD');
writeFileSync(fetchHead, 'preexisting observation sentinel\n');
const before = {
  fetchHead: readFileSync(fetchHead, 'utf8'),
  trackingRefs: git(work, ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/remotes/']),
  localConfig: git(work, ['config', '--local', '--list']),
};
const notices: { local: string; remote: string }[] = [];
await gitPrim.push(work, 'work', null, (a, b) => notices.push({ local: a, remote: b }));
const after = {
  fetchHead: readFileSync(fetchHead, 'utf8'),
  trackingRefs: git(work, ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/remotes/']),
  localConfig: git(work, ['config', '--local', '--list']),
};
console.log(
  JSON.stringify(
    {
      checkoutHead: git(repoRoot, ['rev-parse', 'HEAD']),
      sourceHasUncommittedChanges:
        git(repoRoot, ['status', '--porcelain', '--', ...sourcePaths]) !== '',
      runtimeSourceFiles: Object.fromEntries(
        sourcePaths.map((path) => [
          path,
          createHash('sha256')
            .update(readFileSync(join(repoRoot, path)))
            .digest('hex'),
        ]),
      ),
      observationScriptSha256: createHash('sha256')
        .update(readFileSync(import.meta.filename))
        .digest('hex'),
      providerMode: 'not exercised; real local Git repositories with synthetic identities',
      local,
      actualTip,
      notices,
      fetchHeadBefore: before.fetchHead,
      fetchHeadAfter: after.fetchHead,
      trackingRefsBefore: before.trackingRefs,
      trackingRefsAfter: after.trackingRefs,
      persistentConfigUnchanged: before.localConfig === after.localConfig,
      proofRefsAfter: git(work, ['for-each-ref', '--format=%(refname)', 'refs/cairn/push-check/']),
      remoteTipAfter: git(remote, ['rev-parse', 'refs/heads/work']),
    },
    null,
    2,
  ),
);
