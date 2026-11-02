#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const SEPARATORS = new Set([';', '&&', '||', '|', '&', '\n', '(', ')']);
const HEREDOC_SUBST = /\$\(\s*cat\s*<<\s*(['"]?)(\w+)\1[^\n]*\n([\s\S]*?)\n\2\n?\s*\)/g;

export function tokenize(command) {
  const heredocs = [];
  const source = command.replace(HEREDOC_SUBST, (_match, quote, _tag, body) => {
    heredocs.push({ body, expands: quote === '' && /[$`]/.test(body) });
    return `\u0000${heredocs.length - 1}\u0000`;
  });
  const tokens = [];
  let current = null;
  let dynamic = false;
  const push = () => {
    if (current !== null) tokens.push(dynamic ? { dynamic: current } : current);
    current = null;
    dynamic = false;
  };
  const append = (text) => {
    current = (current ?? '') + text;
  };
  const appendHeredoc = (index) => {
    const heredoc = heredocs[Number(index)];
    if (heredoc.expands) dynamic = true;
    append(heredoc.body);
  };
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '\u0000') {
      const end = source.indexOf('\u0000', i + 1);
      appendHeredoc(source.slice(i + 1, end));
      i = end;
    } else if (ch === "'") {
      const end = source.indexOf("'", i + 1);
      append(source.slice(i + 1, end === -1 ? source.length : end));
      i = end === -1 ? source.length : end;
    } else if (ch === '"') {
      append('');
      for (i += 1; i < source.length && source[i] !== '"'; i += 1) {
        if (source[i] === '\\' && '"\\$`\n'.includes(source[i + 1] ?? '')) {
          i += 1;
          if (source[i] !== '\n') append(source[i]);
        } else if (source[i] === '\u0000') {
          const end = source.indexOf('\u0000', i + 1);
          appendHeredoc(source.slice(i + 1, end));
          i = end;
        } else {
          if (source[i] === '$' || source[i] === '`') dynamic = true;
          append(source[i]);
        }
      }
    } else if (ch === '\\') {
      i += 1;
      if (source[i] !== '\n' && i < source.length) append(source[i]);
    } else if (ch === '$' || ch === '`') {
      dynamic = true;
      append(ch);
    } else if (ch === ' ' || ch === '\t') {
      push();
    } else if (ch === '\n' || ch === ';' || ch === '(' || ch === ')') {
      push();
      tokens.push(ch);
    } else if (ch === '&' || ch === '|') {
      push();
      if (source[i + 1] === ch) {
        tokens.push(ch + ch);
        i += 1;
      } else {
        tokens.push(ch);
      }
    } else {
      append(ch);
    }
  }
  push();
  return tokens;
}

function segments(tokens) {
  const result = [[]];
  for (const token of tokens) {
    if (typeof token === 'string' && SEPARATORS.has(token)) result.push([]);
    else result[result.length - 1].push(token);
  }
  return result.filter((segment) => segment.length > 0);
}

const text = (token) => (typeof token === 'string' ? token : token.dynamic);

function flagValue(args, index, names) {
  const token = args[index];
  for (const name of names) {
    if (token === name) return { name, value: args[index + 1], consumed: 2 };
    if (name.startsWith('--') && text(token).startsWith(`${name}=`)) {
      const value = text(token).slice(name.length + 1);
      return { name, value: typeof token === 'string' ? value : { dynamic: value }, consumed: 1 };
    }
  }
  return undefined;
}

const isDynamic = (value) => typeof value === 'object' && value !== null;

const DYNAMIC_REASON =
  'the PR body comes from a variable, command substitution or stdin, so it cannot be checked. Write it to a file in a separate Bash call and pass --body-file <path> (or -F body=@<path> for gh api).';

function shortFlag(token, flag) {
  const raw = text(token);
  if (!raw.startsWith(flag) || raw.length === flag.length || raw.startsWith('--')) return undefined;
  const value = raw.slice(flag.length);
  return typeof token === 'string' ? value : { dynamic: value };
}

function prBodies(args, ctx) {
  const bodies = [];
  for (let i = 0; i < args.length; i += 1) {
    if (/^--fill(-first|-verbose)?$/.test(text(args[i]))) {
      bodies.push({
        error:
          'gh pr create --fill builds the body from commits, which fails pr-evidence; pass --body-file <path>.',
      });
      continue;
    }
    const file = flagValue(args, i, ['--body-file', '-F']);
    const fileAttached = file ? undefined : shortFlag(args[i], '-F');
    if (file || fileAttached !== undefined) {
      bodies.push(bodyFromFile(file ? file.value : fileAttached, ctx));
      if (file) i += file.consumed - 1;
      continue;
    }
    const inline = flagValue(args, i, ['--body', '-b']);
    const inlineAttached = inline ? undefined : shortFlag(args[i], '-b');
    if (inline || inlineAttached !== undefined) {
      const value = inline ? inline.value : inlineAttached;
      bodies.push(isDynamic(value) ? { error: DYNAMIC_REASON } : { text: value ?? '' });
      if (inline) i += inline.consumed - 1;
    }
  }
  return bodies;
}

function bodyFromFile(path, ctx) {
  if (isDynamic(path) || path === undefined || path === '-') return { error: DYNAMIC_REASON };
  const full = resolve(ctx.cwd, path);
  if (
    ctx.earlier.some(
      (token) => text(token).includes(path) || resolve(ctx.cwd, text(token)) === full,
    )
  ) {
    return {
      error: `${path} is written earlier in this same command, and the hook runs before any of it. Write the body file in a separate Bash call, then run gh.`,
    };
  }
  if (!existsSync(full)) return { error: `body file not found: ${full}` };
  return { text: readFileSync(full, 'utf8') };
}

function apiMethod(args) {
  for (let i = 0; i < args.length; i += 1) {
    const raw = text(args[i]);
    if (raw === '-X' || raw === '--method') return text(args[i + 1] ?? '');
    if (raw.startsWith('--method=')) return raw.slice(9);
    if (raw.startsWith('-X') && raw.length > 2) return raw.slice(2);
  }
  return undefined;
}

function apiBodies(args, ctx) {
  if (args.some((arg) => text(arg) === 'graphql')) {
    return args.some((arg) => /\b(update|create)PullRequest\b/.test(text(arg)))
      ? [
          {
            error:
              'PR bodies set through GraphQL cannot be checked; use gh pr edit --body-file <path>.',
          },
        ]
      : [];
  }
  if (apiMethod(args)?.toUpperCase() !== 'PATCH') return [];
  if (!args.some((arg) => /(^|\/)pulls\/[^/\s]+\/?$/.test(text(arg)))) return [];
  const bodies = [];
  for (let i = 0; i < args.length; i += 1) {
    const field = flagValue(args, i, ['-f', '--raw-field', '-F', '--field']);
    if (field) {
      i += field.consumed - 1;
      if (field.value === undefined || !text(field.value).startsWith('body=')) continue;
      if (isDynamic(field.value)) {
        bodies.push({ error: DYNAMIC_REASON });
        continue;
      }
      const value = field.value.slice(5);
      const typed = field.name === '-F' || field.name === '--field';
      bodies.push(
        typed && value.startsWith('@') ? bodyFromFile(value.slice(1), ctx) : { text: value },
      );
      continue;
    }
    const input = flagValue(args, i, ['--input']);
    if (input) {
      i += input.consumed - 1;
      const file = bodyFromFile(input.value, ctx);
      if (file.error) {
        bodies.push(file);
        continue;
      }
      let parsed;
      try {
        parsed = JSON.parse(file.text);
      } catch {
        bodies.push({ error: `--input ${text(input.value)} is not valid JSON.` });
        continue;
      }
      if (typeof parsed?.body === 'string') bodies.push({ text: parsed.body });
    }
  }
  return bodies;
}

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

function ghArgs(segment) {
  let i = 0;
  while (i < segment.length && ASSIGNMENT.test(text(segment[i]))) i += 1;
  if (text(segment[i] ?? '') === 'env') i += 1;
  while (i < segment.length && ASSIGNMENT.test(text(segment[i]))) i += 1;
  if (segment[i] === undefined || basename(text(segment[i])) !== 'gh') return undefined;
  i += 1;
  while (i < segment.length) {
    const raw = text(segment[i]);
    if (raw === '-R' || raw === '--repo') i += 2;
    else if (raw.startsWith('--repo=') || (raw.startsWith('-R') && raw.length > 2)) i += 1;
    else break;
  }
  return segment.slice(i);
}

export function extractBodies(command, cwd) {
  const bodies = [];
  const earlier = [];
  let current = cwd;
  for (const segment of segments(tokenize(command))) {
    const args = ghArgs(segment);
    const ctx = { cwd: current, earlier };
    if (args?.[0] === 'pr' && (args[1] === 'create' || args[1] === 'edit')) {
      bodies.push(...prBodies(args.slice(2), ctx));
    } else if (args?.[0] === 'api') {
      bodies.push(...apiBodies(args.slice(1), ctx));
    }
    if (segment[0] === 'cd' && typeof segment[1] === 'string')
      current = resolve(current, segment[1]);
    earlier.push(...segment.filter((token) => text(token).length > 0));
  }
  return bodies;
}

const CHECKS = [
  ['python3', ['scripts/pr-evidence-gate.py']],
  ['python3', ['scripts/pr-tasks-gate.py']],
  ['node', ['scripts/english-only-gate.mjs', '--text']],
];

export function checkBody(body) {
  const dir = mkdtempSync(join(tmpdir(), 'pr-body-hook-'));
  try {
    const file = join(dir, 'pr-body.md');
    writeFileSync(file, body);
    const failures = [];
    for (const [bin, args] of CHECKS) {
      const run = spawnSync(bin, [...args, file], { cwd: REPO, encoding: 'utf8' });
      if (run.status !== 0) failures.push(`${args[0]}:\n${run.stdout}${run.stderr}`.trim());
    }
    return failures;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function decide(input) {
  if (input.tool_name !== 'Bash') return { block: false };
  const command = input.tool_input?.command;
  if (typeof command !== 'string' || !/\bgh\b/.test(command)) return { block: false };
  const reasons = [];
  for (const body of extractBodies(command, input.cwd ?? process.cwd())) {
    if (body.error) reasons.push(`pr-body-hook: ${body.error}`);
    else reasons.push(...checkBody(body.text));
  }
  return reasons.length > 0 ? { block: true, reason: reasons.join('\n\n') } : { block: false };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let result;
  try {
    result = decide(JSON.parse(readFileSync(0, 'utf8')));
  } catch (error) {
    result = {
      block: true,
      reason: `pr-body-hook crashed, so the command is blocked: ${error.stack}`,
    };
  }
  if (result.block) {
    process.stderr.write(
      `${result.reason}\n\nThe PR body fails checks pr-evidence runs in CI (CI also checks the ## Size section and schema tables, which this hook skips). Fix the body and retry.\n`,
    );
    process.exit(2);
  }
}
