import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const whereLabels = ['prompt', 'knowledge', 'runtime', 'config', 'infra', 'unknown'];
const whyLabels = [
  'premature_finish',
  'thinking_runaway',
  'wrong_tool',
  'ignored_instruction',
  'context_missing',
  'ci_misread',
  'other',
];

export function readLines(path) {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

export function stratify(items, count, seed) {
  const groups = new Map();
  for (const item of items) {
    const key = `${item.flow}/${item.failureClass}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const hash = (value) => createHash('sha256').update(`${seed}:${value}`).digest('hex');
  const buckets = [...groups]
    .sort(([a], [b]) => hash(a).localeCompare(hash(b)))
    .map(([, rows]) => rows.sort((a, b) => hash(a.id).localeCompare(hash(b.id))));
  const sample = [];
  while (sample.length < count && buckets.some((bucket) => bucket.length)) {
    for (const bucket of buckets) {
      if (bucket.length && sample.length < count) sample.push(bucket.shift());
    }
  }
  return sample;
}

export function agreement(pairs) {
  const n = pairs.length;
  if (!n) return { n: 0, agreement: null, kappa: null, interval95: null };
  const observed = pairs.filter(([a, b]) => a === b).length / n;
  const labels = new Set(pairs.flat());
  let expected = 0;
  for (const label of labels)
    expected +=
      (pairs.filter(([a]) => a === label).length * pairs.filter(([, b]) => b === label).length) /
      n ** 2;
  const z2 = 1.96 ** 2;
  const center = (observed + z2 / (2 * n)) / (1 + z2 / n);
  const radius =
    (1.96 * Math.sqrt((observed * (1 - observed)) / n + z2 / (4 * n ** 2))) / (1 + z2 / n);
  return {
    n,
    agreement: observed,
    kappa: expected === 1 ? null : (observed - expected) / (1 - expected),
    interval95: [Math.max(0, center - radius), Math.min(1, center + radius)],
  };
}

export function reportReviews(paths) {
  const pairs = { where: [], why: [] };
  const seen = new Map();
  const verdicts = { agent_mistake: 0, grader_bug: 0, unfair_task: 0 };
  const tickets = [];
  for (const path of paths) {
    const review = JSON.parse(readFileSync(path, 'utf8'));
    const key = JSON.parse(readFileSync(join(dirname(path), 'answer-key.json'), 'utf8'));
    for (const item of review.items) {
      if (item.verdict === null) continue;
      if (!(item.verdict in verdicts) || !item.note?.trim() || !item.reviewer?.trim())
        throw new Error(`Incomplete review: ${item.id}`);
      if (item.verdict !== 'agent_mistake') {
        if (!/^https:\/\/github.com\/xiechimon\/cairn\/issues\/\d+$/.test(item.issue ?? ''))
          throw new Error(`File an owning-flow issue for ${item.id} and record its URL`);
        tickets.push({ flow: item.flow, issue: item.issue });
      }
      const canonical = key[item.id];
      if (!canonical || canonical.sourceId !== item.sourceId || canonical.kind !== item.kind)
        throw new Error(`Unknown or changed review item: ${item.id}`);
      const fingerprint = JSON.stringify({
        verdict: item.verdict,
        hand: item.hand,
        model: canonical.model,
      });
      if (seen.has(canonical.identity)) {
        if (seen.get(canonical.identity) !== fingerprint)
          throw new Error(`Conflicting review: ${canonical.sourceId}`);
        continue;
      }
      seen.set(canonical.identity, fingerprint);
      verdicts[item.verdict]++;
      if (canonical.kind !== 'pack') continue;
      if (!whereLabels.includes(item.hand?.where) || !whyLabels.includes(item.hand?.why))
        throw new Error(`Invalid hand labels: ${item.id}`);
      for (const dimension of ['where', 'why'])
        pairs[dimension].push([canonical.model[dimension], item.hand[dimension]]);
    }
  }
  const where = agreement(pairs.where);
  return {
    verdicts,
    tickets,
    where,
    why: agreement(pairs.why),
    e3Eligible: where.n >= 30 && where.agreement >= 0.8,
    gate: 'E3 requires at least 30 distinct hand-labeled builds and where agreement >= 80%; this report does not enable E3 automatically.',
  };
}

export function sampleFailures({ week, flows, packs, count, out }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week) || Number.isNaN(Date.parse(week)))
    throw new Error('--week requires YYYY-MM-DD');
  if (!Number.isSafeInteger(count) || count < 1)
    throw new Error('--count must be a positive integer');
  if (existsSync(out)) throw new Error(`Review directory already exists: ${out}`);
  const trials = [];
  const traces = { hit: 0, miss: 0 };
  for (const flow of readdirSync(flows, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()) {
    const baseline = join(flows, flow, 'baseline');
    for (const name of ['results.jsonl', 'errors.jsonl']) {
      const source = join(baseline, name);
      if (!existsSync(source)) continue;
      for (const [index, row] of readLines(source).entries()) {
        const failed =
          name === 'errors.jsonl' ||
          Object.values(row.grade ?? {}).some((grade) => grade === 0 || grade === false);
        if (!failed) continue;
        const trace = join(baseline, 'traces', `${row.prompt_id}_rep${row.rep}.json`);
        const failureClass =
          name === 'errors.jsonl'
            ? (row.failure_class ?? 'error')
            : Object.entries(row.grade)
                .filter(([, grade]) => grade === 0 || grade === false)
                .map(([key]) => key)
                .sort()
                .join('+');
        const hasTrace = existsSync(trace);
        if (hasTrace) traces.hit += 1;
        else traces.miss += 1;
        trials.push({
          id: `trial:${flow}:${name}:${index}`,
          sourceId: `${row.prompt_id}:rep${row.rep}`,
          identity: `${resolve(source)}:${index}`,
          kind: 'trial',
          flow,
          failureClass,
          source: `${source}:${index + 1}`,
          content: hasTrace
            ? JSON.parse(readFileSync(trace, 'utf8'))
            : { transcriptMissing: true, trial: row },
        });
      }
    }
  }
  const builds = new Map();
  for (const path of packs) {
    for (const pack of readLines(path)) {
      const outcome = pack.outcome;
      if (
        !outcome ||
        !(
          outcome.merged === false ||
          outcome.revertedWithin7d === true ||
          outcome.fixedByLaterPr === true
        ) ||
        !pack.attribution
      )
        continue;
      if (
        !whereLabels.includes(pack.attribution.where) ||
        !whyLabels.includes(pack.attribution.why)
      )
        throw new Error(`Invalid attribution: ${pack.buildId}`);
      if (!pack.buildId || !Array.isArray(pack.process?.steps))
        throw new Error('Invalid trajectory pack');
      const previous = builds.get(pack.buildId);
      if (previous && JSON.stringify(previous.model) !== JSON.stringify(pack.attribution))
        throw new Error(`Conflicting attribution: ${pack.buildId}`);
      builds.set(pack.buildId, {
        id: `pack:${pack.buildId}`,
        sourceId: pack.buildId,
        identity: `pack:${pack.buildId}`,
        kind: 'pack',
        flow: 'builds',
        failureClass: `${pack.attribution.where}/${pack.attribution.why}`,
        model: pack.attribution,
        content: {
          buildId: pack.buildId,
          input: pack.input,
          process: pack.process,
          outcome: pack.outcome,
        },
      });
    }
  }
  const selected = [
    ...stratify(trials, count, week),
    ...stratify([...builds.values()], count, week),
  ];
  mkdirSync(join(out, 'transcripts'), { recursive: true });
  const key = {};
  const items = selected.map((item, index) => {
    const id = `item-${index + 1}`;
    const transcript = join(out, 'transcripts', `${id}.json`);
    writeFileSync(transcript, `${JSON.stringify(item.content, null, 2)}\n`);
    key[id] = {
      identity: item.identity,
      sourceId: item.sourceId,
      kind: item.kind,
      model: item.model,
      source: item.source,
      failureClass: item.failureClass,
    };
    return {
      id,
      kind: item.kind,
      sourceId: item.sourceId,
      flow: item.flow,
      transcript: relative(process.cwd(), transcript),
      verdict: null,
      hand: null,
      note: '',
      reviewer: '',
      issue: null,
    };
  });
  writeFileSync(join(out, 'answer-key.json'), `${JSON.stringify(key, null, 2)}\n`, { mode: 0o600 });
  const available = { trials: trials.length, packs: builds.size, traces };
  writeFileSync(
    join(out, 'review.json'),
    `${JSON.stringify({ week, available, sampled: { trials: Math.min(count, trials.length), packs: Math.min(count, builds.size) }, autonomousPrReviews: [], items }, null, 2)}\n`,
  );
  return { review: join(out, 'review.json'), items: items.length, available, traces };
}

const repositoryRoot = resolve(import.meta.dirname, '..');
const defaultFlowsDir = join(repositoryRoot, '.claude/hillclimb');

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  try {
    const { values } = parseArgs({
      options: {
        week: { type: 'string' },
        flows: { type: 'string' },
        packs: { type: 'string', multiple: true, default: [] },
        count: { type: 'string', default: '10' },
        out: { type: 'string' },
        report: { type: 'string', multiple: true },
      },
    });
    const flows = values.flows ? resolve(values.flows) : defaultFlowsDir;
    const result = values.report
      ? reportReviews(values.report)
      : sampleFailures({
          ...values,
          flows,
          count: Number(values.count),
          out: values.out ?? join(flows, 'reviews', values.week),
        });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`eval-sample-failures: ${error.message}`);
    process.exitCode = 1;
  }
}
