import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadPolicy } from './owner-routing.mjs';

const HOME = process.env.HOME;
const REPO = process.env.REVIEW_GATE_REPO ?? 'xiechimon/cairn';
const MAIN = process.env.REVIEW_GATE_MAIN ?? `${HOME}/lanes/cairn`;
const BOT = process.env.REVIEW_GATE_BOT ?? `${HOME}/.cairn/tools/app-token/as-bot.sh`;
const STATE = process.env.REVIEW_GATE_STATE ?? `${HOME}/.local/state/review-gate`;
const EXTRA_PROTECTED = [/^docs\/spec\//, /^integration\/eval\//, /merge-gate/, /baseline/];
const MERGE = process.env.REVIEW_GATE_MERGE ?? `${HOME}/.cairn/tools/merge-pr.sh`;
const PROMPT = process.env.REVIEW_GATE_PROMPT ?? `${HOME}/.cairn/tools/review-gate/prompt.txt`;
const TIER = process.env.REVIEW_GATE_TIER ?? `${HOME}/.cairn/tools/governor/tier.sh`;
const RUNS = process.env.REVIEW_GATE_RUNS ?? `${HOME}/.local/state/ai-route/runs.jsonl`;
let policy;
let policyError;
const needsReview = (path) =>
  policy.isProtected(path) || EXTRA_PROTECTED.some((re) => re.test(path));

mkdirSync(`${STATE}/runs`, { recursive: true });
const record = (pr, fields) => {
  appendFileSync(
    `${STATE}/runs.jsonl`,
    `${JSON.stringify({ at: new Date().toISOString(), pr: pr.number, sha: pr.headRefOid, ...fields })}\n`,
  );
};

const gh = (args) =>
  execFileSync('gh', args[0] === 'api' ? args : ['-R', REPO, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 << 20,
  });
const asBot = (args, input) =>
  execFileSync(BOT, args, { encoding: 'utf8', input, cwd: MAIN, maxBuffer: 64 << 20 });

const readMergeReasons = (pr) => {
  if (policyError) throw new Error(policyError);
  const files = JSON.parse(
    gh(['api', '--paginate', '--slurp', `repos/${REPO}/pulls/${pr.number}/files?per_page=100`]),
  ).flat();
  const head = JSON.parse(gh(['api', `repos/${REPO}/pulls/${pr.number}`])).head.sha;
  if (head !== pr.headRefOid) throw new Error('PR head moved since review');
  if (!files.length || files.length >= 3000) throw new Error('Incomplete PR file list');
  const changedFiles = files.flatMap((file) =>
    file.previous_filename ? [file.filename, file.previous_filename] : [file.filename],
  );
  const deletedFiles = files.flatMap((file) =>
    file.status === 'removed'
      ? [file.filename]
      : file.status === 'renamed'
        ? [file.previous_filename]
        : [],
  );
  const numstat = execFileSync(
    'git',
    [
      '-c',
      'core.quotePath=false',
      '--attr-source=4b825dc642cb6eb9a060e54bf8d69288fbee4904',
      'diff',
      '--no-renames',
      '--numstat',
      `origin/main...${pr.headRefOid}`,
    ],
    { cwd: MAIN, encoding: 'utf8', maxBuffer: 64 << 20 },
  );
  const binaryFiles = numstat.split('\n').flatMap((row) => {
    const [additions, deletions, path] = row.split('\t');
    return additions === '-' && deletions === '-' ? [path] : [];
  });
  const reasons = policy.ownerRouting({
    changedFiles,
    deletedFiles,
    binaryFiles,
    linesChanged: numstat.split('\n').reduce((sum, row) => {
      const [added, deleted] = row.split('\t');
      return sum + (Number(added) || 0) + (Number(deleted) || 0);
    }, 0),
  });
  if (
    JSON.parse(
      gh([
        'issue',
        'list',
        '--state',
        'open',
        '--label',
        'autonomy-paused',
        '--limit',
        '1',
        '--json',
        'number',
      ]),
    ).length
  )
    reasons.push('autonomy-paused');
  if (/^B[^/]*\//.test(pr.headRefName)) reasons.push('bootstrap branch');
  return reasons;
};
const mergeReasons = (pr) => {
  try {
    return readMergeReasons(pr);
  } catch (error) {
    return [`merge eligibility unavailable: ${error.message}`];
  }
};
const reconcileMerge = (pr, pass) => {
  const reasons = mergeReasons(pr);
  if (!pass || reasons.length) {
    asBot(['gh', 'pr', 'merge', String(pr.number), '-R', REPO, '--disable-auto']);
    console.log(`#${pr.number}: auto-merge off: ${reasons.join('; ') || 'review did not pass'}`);
    return 'auto-merge-off';
  }
  execFileSync(MERGE, [String(pr.number), '--auto', '--match-head-commit', pr.headRefOid], {
    cwd: MAIN,
    encoding: 'utf8',
  });
  return 'auto-merge';
};

export function finalVerdict(out) {
  const lines = out.split('\n');
  const at = lines.findLastIndex((l) => /^[\s*`>#_-]*VERDICT:\s*(pass|block)[\s*`_.]*$/i.test(l));
  if (at < 0) return {};
  const verdict = lines[at].match(/VERDICT:\s*(pass|block)/i)[1].toLowerCase();
  const promptEnd = lines.findLastIndex((l, k) => k < at && l.includes('Protected paths touched:'));
  const finalMessage = lines.findLastIndex((l, k) => k < at && l.trim() === 'codex');
  const body = lines.slice(Math.max(promptEnd, finalMessage) + 1, at + 1);
  const lastList = body.findLastIndex((l) => /^[\s*#]*1[.)]\s/.test(l));
  const firstList = body.findIndex((l) => /^[\s*#]*1[.)]\s/.test(l));
  const repeated = lastList > firstList && body[lastList].trim() === body[firstList].trim();
  const text = (repeated ? body.slice(lastList) : body).join('\n').trim();
  const review = text.length > 3000 ? `…\n${text.slice(-3000)}` : text;
  return { verdict, review };
}

try {
  const prs = JSON.parse(
    gh([
      'pr',
      'list',
      '--state',
      'open',
      '--limit',
      '100',
      '--json',
      'number,isDraft,headRefOid,headRefName,files,title,labels',
    ]),
  );
  execFileSync(BOT, ['git', 'fetch', '-q', 'origin', 'main'], { cwd: MAIN });
  try {
    policy = loadPolicy(
      execFileSync('git', ['show', 'origin/main:.claude/workflows/pr-gate.js'], {
        cwd: MAIN,
        encoding: 'utf8',
      }),
    );
  } catch (error) {
    policyError = `routing policy unavailable: ${error.message}`;
    for (const pr of prs) reconcileMerge(pr, false);
    process.exitCode = 1;
  }
  if (policyError) throw new Error(policyError);
  const checkIdx = process.argv.indexOf('--check');
  if (checkIdx > 0) {
    const files = JSON.parse(
      gh(['pr', 'view', process.argv[checkIdx + 1], '--json', 'files']),
    ).files.map((f) => f.path);
    if (!files.length) process.exit(2);
    process.exit(files.some(needsReview) ? 0 : 3);
  }
  const todo = [];
  for (const pr of prs) {
    if (pr.isDraft) continue;
    const touched = pr.files.map((f) => f.path).filter(needsReview);
    const optIn = pr.labels.some((l) => l.name === 'review-gate');
    const lane = pr.headRefName.match(/^lane\/(\d+)$/)?.[1];
    if (!touched.length && !optIn && !lane) continue;
    if (!touched.length)
      touched.push(
        lane ? '(none; every lane PR is reviewed)' : '(opted in with the review-gate label)',
      );
    execFileSync(
      BOT,
      [
        'git',
        'fetch',
        '-q',
        'origin',
        'main',
        `pull/${pr.number}/head:review-gate-${pr.number}`,
        '--force',
      ],
      { cwd: MAIN },
    );
    const marker = `<!-- review-gate:${pr.headRefOid} -->`;
    const comments = JSON.parse(
      gh(['pr', 'view', String(pr.number), '--json', 'comments']),
    ).comments;
    const current = comments.find((c) => c.body.includes(marker));
    if (current) {
      reconcileMerge(pr, /Independent review gate: PASS/.test(current.body));
      continue;
    }
    if (mergeReasons(pr).length) reconcileMerge(pr, false);
    const patch = execFileSync(
      'bash',
      [
        '-c',
        `git diff origin/main...review-gate-${pr.number} | git patch-id --stable | cut -d' ' -f1`,
      ],
      { cwd: MAIN, encoding: 'utf8' },
    ).trim();
    const prior =
      patch &&
      comments.find(
        (c) =>
          c.body.includes(`<!-- review-gate-patch:${patch} -->`) &&
          /Independent review gate: PASS/.test(c.body),
      );
    if (prior) {
      const from = prior.body.match(/review-gate:([0-9a-f]{40})/)?.[1] ?? '?';
      asBot(
        ['gh', 'pr', 'comment', String(pr.number), '-R', REPO, '--body-file', '-'],
        `${marker}\n**Independent review gate: PASS** (carried over) for \`${pr.headRefOid.slice(0, 8)}\`: same patch as the reviewed head \`${from.slice(0, 8)}\`; only the base moved.\n<!-- review-gate-patch:${patch} -->`,
      );
      record(pr, { verdict: 'pass', action: reconcileMerge(pr, true), from });
      console.log(`#${pr.number}: PASS carried over from ${from.slice(0, 8)} (patch unchanged)`);
      continue;
    }
    const lastBlock = comments
      .filter(
        (c) =>
          /<!-- review-gate:[0-9a-f]{40} -->/.test(c.body) &&
          /Independent review gate: BLOCK/.test(c.body),
      )
      .at(-1);
    todo.push({ ...pr, touched, marker, patch, lane, lastBlock: lastBlock?.body });
  }
  const PRIORITY = (() => {
    try {
      return readFileSync(`${STATE}/priority`, 'utf8').split(/\s+/).filter(Boolean).map(Number);
    } catch {
      return [];
    }
  })();
  const rank = (n) => (PRIORITY.includes(n) ? PRIORITY.indexOf(n) : PRIORITY.length);
  todo.sort((a, b) => rank(a.number) - rank(b.number));
  if (!todo.length) {
    console.log('nothing to review');
    process.exit(0);
  }
  const PREFER = ['codex', 'cursor', 'grok'];
  const CONCURRENCY = Number(process.env.REVIEW_GATE_CONCURRENCY ?? 4);
  const vendorOf = (kind, model) => {
    if (kind === 'codex') return 'openai';
    if (kind === 'grok' || (kind === 'cursor' && model.includes('grok'))) return 'xai';
    const m = model.toLowerCase();
    for (const [k, v] of [
      ['claude', 'anthropic'],
      ['haiku', 'anthropic'],
      ['gpt', 'openai'],
      ['grok', 'xai'],
      ['kimi', 'moonshot'],
      ['deepseek', 'deepseek'],
      ['glm', 'zhipu'],
      ['qwen', 'alibaba'],
      ['gemini', 'google'],
    ]) {
      if (m.includes(k)) return v;
    }
    return kind;
  };
  const runs = (() => {
    try {
      return readFileSync(RUNS, 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l));
    } catch {
      return [];
    }
  })();
  const authorVendor = (pr) => {
    const lane = pr.headRefName.match(/^lane\/(\w+)/)?.[1];
    if (!lane) return null;
    const last = runs
      .filter((r) => r.role === 'implement' && !r.failed && r.cwd?.endsWith(`cairn-${lane}`))
      .at(-1);
    return last ? vendorOf(last.kind, last.model) : null;
  };
  const runReview = (pr, slot) =>
    new Promise((resolve) => {
      const prompt = `${readFileSync(PROMPT, 'utf8')}

  PR: #${pr.number} ${pr.title}
  Review: \`git diff origin/main...review-gate-${pr.number}\` in this checkout (do not check anything out), plus \`gh pr view ${pr.number} --json title,body\`.
${
  pr.lastBlock
    ? `
  This is a re-review. The previous review blocked an earlier head with the findings below. Check ONLY whether each of those findings is now fixed (answer per finding: fixed / not fixed, with file:line). Do not raise new findings unless the new commits since that review introduce a blocking bug. Block only if a previous blocking finding is not fixed or a new commit broke something.

  Previous review:
  ${pr.lastBlock.replace(/<!--[^>]*-->/g, '').slice(0, 6000)}
`
    : ''
}
  Protected paths touched: ${pr.touched.join(', ')}`;
      const tierEnv = pr.lane
        ? Object.fromEntries(
            execFileSync(TIER, ['env', pr.lane, 'review'], {
              encoding: 'utf8',
            })
              .trim()
              .split(/\s+/)
              .filter(Boolean)
              .map((kv) => kv.split('=')),
          )
        : null;
      const env = {
        ...process.env,
        ...(tierEnv ?? { AI_ROUTE_PREFER: PREFER[slot % PREFER.length] }),
      };
      const av = authorVendor(pr);
      if (av) env.AI_ROUTE_EXCLUDE_VENDORS = av;
      console.log(
        `reviewing #${pr.number} @ ${pr.headRefOid.slice(0, 8)} (slot ${slot}, prefer ${env.AI_ROUTE_PREFER}${av ? `, author ${av} excluded` : ''})`,
      );
      const child = spawn('ai-route', ['run', 'review', '--hard', '-C', MAIN, prompt], { env });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => (stdout += d));
      child.stderr.on('data', (d) => (stderr += d));
      const timer = setTimeout(() => child.kill('SIGKILL'), 3600_000);
      child.on('close', (status) => {
        clearTimeout(timer);
        resolve({ status, stdout, stderr, excluded: Boolean(av) });
      });
    });
  const finish = (pr, run) => {
    const out = run.stdout;
    const { verdict, review } = finalVerdict(out);
    const rawFile = `${STATE}/runs/${pr.number}-${pr.headRefOid.slice(0, 12)}.out`;
    writeFileSync(rawFile, out);
    record(pr, {
      verdict: verdict ?? null,
      action: 'reviewed',
      rc: run.status,
      raw: rawFile,
      reviewChars: (review ?? '').length,
    });
    if (!verdict) {
      console.log(`no verdict for #${pr.number}; rc=${run.status}\n${run.stderr.slice(-800)}`);
      try {
        asBot(['gh', 'pr', 'merge', String(pr.number), '-R', REPO, '--disable-auto']);
      } catch {}
      return /no usable model/.test(run.stderr) && !run.excluded ? 'no-model' : 'none';
    }
    const body =
      verdict === 'pass'
        ? `${pr.marker}\n**Independent review gate: PASS** for \`${pr.headRefOid.slice(0, 8)}\`.\n<!-- review-gate-patch:${pr.patch} -->`
        : `${pr.marker}\n**Independent review gate: BLOCK** for \`${pr.headRefOid.slice(0, 8)}\`.\n\n${review}\n<!-- review-gate-patch:${pr.patch} -->`;
    asBot(['gh', 'pr', 'comment', String(pr.number), '-R', REPO, '--body-file', '-'], body);
    record(pr, { verdict, action: reconcileMerge(pr, verdict === 'pass') });
    console.log(`#${pr.number}: ${verdict}`);
    return verdict;
  };
  let next = 0;
  let stop = false;
  const worker = async (slot) => {
    while (!stop && next < todo.length) {
      const pr = todo[next++];
      const result = finish(pr, await runReview(pr, slot));
      if (result === 'no-model') {
        console.log('no reviewer model available; stopping this round');
        stop = true;
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, (_, k) => worker(k)));
} finally {
  console.log(`done ${new Date().toISOString()}`);
}
