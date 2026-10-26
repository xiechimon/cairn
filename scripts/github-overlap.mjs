import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

export async function lookupOverlaps({ repo, terms, paths = [], request, now = new Date() }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Expected --repo owner/name');
  const words = [...new Set(terms.map((term) => term.trim()).filter(Boolean))];
  if (!words.length) throw new Error('At least one --term is required');
  if (paths.some((path) => typeof path !== 'string' || !path.trim()))
    throw new Error('Each planned path must be non-empty');
  const since = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10);
  const query = words.map((term) => `"${term.replace(/["\\]/g, ' ')}"`).join(' OR ');
  const search = async (scope) =>
    request(
      `search/issues?q=${encodeURIComponent(`repo:${repo} ${scope} in:title,body ${query}`)}&per_page=100`,
    );
  const openIssues = await search('is:issue is:open');
  const openPulls = await search('is:pr is:open');
  const recentPulls = await search(`is:pr is:merged merged:>=${since}`);
  const filePulls = [];
  if (paths.length) {
    const planned = new Set(paths.map((path) => path.replace(/^\.\//, '')));
    for (const pull of await request(`repos/${repo}/pulls?state=open&per_page=100`)) {
      const files = await request(`repos/${repo}/pulls/${pull.number}/files?per_page=100`);
      const overlappingFiles = files
        .filter((file) => planned.has(file.filename) || planned.has(file.previous_filename))
        .map((file) => file.filename);
      if (overlappingFiles.length) filePulls.push({ ...pull, overlappingFiles });
    }
  }
  return {
    repo,
    checkedAt: now.toISOString(),
    since,
    terms: words,
    paths,
    openIssues,
    openPulls,
    recentPulls,
    filePulls,
  };
}

export async function resolveOverlap({ report, sameAsk, kind, body, write }) {
  const candidates = [
    ...report.openIssues,
    ...report.openPulls,
    ...report.recentPulls,
    ...report.filePulls,
  ];
  if (!candidates.some((item) => item.number === sameAsk))
    throw new Error(`Same-ask #${sameAsk} is not in the overlap report`);
  if (!['issue', 'pull'].includes(kind)) throw new Error('Expected kind issue or pull');
  const result = await write(`issues/${sameAsk}/comments`, { body });
  return { action: 'extended', number: sameAsk, result };
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  try {
    const { values } = parseArgs({
      options: {
        repo: { type: 'string' },
        term: { type: 'string', multiple: true },
        file: { type: 'string', multiple: true },
        'same-ask': { type: 'string' },
        'body-file': { type: 'string' },
      },
    });
    const report = await lookupOverlaps({
      repo: values.repo,
      terms: values.term ?? [],
      paths: values.file ?? [],
      request: async (path) => {
        const pages = JSON.parse(
          execFileSync('gh', ['api', '--paginate', '--slurp', path], {
            encoding: 'utf8',
            maxBuffer: 64 * 1024 * 1024,
          }),
        );
        for (const page of pages) {
          if (!Array.isArray(page) && (page.incomplete_results || page.total_count > 1000))
            throw new Error('Incomplete GitHub search; narrow the terms and repeat');
          if (!Array.isArray(page) && !Array.isArray(page.items))
            throw new Error('Malformed GitHub overlap response');
        }
        return pages.flatMap((page) => (Array.isArray(page) ? page : page.items));
      },
    });
    console.log(JSON.stringify(report, null, 2));
    if (values['same-ask']) {
      if (!values['body-file']) throw new Error('--same-ask requires --body-file');
      const sameAsk = Number(values['same-ask']);
      if (!Number.isSafeInteger(sameAsk) || sameAsk < 1)
        throw new Error('Invalid --same-ask number');
      const result = await resolveOverlap({
        report,
        sameAsk,
        kind: 'issue',
        body: readFileSync(values['body-file'], 'utf8'),
        write: async (path, payload) =>
          JSON.parse(
            execFileSync(
              'gh',
              ['api', '-X', 'POST', `repos/${values.repo}/${path}`, '--input', '-'],
              { input: JSON.stringify(payload), encoding: 'utf8' },
            ),
          ),
      });
      console.log(JSON.stringify(result));
    }
  } catch (error) {
    console.error(`github-overlap: ${error.message}`);
    process.exitCode = 1;
  }
}
