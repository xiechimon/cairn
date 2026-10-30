import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const src = readFileSync(process.argv[2], 'utf8');
const body = src.slice(
  src.indexOf('const disarmedFile'),
  src.indexOf('export function finalVerdict'),
);
const STATE = mkdtempSync(join(tmpdir(), 'review-gate-'));
mkdirSync(`${STATE}/disarmed`);
const calls = [];
let ghFails = false;
const asBot = (args) => calls.push(['bot', ...args]);
const gh = (args) => {
  if (ghFails) throw new Error('gh failed');
  calls.push(['gh', ...args]);
};
const record = () => {};
const { disarm, rearm, passedFor } = new Function(
  'STATE',
  'REPO',
  'asBot',
  'gh',
  'record',
  'readFileSync',
  'writeFileSync',
  'rmSync',
  `${body}; return { disarm, rearm, passedFor };`,
)(STATE, 'o/r', asBot, gh, record, readFileSync, writeFileSync, rmSync);

let bad = 0;
const check = (name, ok) => {
  bad += !ok;
  console.log(ok ? 'ok ' : 'BAD', name);
};
const armed = { number: 1, autoMergeRequest: { mergeMethod: 'SQUASH' } };
const unarmed = { number: 2, autoMergeRequest: null };
const botArmed = {
  number: 3,
  autoMergeRequest: { mergeMethod: 'REBASE', enabledBy: { login: 'cairnwright[bot]' } },
};

disarm(armed);
check('disarm records the armed method', readFileSync(`${STATE}/disarmed/1`, 'utf8') === 'squash');
check('disarm turns auto-merge off as the bot', calls.at(-1).join(' ').includes('--disable-auto'));
disarm(unarmed);
check('disarm of an unarmed PR records nothing', !existsSync(`${STATE}/disarmed/2`));
check('disarm of an unarmed PR still turns auto-merge off', calls.length === 2);
disarm(botArmed);
check('a bot arm is not remembered for re-arming', !existsSync(`${STATE}/disarmed/3`));

ghFails = true;
rearm(armed);
check('failed re-arm keeps the record for the next round', existsSync(`${STATE}/disarmed/1`));
ghFails = false;
rearm(armed);
check(
  're-arm restores the recorded method',
  calls.at(-1).join(' ') === 'gh pr merge 1 --auto --squash',
);
check('re-arm clears the record', !existsSync(`${STATE}/disarmed/1`));
const before = calls.length;
rearm(armed);
rearm(unarmed);
check('re-arm without a gate disarm does nothing', calls.length === before);

const sha = 'a'.repeat(40);
const pass = `<!-- review-gate:${sha} -->\n**Independent review gate: PASS** for \`aaaaaaaa\`.`;
check('PASS comment counts', passedFor(pass, sha));
check(
  'carried-over PASS counts',
  passedFor(
    `<!-- review-gate:${sha} -->\n**Independent review gate: PASS** (carried over) for x`,
    sha,
  ),
);
check('PASS for another head does not count', !passedFor(pass, 'b'.repeat(40)));
check(
  'BLOCK quoting a PASS does not count',
  !passedFor(
    `<!-- review-gate:${sha} -->\n**Independent review gate: BLOCK** for x\n\n${pass}`,
    sha,
  ),
);
check(
  'no-verdict note does not count',
  !passedFor(
    `<!-- review-gate-pending:${sha} -->\n**Independent review gate: no verdict yet** for x`,
    sha,
  ),
);
process.exit(bad ? 1 : 0);
