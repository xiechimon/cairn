import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { issueFor, knownKeys, parseFindings, planIssues, SCAN_LABEL } from './findings.mjs';
import { countChanges, rankHotspots, sliceFor } from './hotspots.mjs';

export const SCAN_MODEL = 'claude-sonnet-5-5';
const HISTORY_DAYS = 90;
const promptPath = join(import.meta.dirname, 'prompt.md');

export async function runNightly({ date, changedFiles, lineCount, askAgent, gh, record }) {
  const changes = countChanges(changedFiles());
  const lineCounts = new Map([...changes.keys()].map((file) => [file, lineCount(file)]));
  const ranked = rankHotspots({ changes, lineCounts });
  const slice = sliceFor(ranked, date);
  const base = { at: new Date().toISOString(), date, slice };
  if (slice.length === 0) return record({ ...base, status: 'empty-slice' });

  const prompt = `${readFileSync(promptPath, 'utf8')}\nSlice:\n${slice.map((file) => `- ${file}`).join('\n')}\n`;
  const findings = parseFindings(await askAgent(prompt), slice);
  const known = knownKeys(
    JSON.parse(
      gh([
        'issue',
        'list',
        '--label',
        SCAN_LABEL,
        '--state',
        'all',
        '--limit',
        '100000',
        '--json',
        'body',
      ]),
    ).map((issue) => issue.body),
  );
  const plan = planIssues(findings, known);
  const created = [];
  for (const finding of plan.create) {
    const { title, body } = issueFor(finding);
    created.push(
      gh(['issue', 'create', '--title', title, '--body', body, '--label', SCAN_LABEL]).trim(),
    );
  }
  return record({
    ...base,
    status: 'ok',
    findings: findings.length,
    created,
    duplicates: plan.duplicates,
    deferred: plan.deferred.length,
  });
}

function main(argv, env) {
  const root = resolve(argv[0] ?? '.');
  const stateDir = env.NIGHTLY_SCAN_STATE ?? join(homedir(), '.local/state/cairn-nightly-scan');
  const git = (...args) =>
    execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const gh = (args) => execFileSync('gh', args, { cwd: root, encoding: 'utf8' });
  git('fetch', 'origin', 'main');
  git('checkout', '--detach', 'origin/main');
  try {
    gh([
      'label',
      'create',
      SCAN_LABEL,
      '--color',
      'BFD4F2',
      '--description',
      'Filed by the nightly whole-repo review scan',
    ]);
  } catch {}
  const askAgent = (prompt) => {
    const result = spawnSync(
      'claude',
      [
        '-p',
        '--model',
        SCAN_MODEL,
        '--tools',
        'Read',
        'Grep',
        'Glob',
        '--allowedTools',
        'Read',
        'Grep',
        'Glob',
        '--strict-mcp-config',
        '--no-session-persistence',
      ],
      {
        cwd: root,
        input: prompt,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        timeout: 30 * 60 * 1000,
      },
    );
    if (result.status !== 0) throw new Error(`claude exited ${result.status}: ${result.stderr}`);
    return result.stdout;
  };
  return runNightly({
    date: new Date().toISOString().slice(0, 10),
    changedFiles: () =>
      git('log', `--since=${HISTORY_DAYS}.days`, '--name-only', '--pretty=format:', 'origin/main'),
    lineCount: (file) => {
      try {
        return readFileSync(join(root, file), 'utf8').split('\n').length;
      } catch {
        return 0;
      }
    },
    askAgent,
    gh,
    record: (entry) => {
      const file = join(stateDir, 'runs.jsonl');
      mkdirSync(dirname(file), { recursive: true });
      appendFileSync(file, `${JSON.stringify(entry)}\n`);
      console.log(JSON.stringify(entry));
      return entry;
    },
  });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    await main(process.argv.slice(2), process.env);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
