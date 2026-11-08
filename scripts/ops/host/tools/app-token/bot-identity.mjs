import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';

const here = dirname(realpathSync(import.meta.filename));
const policy = JSON.parse(readFileSync(join(here, 'commit-identity.json'), 'utf8'));
const noreply = (account) => `${account.id}+${account.login}@users.noreply.github.com`;

process.stdout.write(
  `${policy.bot.login}\n${noreply(policy.bot)}\nCo-authored-by: ${policy.owner.login} <${noreply(policy.owner)}>\n`,
);
