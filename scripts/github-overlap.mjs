import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { lookupOverlaps } from '../packages/shared/src/github-overlap.ts';

export { lookupOverlaps };

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
