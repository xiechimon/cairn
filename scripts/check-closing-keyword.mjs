import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

try {
  const { pull_request: pr } = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  if (!pr) throw new Error('PR event is required');
  const issues = new Set(
    [...(pr.body ?? '').matchAll(/\bcloses[ \t]+#([1-9]\d*)\b/gi)].map((match) => match[1]),
  );
  const messages = execFileSync(
    'git',
    ['log', '--format=%B%x00', `${pr.base.sha}..${pr.head.sha}`, '--'],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  const closed = new Set();
  for (const message of messages.split('\0')) {
    for (const line of message.split(/\r?\n/)) {
      if (!/^[ \t]*closes[ \t]+#[1-9]\d*(?:[ \t]*,[ \t]*closes[ \t]+#[1-9]\d*)*[ \t]*$/i.test(line))
        continue;
      for (const match of line.matchAll(/closes[ \t]+#([1-9]\d*)/gi)) closed.add(match[1]);
    }
  }
  const missing = [...issues].filter((issue) => !closed.has(issue));
  if (missing.length) {
    console.error(
      `closing-keyword: missing branch commit closing line for ${missing.map((issue) => `#${issue}`).join(', ')}`,
    );
    process.exitCode = 1;
  } else {
    console.log(`closing-keyword: OK (${issues.size} declared issues)`);
  }
} catch (error) {
  console.error(`closing-keyword: ${error.message}`);
  process.exitCode = 2;
}
