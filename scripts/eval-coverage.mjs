import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const VARIANT_NAME = /^(baseline|v[1-9]\d*)$/;

export function parseCapabilities(text) {
  const data = JSON.parse(text);
  if (!Array.isArray(data)) throw new Error('eval capabilities must be an array');
  const names = new Set();
  return data.map((entry, index) => {
    if (!entry || typeof entry.capability !== 'string' || !entry.capability.trim()) {
      throw new Error(`eval capabilities[${index}] needs a capability name`);
    }
    if (names.has(entry.capability)) throw new Error(`duplicate capability "${entry.capability}"`);
    names.add(entry.capability);
    const testsOnly = entry.testsOnly === true;
    if (entry.testsOnly !== undefined && entry.testsOnly !== true) {
      throw new Error(`eval capabilities[${index}] testsOnly must be true`);
    }
    const flow = typeof entry.flow === 'string' ? entry.flow : '';
    const ticket = entry.ticket ?? null;
    if (ticket !== null && (!Number.isInteger(ticket) || ticket <= 0)) {
      throw new Error(`eval capabilities[${index}] ticket must be a positive integer`);
    }
    if (testsOnly && (flow || ticket !== null)) {
      throw new Error(`eval capabilities[${index}] testsOnly cannot name a flow or a ticket`);
    }
    return { capability: entry.capability, flow, ticket, testsOnly };
  });
}

export function loadEvalCoverage({ capabilities, hillclimbDir, dateOf }) {
  const onDisk = existsSync(hillclimbDir)
    ? readdirSync(hillclimbDir, { withFileTypes: true })
        .filter(
          (entry) =>
            entry.isDirectory() && existsSync(join(hillclimbDir, entry.name, 'cases.json')),
        )
        .map((entry) => entry.name)
        .sort()
    : [];
  const named = new Set(capabilities.map((entry) => entry.flow).filter(Boolean));
  const unlisted = onDisk.filter((name) => !named.has(name));
  const rows = capabilities.map((raw) => {
    const entry = { ...raw, flow: raw.flow ?? '', ticket: raw.ticket ?? null };
    const row = {
      capability: entry.capability,
      flow: entry.flow,
      cases: '',
      score: '',
      date: '',
      model: '',
      status: entry.testsOnly ? 'tests only, no eval needed' : 'none',
      ticket: entry.ticket,
    };
    if (entry.testsOnly || !entry.flow) return row;
    const flowDir = join(hillclimbDir, entry.flow);
    const casesPath = join(flowDir, 'cases.json');
    if (!existsSync(casesPath)) return row;
    const cases = JSON.parse(readFileSync(casesPath, 'utf8'));
    if (!Array.isArray(cases.cases)) throw new Error(`${casesPath} has no cases array`);
    const count = String(cases.cases.length);
    const statePath = join(flowDir, '_state.json');
    const declared = existsSync(statePath)
      ? JSON.parse(readFileSync(statePath, 'utf8'))?.metrics?.[0]?.id
      : '';
    const metric = typeof declared === 'string' && declared ? declared : 'decision_ok';
    const variants = [];
    for (const variant of readdirSync(flowDir, { withFileTypes: true })) {
      if (!variant.isDirectory() || !VARIANT_NAME.test(variant.name)) continue;
      const resultsPath = join(flowDir, variant.name, 'results.jsonl');
      if (!existsSync(resultsPath)) continue;
      const values = [];
      const models = [];
      for (const line of readFileSync(resultsPath, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        let result;
        try {
          result = JSON.parse(line);
        } catch {
          continue;
        }
        const value = result?.grade?.[metric];
        if (typeof value !== 'number' || !Number.isFinite(value)) continue;
        values.push(value);
        if (typeof result.model === 'string' && result.model) models.push(result.model);
      }
      if (values.length === 0) continue;
      const binary = values.every((value) => value === 0 || value === 1);
      const passes = values.filter((value) => value === 1).length;
      variants.push({
        date: dateOf(resultsPath) || '',
        rank: variant.name === 'baseline' ? -1 : Number(variant.name.slice(1)),
        score: binary
          ? `${passes}/${values.length} (${((passes / values.length) * 100).toFixed(1)}%)`
          : (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(3),
        model: [...new Set(models)].sort().join(', '),
      });
    }
    variants.sort((a, b) => (a.date === b.date ? a.rank - b.rank : a.date < b.date ? -1 : 1));
    const latest = variants.at(-1);
    if (!latest) return { ...row, cases: count, status: 'built-not-run' };
    return {
      ...row,
      cases: count,
      score: latest.score,
      date: latest.date,
      model: latest.model,
      status: 'scored',
    };
  });
  return { rows, unlisted };
}

export function renderEvalCoverage(rows, repo) {
  const lines = [
    '## Eval coverage',
    '',
    'Model-driven capabilities and whether a real-model eval has a score.',
    'Case counts are the `cases` array in the flow `cases.json`.',
    'The latest score is the primary metric (the first id in `_state.json` `metrics`,',
    'otherwise `decision_ok`) over graded rows in the newest variant directory',
    '(`baseline`, then `v1`, `v2`, ...) that has a `results.jsonl`.',
    "The date is that file's git commit date.",
    'Status is `scored`, `built-not-run`, `none`, or `tests only, no eval needed`.',
    'A directory under `.claude/hillclimb/` that contains `cases.json` and is not named',
    'by a capability makes the generator fail.',
    '',
    '| Capability | Eval flow | Cases | Latest score | Date | Model | Status |',
    '|---|---|---|---|---|---|---|',
  ];
  for (const row of rows) {
    const flow = row.flow ? `\`${row.flow}\`` : '';
    const model = row.model
      ? row.model
          .split(', ')
          .map((name) => `\`${name}\``)
          .join(', ')
      : '';
    const status =
      row.status === 'none' && row.ticket
        ? `none ([#${row.ticket}](https://github.com/${repo}/issues/${row.ticket}))`
        : row.status;
    lines.push(
      `| ${row.capability} | ${flow} | ${row.cases} | ${row.score} | ${row.date} | ${model} | ${status} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

export function loadRepoEvalCoverage(repoRoot) {
  const capabilities = parseCapabilities(
    readFileSync(join(repoRoot, 'scripts/eval-capabilities.json'), 'utf8'),
  );
  return loadEvalCoverage({
    capabilities,
    hillclimbDir: join(repoRoot, '.claude/hillclimb'),
    dateOf: (file) => {
      try {
        const out = execFileSync('git', ['log', '-1', '--format=%cs', '--', file], {
          cwd: repoRoot,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        }).trim();
        return /^\d{4}-\d{2}-\d{2}$/.test(out) ? out : '';
      } catch {
        return '';
      }
    },
  });
}
