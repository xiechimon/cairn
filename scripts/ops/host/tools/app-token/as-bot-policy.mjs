import { realpathSync } from 'node:fs';

const PROTECTED_BRANCHES = new Set(['main', 'master']);

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
const GH_BODYFUL_API_FLAGS = new Set(['-f', '-F', '--field', '--raw-field', '--input']);

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
const GIT_FETCH_FORBIDDEN = /^(--upload-pack|--exec|-u$)/;
const GIT_REBASE_FORBIDDEN = new Set(['--exec', '-x', '--interactive', '-i']);

const deny = (reason) => ({ allowed: false, reason });
const allow = { allowed: true };

function stripRepoFlag(args) {
  if ((args[0] === '-R' || args[0] === '--repo') && args.length > 1) return args.slice(2);
  if (args[0]?.startsWith('--repo=')) return args.slice(1);
  return args;
}

function apiMethod(args) {
  let method;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-X' || arg === '--method') method = args[++i] ?? '';
    else if (arg.startsWith('--method=')) method = arg.slice('--method='.length);
    else if (arg.startsWith('-X')) method = arg.slice(2);
  }
  return method;
}

function checkGhApi(args) {
  const method = apiMethod(args);
  if (method !== undefined && method.toUpperCase() !== 'GET')
    return deny(`gh api is read-only; method ${method} is refused`);
  const endpoint = args.find((arg) => !arg.startsWith('-'));
  if (endpoint === 'graphql') return deny('gh api graphql is refused: GraphQL is POST only');
  const bodyful = args.some((arg) => GH_BODYFUL_API_FLAGS.has(arg) || /^-[fF]./.test(arg));
  if (method === undefined && bodyful)
    return deny('gh api with body fields is an implicit POST and is refused');
  return allow;
}

function parsePrMerge(args) {
  const parsed = { flags: new Set(), head: undefined, positional: [], unknown: undefined };
  for (let i = 0; i < args.length; i++) {
    const [name, inline] = args[i].split(/=(.*)/s);
    if (name === '-R' || name === '--repo') {
      if (inline === undefined) i++;
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

function checkPrMerge(args) {
  const { flags, head, positional, unknown } = parsePrMerge(args);
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

function checkGh(args) {
  const rest = stripRepoFlag(args);
  const [group, sub, ...tail] = rest;
  if (!group || !(group in GH_ALLOWED))
    return deny(
      `gh ${group ?? ''} is not on the as-bot allowlist (allowed groups: pr, issue, api)`,
    );
  if (group === 'api') return checkGhApi(rest.slice(1));
  if (!sub || !GH_ALLOWED[group].has(sub))
    return deny(`gh ${group} ${sub ?? ''} is not on the as-bot allowlist`);
  if (rest.includes('--delete-last')) return deny('--delete-last is refused');
  if (group === 'pr' && sub === 'merge') return checkPrMerge(tail);
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

function checkGit(args) {
  let rest = args;
  while (rest[0] === '-C' && rest.length > 2) rest = rest.slice(2);
  const [sub, ...tail] = rest;
  if (sub === 'push') return checkGitPush(tail);
  if (sub === 'fetch') {
    const bad = tail.find((arg) => GIT_FETCH_FORBIDDEN.test(arg));
    if (bad) return deny(`git fetch ${bad} is refused`);
    const remote = tail.find((arg) => !arg.startsWith('-'));
    if (remote !== undefined && remote !== 'origin')
      return deny('git fetch must name the origin remote');
    return allow;
  }
  if (sub === 'rebase') {
    const bad = tail.find((arg) => GIT_REBASE_FORBIDDEN.has(arg) || /^-[a-z]*[xi]/.test(arg));
    if (bad) return deny(`git rebase ${bad} is refused`);
    return allow;
  }
  if (sub === 'commit') return allow;
  return deny(
    `git ${sub ?? ''} is not on the as-bot allowlist (allowed: fetch, push, commit, rebase)`,
  );
}

export function checkCommand(argv) {
  const [program, ...args] = argv;
  if (program === 'gh') return checkGh(args);
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
