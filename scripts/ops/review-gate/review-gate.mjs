import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import {
  BLOCK_ROUNDS,
  CLAUDE_DIFF_PATHSPEC,
  claudeFallback,
  claudeReviewArgs,
  claudeReviewPrompt,
  DIFF_LIMIT,
  diffDigest,
  escalation,
  gateVerdicts,
  HUMAN_LABEL,
  HUMAN_MARKER,
  lowRiskTier,
  parseRawDiff,
  parseRuns,
  priorFindings,
  roundStops,
  stallAlert,
  stalled,
} from './reviewer-route.mjs';
import { sizeFacts, sizeFactsLine } from './size-facts.mjs';

const HOME = process.env.HOME;
const REPO = 'xiechimon/cairn';
const MAIN = `${HOME}/lanes/cairn`;
const BOT = `${HOME}/.cairn/tools/app-token/as-bot.sh`;
const STATE = `${HOME}/.local/state/review-gate`;
const EXTRA_PROTECTED = [/^docs\/spec\//, /^integration\/eval\//, /merge-gate/, /baseline/];
const globToRe = (g) =>
  new RegExp(
    `^${g
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*\//g, '\uE000')
      .replace(/\*\*/g, '\uE001')
      .replace(/\*/g, '[^/]*')
      .replace(/\uE000/g, '(?:.*/)?')
      .replace(/\uE001/g, '.*')}$`,
  );
const repoGatePaths = () =>
  JSON.parse(
    execFileSync('git', ['show', 'origin/main:packages/shared/merge-gate-paths.json'], {
      cwd: MAIN,
      encoding: 'utf8',
    }),
  );
const repoProtected = (gatePaths) => gatePaths.protected.map(globToRe);

mkdirSync(`${STATE}/runs`, { recursive: true });
mkdirSync(`${STATE}/disarmed`, { recursive: true });
const record = (pr, fields) => {
  appendFileSync(
    `${STATE}/runs.jsonl`,
    `${JSON.stringify({ at: new Date().toISOString(), pr: pr.number, sha: pr.headRefOid, ...fields })}\n`,
  );
};

const gh = (args) =>
  execFileSync('gh', ['-R', REPO, ...args], { encoding: 'utf8', maxBuffer: 64 << 20 });
const asBot = (args, input) =>
  execFileSync(BOT, args, { encoding: 'utf8', input, cwd: MAIN, maxBuffer: 64 << 20 });
const comment = (pr, body) =>
  asBot(['gh', 'pr', 'comment', String(pr.number), '-R', REPO, '--body-file', '-'], body).match(
    /^https:\/\/github\.com\/\S+#issuecomment-\d+$/m,
  )?.[0];

const GATE_LOGIN = 'cairnwright';
mkdirSync(`${STATE}/status`, { recursive: true });
const statusFile = (pr) => `${STATE}/status/${pr.number}`;
const publishedStatus = (pr) => {
  try {
    return readFileSync(statusFile(pr), 'utf8');
  } catch {
    return '';
  }
};
const publishStatus = (pr, state, description, url) => {
  const sha = pr.headRefOid;
  const key = `${sha} ${state} ${description}`;
  if (!/^[0-9a-f]{40}$/.test(sha) || publishedStatus(pr) === key) return;
  try {
    execFileSync(
      'gh',
      [
        'api',
        '--method',
        'POST',
        `repos/${REPO}/statuses/${sha}`,
        '-f',
        `state=${state}`,
        '-f',
        'context=review-gate',
        '-f',
        `description=${description}`,
        ...(url ? ['-f', `target_url=${url}`] : []),
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (e) {
    console.log(
      `#${pr.number}: review-gate status ${state} failed; retrying next round\n${e.message}`,
    );
    return;
  }
  writeFileSync(statusFile(pr), key);
  record(pr, { action: 'status', state });
};
const verdictStatus = (body, sha) => {
  const m = new RegExp(
    `^<!-- review-gate:${sha} -->\\n\\*\\*Independent review gate: (PASS|BLOCK)\\*\\*( \\(carried over\\))? for `,
  ).exec(body);
  if (!m) return null;
  const short = sha.slice(0, 8);
  if (m[1] === 'BLOCK')
    return { state: 'failure', description: `BLOCK for ${short}; see the review comment` };
  const from = m[2] && body.match(/the reviewed head `([0-9a-f]{8})`/)?.[1];
  const lowRisk = !m[2] && body.split('\n')[1].includes(`\`${short}\` (low-risk tier):`);
  return {
    state: 'success',
    description: from
      ? `PASS (carried over from ${from})`
      : lowRisk
        ? 'PASS (low-risk tier)'
        : `PASS for ${short}`,
  };
};
const publishVerdict = (pr, body, url) => {
  const status = verdictStatus(body, pr.headRefOid);
  if (status) publishStatus(pr, status.state, status.description, url);
};
const clearStall = (pr) => {
  if (!pr.labels.some((l) => l.name === 'review-stalled')) return;
  try {
    asBot(['gh', 'pr', 'edit', String(pr.number), '-R', REPO, '--remove-label', 'review-stalled']);
  } catch {}
};

const git = (args) =>
  execFileSync('git', args, {
    cwd: MAIN,
    encoding: 'utf8',
    maxBuffer: 64 << 20,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
const tryGit = (args) => {
  try {
    return git(args);
  } catch {
    return null;
  }
};
const ownDiff = (ref, args) => {
  const base = tryGit(['merge-base', 'origin/main', ref])?.trim();
  return base
    ? tryGit(['diff', '--no-color', '--no-ext-diff', '--no-renames', ...args, base, ref])
    : null;
};
const ownDigest = (ref) => {
  const diff = ownDiff(ref, ['--no-textconv', '--binary', '-U0']);
  return diff === null ? null : diffDigest(diff);
};
const ownPaths = (ref) => (ownDiff(ref, ['--name-only', '-z']) ?? '').split('\0').filter(Boolean);
const writeSince = (from, head, file) => {
  const paths = [...new Set([...ownPaths(from), ...ownPaths(head)])];
  const since = paths.length
    ? tryGit([
        'diff',
        '--no-color',
        '--no-ext-diff',
        from,
        head,
        '--',
        ...paths.map((p) => `:(literal)${p}`),
      ])
    : '';
  if (since === null) return false;
  try {
    writeFileSync(file, since);
    return true;
  } catch {
    return false;
  }
};
const cleanMerge = (sha) => {
  const parents = (tryGit(['rev-list', '--parents', '-n', '1', sha]) ?? '')
    .trim()
    .split(' ')
    .slice(1);
  if (parents.length !== 2) return false;
  const tree = tryGit(['merge-tree', '--write-tree', ...parents])?.split('\n')[0];
  return Boolean(tree) && tree === tryGit(['rev-parse', `${sha}^{tree}`])?.trim();
};
const mergeOnlyFrom = (head, verdicts) => {
  const last = verdicts.at(-1);
  if (last?.verdict !== 'PASS') return null;
  if (tryGit(['merge-base', '--is-ancestor', last.sha, head]) === null) return null;
  const range = [`${last.sha}..${head}`, '--not', 'origin/main'];
  if (tryGit(['rev-list', '--no-merges', ...range]) !== '') return null;
  const merges = (tryGit(['rev-list', '--merges', ...range]) ?? '').split('\n').filter(Boolean);
  if (!merges.length || !merges.every(cleanMerge)) return null;
  const digest = ownDigest(head);
  return digest && digest === ownDigest(last.sha) ? last.sha : null;
};
const reachable = (sha) => {
  if (tryGit(['cat-file', '-e', `${sha}^{commit}`]) !== null) return true;
  try {
    execFileSync(BOT, ['git', 'fetch', '-q', 'origin', sha], { cwd: MAIN, stdio: 'ignore' });
  } catch {}
  return tryGit(['cat-file', '-e', `${sha}^{commit}`]) !== null;
};

const handToHuman = (pr, comments, { addLabel, comment: due }) => {
  if (addLabel)
    try {
      asBot(['gh', 'pr', 'edit', String(pr.number), '-R', REPO, '--add-label', HUMAN_LABEL]);
      record(pr, { action: 'human-label' });
    } catch (e) {
      console.log(`#${pr.number}: ${HUMAN_LABEL} label failed; retrying next round\n${e.message}`);
      return;
    }
  let url = comments.filter((c) => c.body.startsWith(HUMAN_MARKER)).at(-1)?.url;
  if (due)
    try {
      url = comment(
        pr,
        `${HUMAN_MARKER}${pr.headRefOid} -->\n**Independent review gate: needs a human after ${BLOCK_ROUNDS} BLOCK rounds** for \`${pr.headRefOid.slice(0, 8)}\`. The gate stops reviewing this PR; remove the \`${HUMAN_LABEL}\` label to give it ${BLOCK_ROUNDS} more rounds.`,
      );
      record(pr, { action: 'human' });
    } catch (e) {
      console.log(`#${pr.number}: needs-a-human comment failed; retrying next round\n${e.message}`);
      return;
    }
  publishStatus(pr, 'failure', `${BLOCK_ROUNDS} BLOCK rounds; needs a human`, url);
  console.log(`#${pr.number}: ${BLOCK_ROUNDS} BLOCK rounds; waiting for a human`);
};

const disarmedFile = (pr) => `${STATE}/disarmed/${pr.number}`;
const disarm = (pr) => {
  const armed = pr.autoMergeRequest;
  const method = armed && !armed.enabledBy?.login?.endsWith('[bot]') ? armed.mergeMethod : null;
  if (method) writeFileSync(disarmedFile(pr), method.toLowerCase());
  try {
    asBot(['gh', 'pr', 'merge', String(pr.number), '-R', REPO, '--disable-auto']);
  } catch {}
};
const rearm = (pr) => {
  let method;
  try {
    method = readFileSync(disarmedFile(pr), 'utf8').trim();
  } catch {
    return;
  }
  try {
    gh(['pr', 'merge', String(pr.number), '--auto', `--${method}`]);
  } catch (e) {
    console.log(`#${pr.number}: re-arming auto-merge failed; retrying next round\n${e.message}`);
    return;
  }
  rmSync(disarmedFile(pr));
  record(pr, { action: 'rearmed', method });
  console.log(`#${pr.number}: re-armed auto-merge (${method}) that the gate had disarmed`);
};
const passedFor = (body, sha) =>
  new RegExp(
    `^<!-- review-gate:${sha} -->\\n\\*\\*Independent review gate: PASS\\*\\*(?: \\(carried over\\))? for `,
  ).test(body);

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
      'number,isDraft,headRefOid,headRefName,files,title,labels,autoMergeRequest',
    ]),
  );
  execFileSync(BOT, ['git', 'fetch', '-q', 'origin', 'main'], { cwd: MAIN });
  const gatePaths = repoGatePaths();
  const PROTECTED = [...repoProtected(gatePaths), ...EXTRA_PROTECTED];
  const checkIdx = process.argv.indexOf('--check');
  if (checkIdx > 0) {
    const files = JSON.parse(
      gh(['pr', 'view', process.argv[checkIdx + 1], '--json', 'files']),
    ).files.map((f) => f.path);
    if (!files.length) process.exit(2);
    process.exit(files.some((p) => PROTECTED.some((re) => re.test(p))) ? 0 : 3);
  }
  const todo = [];
  for (const pr of prs) {
    if (pr.isDraft) continue;
    const touched = pr.files.map((f) => f.path).filter((p) => PROTECTED.some((re) => re.test(p)));
    const optIn = pr.labels.some((l) => l.name === 'review-gate');
    const lane = pr.headRefName.match(/^lane\/(\d+)$/)?.[1];
    if (!touched.length && !optIn && !lane) continue;
    if (!touched.length)
      touched.push(
        lane ? '(none; every lane PR is reviewed)' : '(opted in with the review-gate label)',
      );
    const marker = `<!-- review-gate:${pr.headRefOid} -->`;
    const comments = JSON.parse(
      gh(['pr', 'view', String(pr.number), '--json', 'comments']),
    ).comments.filter((c) => c.author?.login === GATE_LOGIN);
    const handOff = escalation(comments, pr.labels);
    if (handOff) {
      handToHuman(pr, comments, handOff);
      continue;
    }
    if (comments.some((c) => c.body.includes(marker))) {
      if (comments.some((c) => passedFor(c.body, pr.headRefOid))) rearm(pr);
      const verdict = comments.filter((c) => verdictStatus(c.body, pr.headRefOid)).at(-1);
      if (verdict) publishVerdict(pr, verdict.body, verdict.url);
      continue;
    }
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
    const fetched = execFileSync('git', ['rev-parse', `review-gate-${pr.number}`], {
      cwd: MAIN,
      encoding: 'utf8',
    }).trim();
    if (fetched !== pr.headRefOid) {
      console.log(
        `#${pr.number}: head moved from ${pr.headRefOid.slice(0, 8)} to ${fetched.slice(0, 8)}; reviewing next round`,
      );
      continue;
    }
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
          /^<!-- review-gate:[0-9a-f]{40} -->\n\*\*Independent review gate: PASS\*\*(?: \(carried over\))? for /.test(
            c.body,
          ),
      );
    const head = `review-gate-${pr.number}`;
    const verdicts = gateVerdicts(comments);
    const short = pr.headRefOid.slice(0, 8);
    const pass = (headline, fields, why) => {
      const body = `${marker}\n**Independent review gate: PASS** ${headline}\n<!-- review-gate-patch:${patch} -->`;
      const url = comment(pr, body);
      record(pr, { verdict: 'pass', ...fields });
      publishVerdict(pr, body, url);
      clearStall(pr);
      rearm(pr);
      console.log(`#${pr.number}: PASS ${why}`);
    };
    const mergedFrom = prior ? null : mergeOnlyFrom(head, verdicts);
    if (prior || mergedFrom) {
      const from = mergedFrom ?? prior.body.match(/review-gate:([0-9a-f]{40})/)?.[1] ?? '?';
      pass(
        mergedFrom
          ? `(carried over) for \`${short}\`: the reviewed head \`${from.slice(0, 8)}\` only merged main; its own diff against main is unchanged.`
          : `(carried over) for \`${short}\`: same patch as the reviewed head \`${from.slice(0, 8)}\`; only the base moved.`,
        { action: 'carried-over', from, ...(mergedFrom ? { mergeOnly: true } : {}) },
        `carried over from ${from.slice(0, 8)} (${mergedFrom ? 'only merged main' : 'patch unchanged'})`,
      );
      continue;
    }
    const blocks = verdicts.filter((v) => v.verdict === 'BLOCK');
    const changes = parseRawDiff(
      tryGit(['diff', '--raw', '-z', '--no-renames', '--no-abbrev', `origin/main...${head}`]) ?? '',
    );
    if (!blocks.length && lowRiskTier(changes, PROTECTED)) {
      pass(
        `for \`${short}\` (low-risk tier): every changed file is docs, tests or locale strings, and none is protected.`,
        { action: 'low-risk' },
        'low-risk tier',
      );
      continue;
    }
    const reviewed = blocks.length && verdicts.at(-1).sha;
    const sinceFile = tryGit(['rev-parse', '--git-path', `${head}-since.diff`])?.trim();
    const incremental =
      Boolean(reviewed) &&
      Boolean(sinceFile) &&
      reachable(reviewed) &&
      tryGit(['update-ref', `refs/heads/${head}-reviewed`, reviewed]) !== null &&
      writeSince(reviewed, head, resolvePath(MAIN, sinceFile));
    const pendingMarker = `<!-- review-gate-pending:${pr.headRefOid} -->`;
    const pendingNoted = comments.some((c) => c.body.includes(pendingMarker));
    const stallNoted = comments.some((c) =>
      c.body.includes(`<!-- review-gate-stalled:${pr.headRefOid} -->`),
    );
    todo.push({
      ...pr,
      touched,
      marker,
      patch,
      lane,
      findings: blocks.length ? priorFindings(blocks) : null,
      reviewed: incremental ? reviewed : null,
      sinceFile,
      pendingMarker,
      pendingNoted,
      stallNoted,
    });
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
      return readFileSync(`${HOME}/.local/state/ai-route/runs.jsonl`, 'utf8')
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
  const sizeLine = (pr) =>
    sizeFactsLine(
      sizeFacts(
        execFileSync(
          'git',
          [
            'diff',
            '--no-renames',
            '--numstat',
            `origin/main...review-gate-${pr.number}`,
            '--',
            '.',
            ':(exclude)docs/verify',
          ],
          { cwd: MAIN, encoding: 'utf8', maxBuffer: 64 << 20 },
        ),
        gatePaths.limits,
      ),
    );
  const runReview = (pr, slot) =>
    new Promise((resolve) => {
      const prompt = `${readFileSync(new URL('./prompt.txt', import.meta.url), 'utf8')}

  PR: #${pr.number} ${pr.title}
  Review: \`git diff origin/main...review-gate-${pr.number}\` in this checkout (do not check anything out), plus \`gh pr view ${pr.number} --json title,body\`.
${
  pr.findings
    ? `
  Earlier rounds of this gate blocked this PR with the findings below. Never repeat an already-reported finding unless it is still unfixed; then report it once more, marked "still unfixed", with its current file:line. Do not list fixed findings.
${
  pr.reviewed
    ? `  Judge ONLY the changes since the last reviewed head \`${pr.reviewed.slice(0, 8)}\` (local branch \`review-gate-${pr.number}-reviewed\`): read \`${pr.sinceFile}\` in this checkout, the diff from that head to this one over every file this PR changes now or changed then. Lines that main brought in through a merge are not this PR's. Use the full diff for context only, and raise no new finding about code that did not change since \`${pr.reviewed.slice(0, 8)}\`. Block only if an earlier blocking finding is still unfixed or the changes since \`${pr.reviewed.slice(0, 8)}\` introduce a blocking bug.`
    : '  The last reviewed head is no longer available, so review the full diff.'
}

  Earlier findings:
  ${pr.findings}
`
    : ''
}
  ${sizeLine(pr)}
  Protected paths touched: ${pr.touched.join(', ')}`;
      const tierEnv = pr.lane
        ? Object.fromEntries(
            execFileSync(`${HOME}/.cairn/tools/governor/tier.sh`, ['env', pr.lane, 'review'], {
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
      const reviewWith = (command, args, done, input) => {
        const child = spawn(command, args, { env, cwd: MAIN });
        child.stdin.on('error', () => {});
        child.stdin.end(input ?? '');
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => (stdout += d));
        child.stderr.on('data', (d) => (stderr += d));
        child.on('error', (e) => (stderr += e.message));
        const timer = setTimeout(() => child.kill('SIGKILL'), 3600_000);
        child.on('close', (status) => {
          clearTimeout(timer);
          done({ status, stdout, stderr, excluded: Boolean(av), authorVendor: av });
        });
      };
      reviewWith('ai-route', ['run', 'review', '--hard', '-C', MAIN, prompt], (routed) => {
        if (!claudeFallback(av, routed)) return resolve(routed);
        console.log(`#${pr.number}: no usable cross-vendor model; reviewing with Claude`);
        let input;
        try {
          const diff = execFileSync(
            'git',
            ['diff', `origin/main...review-gate-${pr.number}`, ...CLAUDE_DIFF_PATHSPEC],
            {
              cwd: MAIN,
              encoding: 'utf8',
              maxBuffer: 64 << 20,
            },
          );
          const { title, body } = JSON.parse(
            gh(['pr', 'view', String(pr.number), '--json', 'title,body']),
          );
          input = claudeReviewPrompt(prompt, { diff, title, body });
          if (input === null)
            return resolve({
              ...routed,
              stderr: `${routed.stderr}\nclaude fallback: diff of ${diff.length} characters exceeds ${DIFF_LIMIT}; no partial review`,
            });
          if (pr.reviewed) {
            const from = pr.reviewed.slice(0, 8);
            const since = readFileSync(resolvePath(MAIN, pr.sinceFile), 'utf8');
            input +=
              diff.length + since.length > DIFF_LIMIT
                ? `\n\nThe changes since \`${from}\` are too large to show separately; review the full diff.`
                : `\n\nChanges since \`${from}\` in this PR's files:\n\`\`\`diff\n${since}\n\`\`\``;
          }
        } catch (e) {
          return resolve({ ...routed, stderr: `${routed.stderr}\nclaude fallback: ${e.message}` });
        }
        reviewWith(
          'claude',
          claudeReviewArgs(),
          (fallback) => resolve({ ...fallback, reviewer: 'claude' }),
          input,
        );
      });
    });
  const alertIfStalled = (pr) => {
    const labelled = pr.labels.some((l) => l.name === 'review-stalled');
    if (pr.stallNoted && labelled) return;
    let records;
    try {
      records = parseRuns(readFileSync(`${STATE}/runs.jsonl`, 'utf8'));
    } catch {
      return;
    }
    const since = stalled(records, pr.number, pr.headRefOid, Date.now());
    if (!since) return;
    if (!pr.stallNoted)
      try {
        const url = comment(pr, stallAlert(pr, since));
        record(pr, { action: 'stall-alert', since });
        publishStatus(
          pr,
          'pending',
          `No verdict for over an hour on ${pr.headRefOid.slice(0, 8)}`,
          url,
        );
      } catch (e) {
        console.log(`#${pr.number}: stall comment failed; retrying next round\n${e.message}`);
      }
    if (!labelled)
      try {
        asBot(['gh', 'pr', 'edit', String(pr.number), '-R', REPO, '--add-label', 'review-stalled']);
        record(pr, { action: 'stall-label', since });
      } catch (e) {
        console.log(
          `#${pr.number}: review-stalled label failed; retrying next round\n${e.message}`,
        );
      }
  };
  const finish = (pr, run) => {
    const out = run.stdout;
    const { verdict, review } = finalVerdict(out);
    const rawFile = `${STATE}/runs/${pr.number}-${pr.headRefOid.slice(0, 12)}.out`;
    writeFileSync(rawFile, out);
    record(pr, {
      verdict: verdict ?? null,
      action: verdict === 'pass' ? 'auto-merge' : 'auto-merge-off',
      rc: run.status,
      raw: rawFile,
      reviewChars: (review ?? '').length,
      ...(run.reviewer ? { reviewer: run.reviewer } : {}),
    });
    if (!verdict) {
      console.log(
        `no verdict for #${pr.number}${run.reviewer ? ` (${run.reviewer})` : ''}; rc=${run.status}\n${(run.stderr || run.stdout).slice(-800)}`,
      );
      if (pr.autoMergeRequest && !pr.pendingNoted) {
        try {
          const url = comment(
            pr,
            `${pr.pendingMarker}\n**Independent review gate: no verdict yet** for \`${pr.headRefOid.slice(0, 8)}\`: the reviewer run ended without a verdict, so auto-merge is paused. The gate retries on its next round and re-arms auto-merge once a later run passes.`,
          );
          publishStatus(pr, 'pending', `No verdict yet for ${pr.headRefOid.slice(0, 8)}`, url);
        } catch {}
      }
      disarm(pr);
      alertIfStalled(pr);
      return roundStops(run) ? 'no-model' : 'none';
    }
    const reviewer =
      run.reviewer === 'claude'
        ? ` (reviewer: Claude (opus), ${run.authorVendor ? `author vendor ${run.authorVendor} excluded` : 'author vendor unknown, same-vendor review possible'})`
        : '';
    const body =
      verdict === 'pass'
        ? `${pr.marker}\n**Independent review gate: PASS** for \`${pr.headRefOid.slice(0, 8)}\`${reviewer}.\n<!-- review-gate-patch:${pr.patch} -->`
        : `${pr.marker}\n**Independent review gate: BLOCK** for \`${pr.headRefOid.slice(0, 8)}\`${reviewer}.\n\n${review}\n<!-- review-gate-patch:${pr.patch} -->`;
    const url = comment(pr, body);
    publishVerdict(pr, body, url);
    clearStall(pr);
    if (verdict === 'pass') rearm(pr);
    else disarm(pr);
    console.log(`#${pr.number}: ${verdict}`);
    return verdict;
  };
  let next = 0;
  let stop = false;
  const worker = async (slot) => {
    while (!stop && next < todo.length) {
      const pr = todo[next++];
      if (!publishedStatus(pr).startsWith(`${pr.headRefOid} `))
        publishStatus(pr, 'pending', `Reviewing ${pr.headRefOid.slice(0, 8)}`);
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
