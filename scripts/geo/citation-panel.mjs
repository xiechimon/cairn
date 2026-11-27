import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const MS_PER_DAY = 86_400_000;

export const FREE_ENGINES = [
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    url: 'https://chatgpt.com/',
    loginButton: 'Log in',
    webSearchNote: 'Enable Search / web search in composer',
    locales: ['en', 'zh-cn'],
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    url: 'https://www.perplexity.ai/',
    loginButton: 'Sign In',
    webSearchNote: 'Web search enabled by default with numbered citations',
    locales: ['en', 'zh-cn'],
  },
  {
    id: 'google-ai-overviews',
    name: 'Google AI Overviews',
    url: 'https://www.google.com/',
    loginButton: 'Sign in (optional; AI Overview / AI Mode)',
    webSearchNote: 'Search directly and inspect AI Overview / AI Mode citations',
    locales: ['en'],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    url: 'https://chat.deepseek.com/',
    loginButton: '\u767b\u5f55 / Log in',
    webSearchNote: '\u5f00\u542f\u300c\u8054\u7f51\u641c\u7d22\u300d',
    locales: ['zh-cn', 'en'],
  },
  {
    id: 'kimi',
    name: 'Kimi',
    url: 'https://www.kimi.com/',
    loginButton: '\u767b\u5f55',
    webSearchNote: '\u9ed8\u8ba4\u8054\u7f51\u641c\u7d22\u5e76\u9644\u5f15\u7528\u6765\u6e90',
    locales: ['zh-cn'],
  },
  {
    id: 'doubao',
    name: '\u8c46\u5305',
    url: 'https://www.doubao.com/',
    loginButton: '\u767b\u5f55',
    webSearchNote: '\u81ea\u52a8\u8054\u7f51\u68c0\u7d22\u5e76\u5c55\u793a\u53c2\u8003\u6765\u6e90',
    locales: ['zh-cn'],
  },
  {
    id: 'qwen',
    name: '\u901a\u4e49\u5343\u95ee',
    url: 'https://chat.qwen.ai/',
    loginButton: '\u767b\u5f55 / Sign in',
    webSearchNote:
      '\u5f00\u542f\u300c\u8054\u7f51\u641c\u7d22\u300d\u67e5\u770b\u5f15\u7528\u7f51\u9875',
    locales: ['zh-cn'],
  },
  {
    id: 'yuanbao',
    name: '\u817e\u8baf\u5143\u5b9d',
    url: 'https://yuanbao.tencent.com/',
    loginButton: '\u5fae\u4fe1 / QQ \u767b\u5f55',
    webSearchNote:
      '\u5f00\u542f\u300c\u8054\u7f51\u641c\u7d22\u300d\u67e5\u770b\u5f15\u7528\u6765\u6e90',
    locales: ['zh-cn'],
  },
];

export function validatePanelConfig(config) {
  if (config?.mode !== 'free_consumer_web_browser') {
    throw new Error('Citation panel mode must be free_consumer_web_browser');
  }
  if (config.paidApisAllowed !== false) {
    throw new Error('Paid citation APIs are forbidden by owner decision');
  }
  if (config.anthropicAllowed !== false) {
    throw new Error('Anthropic / Claude is excluded by owner decision');
  }
  if (!Array.isArray(config.engines) || config.engines.length === 0) {
    throw new Error('Citation panel requires at least one free engine');
  }
  for (const engine of config.engines) {
    if (/anthropic|claude/i.test(`${engine.id ?? ''} ${engine.name ?? ''} ${engine.url ?? ''}`)) {
      throw new Error(`Anthropic / Claude engine "${engine.id}" is excluded by owner decision`);
    }
    if (engine.mode && /api/i.test(engine.mode)) {
      throw new Error(`Engine "${engine.id}" cannot use paid API mode`);
    }
  }
  return { ok: true, engineCount: config.engines.length };
}

export function summarizePanelResults(rows) {
  const byEngine = {};
  const competitorCounts = {};
  let totalChecked = 0;
  let totalCited = 0;

  for (const row of rows) {
    if (!byEngine[row.engine]) {
      byEngine[row.engine] = { checked: 0, cited: 0, needsLogin: 0, blocked: 0 };
    }
    const bucket = byEngine[row.engine];
    if (row.status === 'checked') {
      bucket.checked += 1;
      totalChecked += 1;
      if (row.citedCairn) {
        bucket.cited += 1;
        totalCited += 1;
      }
      for (const domain of row.competitorDomains ?? []) {
        competitorCounts[domain] = (competitorCounts[domain] ?? 0) + 1;
      }
    } else if (row.status === 'needs_login') {
      bucket.needsLogin += 1;
    } else {
      bucket.blocked += 1;
    }
  }

  return {
    totalChecked,
    totalCited,
    citationRate: totalChecked === 0 ? 0 : totalCited / totalChecked,
    byEngine,
    competitorCounts,
  };
}

export function buildLoginChecklist(rows, engines = FREE_ENGINES) {
  const pendingEngines = new Set(
    rows.filter((r) => r.status === 'needs_login' || r.status === 'blocked').map((r) => r.engine),
  );
  return engines
    .filter((engine) => pendingEngines.has(engine.id))
    .map((engine) => ({
      id: engine.id,
      name: engine.name,
      url: engine.url,
      loginButton: engine.loginButton,
      webSearchNote: engine.webSearchNote,
    }));
}

export function readLatestPanelState(resultsDir, { now = new Date(), staleAfterDays = 14 } = {}) {
  if (!existsSync(resultsDir)) {
    return { rows: [], latestFile: null, stale: true, ageDays: null };
  }
  const files = readdirSync(resultsDir)
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name))
    .sort();
  if (files.length === 0) {
    return { rows: [], latestFile: null, stale: true, ageDays: null };
  }
  const latest = files.at(-1);
  const fileDateMs = new Date(latest.slice(0, 10)).getTime();
  const ageDays = Number.isNaN(fileDateMs)
    ? null
    : Math.floor((now.getTime() - fileDateMs) / MS_PER_DAY);
  const rows = readFileSync(join(resultsDir, latest), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, idx) => {
      try {
        return JSON.parse(line);
      } catch (err) {
        throw new Error(`${latest}:${idx + 1}: malformed panel JSONL (${err.message})`);
      }
    });
  return {
    rows,
    latestFile: latest,
    stale: ageDays === null || ageDays > staleAfterDays,
    ageDays,
  };
}

export function readLatestPanelRows(resultsDir) {
  return readLatestPanelState(resultsDir).rows;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const repoRoot = resolve(import.meta.dirname, '../..');
  const configPath = join(repoRoot, 'site/geo/panel-questions.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  validatePanelConfig(config);
  const argv = process.argv.slice(2);
  const dirIdx = argv.indexOf('--results-dir');
  const resultsDir =
    dirIdx !== -1 && argv[dirIdx + 1]
      ? resolve(argv[dirIdx + 1])
      : join(repoRoot, 'site/geo/panel-results');
  if (argv.includes('--init-blocked')) {
    const date = new Date().toISOString().slice(0, 10);
    mkdirSync(resultsDir, { recursive: true });
    const outPath = join(resultsDir, `${date}.jsonl`);
    const existingChecked = new Map();
    if (existsSync(outPath)) {
      for (const line of readFileSync(outPath, 'utf8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const row = JSON.parse(trimmed);
        if (row.status === 'checked' && row.engine) {
          existingChecked.set(`${row.engine}:${row.questionId}`, row);
        }
      }
    }
    const rows = [];
    for (const engine of config.engines) {
      const preserved = [...existingChecked.values()].filter((r) => r.engine === engine.id);
      if (preserved.length > 0) {
        rows.push(...preserved);
      } else {
        rows.push({
          date,
          engine: engine.id,
          questionId: config.questions[0]?.id ?? 'panel-en-01',
          status: 'blocked',
          blockReason: 'browsermcp_disconnected',
          citedCairn: false,
          cairnRank: null,
          citedUrls: [],
          competitorDomains: [],
        });
      }
    }
    writeFileSync(outPath, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
    console.log(`[citation-panel] wrote ${rows.length} baseline rows to ${outPath}`);
    process.exit(0);
  }
  const state = readLatestPanelState(resultsDir);
  const summary = summarizePanelResults(state.rows);
  const checklist = buildLoginChecklist(state.rows, config.engines);
  console.log(
    JSON.stringify(
      { latestFile: state.latestFile, stale: state.stale, summary, checklist },
      null,
      2,
    ),
  );
}
