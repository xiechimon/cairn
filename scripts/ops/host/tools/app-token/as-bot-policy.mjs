import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';

const PROTECTED_BRANCHES = new Set(['main', 'master']);
const REVIEWER = 'cairnwright[bot]';

const GH_ALLOWED = {
  pr: new Set(['view', 'list', 'comment', 'create', 'close', 'update-branch', 'edit', 'merge']),
  issue: new Set(['view', 'list', 'comment', 'create', 'edit', 'pin']),
  api: new Set(),
};

const GH_PR_EDIT_FLAGS = new Set(['--add-label', '--remove-label', '-R', '--repo']);
const GH_PR_MERGE_FLAGS = new Map([
  ['--rebase', 'rebase'],
  ['-r', 'rebase'],
  ['--squash', 'squash'],
  ['-s', 'squash'],
  ['--auto', 'auto'],
  ['--disable-auto', 'disable-auto'],
]);
const GH_API_FLAGS = new Map([
  ['--method', 'value'],
  ['--paginate', 'bool'],
  ['--jq', 'value'],
  ['--template', 'value'],
  ['--include', 'bool'],
  ['--silent', 'bool'],
  ['--slurp', 'bool'],
  ['--cache', 'value'],
  ['--field', 'field'],
  ['--raw-field', 'field'],
]);
const GH_API_SHORT = new Map([
  ['X', '--method'],
  ['q', '--jq'],
  ['t', '--template'],
  ['i', '--include'],
  ['f', '--raw-field'],
  ['F', '--field'],
]);

const GIT_PUSH_LONG_FLAGS = new Set([
  '--quiet',
  '--verbose',
  '--no-verify',
  '--set-upstream',
  '--dry-run',
  '--no-progress',
  '--porcelain',
  '--force-if-includes',
]);
const GIT_PUSH_SHORT_FLAGS = new Set(['q', 'u', 'v', 'n']);
const GIT_FETCH_FLAGS = new Set(['-q', '--quiet', '-f', '--force', '--prune', '--no-tags']);
const GIT_REBASE_FLAGS = new Set(['-q', '--quiet', '--continue', '--abort', '--skip']);
const GIT_REBASE_STRATEGY_OPTIONS = new Set(['theirs', 'ours']);
const GIT_REBASE_CONTROL = new Set(['--continue', '--abort', '--skip']);

const deny = (reason) => ({ allowed: false, reason });
const allow = { allowed: true };

function stripRepoFlag(args) {
  if ((args[0] === '-R' || args[0] === '--repo') && args.length > 1)
    return { repo: args[1], rest: args.slice(2) };
  if (args[0]?.startsWith('--repo='))
    return { repo: args[0].slice('--repo='.length), rest: args.slice(1) };
  return { repo: undefined, rest: args };
}

function parseGhApi(args) {
  const parsed = { method: undefined, fields: false, positional: [], bad: undefined };
  const take = (name, inline, next) => {
    const kind = GH_API_FLAGS.get(name);
    if (kind === undefined) return false;
    if (kind === 'bool') return inline === undefined ? 0 : false;
    const value = inline ?? next();
    if (value === undefined) return false;
    if (name === '--method') parsed.method = value;
    if (kind === 'field') parsed.fields = true;
    return 0;
  };
  for (let i = 0; i < args.length && !parsed.bad; i++) {
    const arg = args[i];
    const next = () => (i + 1 < args.length ? args[++i] : undefined);
    if (arg.startsWith('--')) {
      const [name, inline] = arg.split(/=(.*)/s);
      if (take(name, inline, next) === false) parsed.bad = arg;
    } else if (arg.startsWith('-') && arg.length > 1) {
      for (let k = 1; k < arg.length; k++) {
        const name = GH_API_SHORT.get(arg[k]);
        const kind = name && GH_API_FLAGS.get(name);
        if (!kind) {
          parsed.bad = arg;
          break;
        }
        if (kind === 'bool') continue;
        const rest = arg.slice(k + 1).replace(/^=/, '');
        if (take(name, rest === '' ? undefined : rest, next) === false) parsed.bad = arg;
        break;
      }
    } else parsed.positional.push(arg);
  }
  return parsed;
}

function checkGhApi(args) {
  const { method, fields, positional, bad } = parseGhApi(args);
  if (bad)
    return deny(
      `gh api ${bad} is refused (allowed: GET reads with --method, --paginate, --jq, --template, --include, --silent, --slurp, --cache, and fields only with an explicit GET)`,
    );
  if (method !== undefined && method.toUpperCase() !== 'GET')
    return deny(`gh api is read-only; method ${method} is refused`);
  if (positional.length !== 1) return deny('gh api needs exactly one endpoint');
  if (positional[0] === 'graphql') return deny('gh api graphql is refused: GraphQL is POST only');
  if (method === undefined && fields)
    return deny('gh api with body fields is an implicit POST and is refused');
  return allow;
}

function parsePrMerge(args) {
  const parsed = {
    flags: new Set(),
    head: undefined,
    repo: undefined,
    positional: [],
    unknown: undefined,
  };
  for (let i = 0; i < args.length; i++) {
    const [name, inline] = args[i].split(/=(.*)/s);
    if (name === '-R' || name === '--repo') {
      parsed.repo = inline ?? args[++i];
    } else if (name === '--match-head-commit') {
      parsed.head = inline ?? args[++i];
    } else if (GH_PR_MERGE_FLAGS.has(name) && inline === undefined) {
      parsed.flags.add(GH_PR_MERGE_FLAGS.get(name));
    } else if (args[i].startsWith('-')) {
      parsed.unknown ??= args[i];
    } else parsed.positional.push(args[i]);
  }
  return parsed;
}

export function verdictFor(comments, head) {
  const pattern = new RegExp(
    `^<!-- review-gate:${head} -->\\n\\*\\*Independent review gate: (PASS|BLOCK)\\*\\*(?: \\(carried over\\))? for `,
  );
  return (
    comments
      .filter((comment) => comment.login === REVIEWER)
      .map((comment) => pattern.exec(comment.body ?? '')?.[1])
      .filter(Boolean)
      .at(-1) ?? null
  );
}

function checkPrMerge(args, outerRepo, gate) {
  const { flags, head, positional, unknown, repo: innerRepo } = parsePrMerge(args);
  const repo = innerRepo ?? outerRepo;
  const refuse = (why) => deny(`gh pr merge is refused: ${why}`);
  if (unknown)
    return refuse(
      `${unknown} is not allowed (admin, branch deletion and message overrides are refused)`,
    );
  if (positional.length !== 1) return refuse('name exactly one pull request');
  if (flags.has('disable-auto')) {
    return flags.size === 1 && head === undefined
      ? allow
      : refuse('--disable-auto cannot be combined with other merge flags');
  }
  if (!/^[0-9a-f]{40}$/.test(head ?? ''))
    return refuse(
      '--match-head-commit <40-hex sha> is required so the merge is pinned to the reviewed head',
    );
  const methods = ['rebase', 'squash'].filter((method) => flags.has(method));
  if (methods.length !== 1) return refuse('use exactly one of --rebase or --squash');
  if (!/^\d+$/.test(positional[0]) || !/^[\w.-]+\/[\w.-]+$/.test(repo ?? ''))
    return refuse('name the pull request by number with -R <owner>/<repo>');
  let comments;
  try {
    comments = gate(repo, positional[0]);
  } catch (error) {
    return refuse(`the review-gate verdict could not be read (${error.message.split('\n')[0]})`);
  }
  const verdict = verdictFor(comments, head);
  if (verdict !== 'PASS')
    return refuse(
      `the latest ${REVIEWER} review-gate verdict for ${head.slice(0, 8)} is ${verdict ?? 'missing'}; the bot merges only a head the review gate passed`,
    );
  return allow;
}

function checkPrEdit(args) {
  const flags = args.filter((arg) => arg.startsWith('-'));
  const bad = flags.find((flag) => !GH_PR_EDIT_FLAGS.has(flag.split('=')[0]));
  if (bad) return deny(`gh pr edit may only change labels; ${bad} is refused`);
  if (!flags.some((flag) => flag.startsWith('--add-label') || flag.startsWith('--remove-label')))
    return deny('gh pr edit needs --add-label or --remove-label');
  return allow;
}

function checkGh(args, gate) {
  const { repo, rest } = stripRepoFlag(args);
  const [group, sub, ...tail] = rest;
  if (!group || !(group in GH_ALLOWED))
    return deny(
      `gh ${group ?? ''} is not on the as-bot allowlist (allowed groups: pr, issue, api)`,
    );
  if (group === 'api') return checkGhApi(rest.slice(1));
  if (!sub || !GH_ALLOWED[group].has(sub))
    return deny(`gh ${group} ${sub ?? ''} is not on the as-bot allowlist`);
  if (rest.includes('--delete-last')) return deny('--delete-last is refused');
  if (group === 'pr' && sub === 'merge') return checkPrMerge(tail, repo, gate);
  if (group === 'pr' && sub === 'edit') return checkPrEdit(tail);
  return allow;
}

function destinationOf(spec) {
  return spec.includes(':') ? spec.slice(spec.indexOf(':') + 1) : spec;
}

function checkRefspec(spec) {
  if (spec.startsWith('+')) return deny(`forced refspec ${spec} is refused`);
  if (spec.startsWith(':') || spec.endsWith(':'))
    return deny(`deleting refspec ${spec} is refused`);
  if (/[*?[\\]/.test(spec)) return deny(`pattern refspec ${spec} is refused`);
  const target = destinationOf(spec);
  if (!spec.includes(':') && (target === 'HEAD' || target === '@'))
    return deny('push needs an explicit destination branch (HEAD:<branch>)');
  if (target.startsWith('refs/') && !target.startsWith('refs/heads/'))
    return deny(`pushing to ${target} is refused: only branches are allowed`);
  const branch = target.replace(/^refs\/heads\//, '').replace(/^heads\//, '');
  if (PROTECTED_BRANCHES.has(branch)) return deny(`pushing to ${branch} is refused`);
  return allow;
}

function checkGitPush(args) {
  const positional = [];
  for (const arg of args) {
    if (arg.startsWith('--force-with-lease')) continue;
    if (arg.startsWith('--')) {
      if (!GIT_PUSH_LONG_FLAGS.has(arg.split('=')[0]))
        return deny(`git push ${arg} is refused (force, delete and bulk pushes are not allowed)`);
    } else if (arg.startsWith('-') && arg.length > 1) {
      const bad = [...arg.slice(1)].find((char) => !GIT_PUSH_SHORT_FLAGS.has(char));
      if (bad) return deny(`git push ${arg} is refused (-${bad} is not allowed)`);
    } else positional.push(arg);
  }
  const [remote, ...refspecs] = positional;
  if (remote !== 'origin') return deny('git push must name the origin remote');
  if (refspecs.length === 0) return deny('git push needs an explicit branch refspec');
  for (const spec of refspecs) {
    const verdict = checkRefspec(spec);
    if (!verdict.allowed) return verdict;
  }
  return allow;
}

function checkGitFetch(args) {
  const bad = args.find((arg) => arg.startsWith('-') && !GIT_FETCH_FLAGS.has(arg));
  if (bad) return deny(`git fetch ${bad} is refused (allowed: ${[...GIT_FETCH_FLAGS].join(', ')})`);
  const remote = args.find((arg) => !arg.startsWith('-'));
  if (remote !== undefined && remote !== 'origin')
    return deny('git fetch must name the origin remote');
  return allow;
}

function checkGitRebase(args) {
  const positional = [];
  let control = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-X' || arg.startsWith('-X') || arg.startsWith('--strategy-option=')) {
      const value = arg === '-X' ? args[++i] : arg.replace(/^(-X=?|--strategy-option=)/, '');
      if (!GIT_REBASE_STRATEGY_OPTIONS.has(value ?? ''))
        return deny(`git rebase ${arg} ${value ?? ''} is refused (only -X theirs or -X ours)`);
    } else if (GIT_REBASE_FLAGS.has(arg)) {
      control ||= GIT_REBASE_CONTROL.has(arg);
    } else if (arg.startsWith('-')) {
      return deny(
        `git rebase ${arg} is refused (allowed: ${[...GIT_REBASE_FLAGS].join(', ')}, -X theirs|ours)`,
      );
    } else positional.push(arg);
  }
  if (control ? positional.length > 0 : positional.length !== 1)
    return deny('git rebase takes exactly one upstream, or --continue, --abort or --skip alone');
  return allow;
}

function checkGit(args) {
  let rest = args;
  while (rest[0] === '-C' && rest.length > 2) rest = rest.slice(2);
  const [sub, ...tail] = rest;
  if (sub === 'push') return checkGitPush(tail);
  if (sub === 'fetch') return checkGitFetch(tail);
  if (sub === 'rebase') return checkGitRebase(tail);
  if (sub === 'commit') return allow;
  return deny(
    `git ${sub ?? ''} is not on the as-bot allowlist (allowed: fetch, push, commit, rebase)`,
  );
}

function readGateComments(repo, pr) {
  const out = execFileSync(
    'gh',
    [
      'api',
      '--paginate',
      `repos/${repo}/issues/${pr}/comments?per_page=100`,
      '--jq',
      '.[] | {login: .user.login, body} | @json',
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function checkCommand(argv, gate = readGateComments) {
  const [program, ...args] = argv;
  if (program === 'gh') return checkGh(args, gate);
  if (program === 'git') return checkGit(args);
  return deny(
    `${program ?? '(none)'} is not on the as-bot allowlist: only gh and git run with the bot token`,
  );
}

if (process.argv[1] && realpathSync(process.argv[1]) === import.meta.filename) {
  const verdict = checkCommand(process.argv.slice(2));
  if (!verdict.allowed) {
    process.stderr.write(`as-bot: refused: ${verdict.reason}\n`);
    process.exit(2);
  }
}
