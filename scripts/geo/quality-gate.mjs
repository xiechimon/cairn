import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import YAML from 'yaml';

const ALLOWED_TEMPLATES = new Set(['hub', 'qa', 'how-to', 'compare', 'troubleshoot']);
const ALLOWED_CAIRN_SUBCOMMANDS = new Set([
  'start',
  'supervise',
  'stop',
  'restart',
  'logs',
  'logout',
  'status',
  'token',
  'doctor',
  'version',
  'provider',
  'agent-config',
  'claude',
  'web-tools',
]);
const ALLOWED_NPX_PACKAGES = new Set(['@xiechimon/cairn', '@xiechimon/cairn-cli']);
const STATIC_ROUTES = new Set(['/', '/zh-cn/', '/robots.txt', '/llms.txt', '/sitemap-index.xml']);
const MIN_EN_WORDS = 150;
const MIN_ZH_CHARS = 260;
const MIN_EN_OPENING_WORDS = 18;
const MIN_ZH_OPENING_CHARS = 36;
const SIMILARITY_THRESHOLD = 0.55;
const CN_COMMUNITY_PATTERN = /(v2ex\.com|zhihu\.com|juejin\.cn|gitee\.com|bilibili\.com)/i;
const HAN_CHAR = /[\u4e00-\u9fff]/;
const EN_STOPWORDS = new Set([
  'how',
  'can',
  'does',
  'what',
  'when',
  'why',
  'where',
  'which',
  'with',
  'from',
  'your',
  'cairn',
  'that',
  'this',
  'into',
  'about',
  'without',
  'instead',
  'across',
  'using',
  'used',
]);

function walkMdx(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkMdx(full, out);
    else if (entry.name.endsWith('.mdx') || entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

function parseFrontmatter(raw) {
  const normalized = raw.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return { data: null, body: normalized };
  const end = normalized.indexOf('\n---\n', 4);
  if (end === -1) return { data: null, body: normalized };
  const data = YAML.parse(normalized.slice(4, end)) ?? {};
  const body = normalized.slice(end + 5);
  return { data, body };
}

function stripMdxNoise(body) {
  return body
    .replace(/^import\s+.+$/gm, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/Written with AI assistance from the Cairn source[^\n]*/gi, '')
    .replace(/\u7531\s*AI\s*\u57fa\u4e8e Cairn \u6e90\u7801[^\n]*/g, '')
    .trim();
}

function extractFirstProseParagraph(body) {
  const withoutImports = body.replace(/^import\s+.+$/gm, '').replace(/```[\s\S]*?```/g, '');
  const blocks = withoutImports
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(
      (block) =>
        block.length > 0 &&
        !block.startsWith('#') &&
        !block.startsWith('<') &&
        !block.startsWith('import ') &&
        !block.startsWith('|') &&
        !block.startsWith('- ') &&
        !block.startsWith('1. '),
    );
  return (blocks[0] ?? '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
}

function countWords(text) {
  const cleaned = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[^\p{L}\p{N}\s-]/gu, ' ');
  return cleaned.trim().split(/\s+/).filter(Boolean).length;
}

function countHanChars(text) {
  return (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
}

function buildShingles(text, locale) {
  const plain = stripMdxNoise(text)
    .toLowerCase()
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ');
  const shingles = new Set();
  if (locale === 'zh-cn') {
    const compact = plain.replace(/\s+/g, '');
    for (let i = 0; i <= compact.length - 4; i += 1) {
      shingles.add(compact.slice(i, i + 4));
    }
    return shingles;
  }
  const tokens = plain.split(/\s+/).filter(Boolean);
  for (let i = 0; i <= tokens.length - 4; i += 1) {
    shingles.add(tokens.slice(i, i + 4).join(' '));
  }
  return shingles;
}

function jaccardSimilarity(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function extractKeywords(text, locale) {
  if (locale === 'zh-cn') {
    const compact = text.replace(/[^\u4e00-\u9fffA-Za-z0-9]/g, '');
    const grams = new Set();
    for (let i = 0; i <= compact.length - 2; i += 1) {
      grams.add(compact.slice(i, i + 2).toLowerCase());
    }
    return [...grams];
  }
  return [
    ...new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 4 && !EN_STOPWORDS.has(w)),
    ),
  ];
}

function validateTopicAndJsonLd(data, body, questionRow, template, locale, relPath) {
  const errors = [];
  const qKeywords = extractKeywords(questionRow.question, locale);
  const openingParagraph = extractFirstProseParagraph(body);
  const firstSentence =
    openingParagraph.split(/(?<=[.!?。！？])\s+|(?<=[。！？])/)[0] ?? openingParagraph;
  const titleAndOpening = `${data.title} ${firstSentence}`.toLowerCase();
  const matched = qKeywords.filter((kw) => titleAndOpening.includes(kw));
  const minMatches = qKeywords.length >= 3 ? 2 : 1;
  if (qKeywords.length >= 2 && matched.length < minMatches) {
    errors.push(
      `${relPath}: title and opening answer do not address question topic "${questionRow.question}"`,
    );
  }

  const headEntries = Array.isArray(data.head) ? data.head : [];
  const ldEntry = headEntries.find(
    (item) => item?.tag === 'script' && item?.attrs?.type === 'application/ld+json',
  );
  if (!ldEntry || typeof ldEntry.content !== 'string') {
    errors.push(`${relPath}: missing application/ld+json structured data in head frontmatter`);
    return errors;
  }

  let parsedLd;
  try {
    parsedLd = JSON.parse(ldEntry.content);
  } catch {
    errors.push(`${relPath}: invalid JSON in application/ld+json`);
    return errors;
  }

  const expectedType = template === 'how-to' ? 'HowTo' : 'FAQPage';
  if (parsedLd['@type'] !== expectedType) {
    errors.push(`${relPath}: JSON-LD @type "${parsedLd['@type']}" must be "${expectedType}"`);
    return errors;
  }

  const bodyLower = stripMdxNoise(body).toLowerCase();
  const ldTexts =
    expectedType === 'HowTo'
      ? (parsedLd.step ?? []).map((s) => `${s?.name ?? ''} ${s?.text ?? ''}`)
      : (parsedLd.mainEntity ?? []).map((q) => `${q?.name ?? ''} ${q?.acceptedAnswer?.text ?? ''}`);
  if (ldTexts.length === 0) {
    errors.push(`${relPath}: JSON-LD contains no entries`);
    return errors;
  }

  const ldKeywords = extractKeywords(ldTexts.join(' '), locale);
  const ldMatches = ldKeywords.filter((kw) => bodyLower.includes(kw));
  const overlapRatio = ldKeywords.length === 0 ? 1 : ldMatches.length / ldKeywords.length;
  if (overlapRatio < 0.35) {
    errors.push(
      `${relPath}: JSON-LD text does not match visible page content (${ldMatches.length}/${ldKeywords.length} terms)`,
    );
  }
  return errors;
}

function collectKnownRoutes(siteDir) {
  const routes = new Set(STATIC_ROUTES);
  const docsRoot = join(siteDir, 'src/content/docs');
  for (const file of walkMdx(docsRoot)) {
    const rel = relative(docsRoot, file).split(sep).join('/');
    const noExt = rel.replace(/\.(mdx|md)$/, '');
    if (noExt === 'index') routes.add('/');
    else if (noExt.endsWith('/index')) routes.add(`/${noExt.slice(0, -6)}/`);
    else routes.add(`/${noExt}/`);
  }
  return routes;
}

function extractInternalLinks(body) {
  const links = [];
  const mdRx = /\]\((\/[^)\s#?]*)(?:[?#][^)\s]*)?\)/g;
  const hrefRx = /href=(?:"|')(\/[^"'#?]*)(?:[?#][^"']*)?(?:"|')/g;
  for (const match of body.matchAll(mdRx)) links.push(match[1]);
  for (const match of body.matchAll(hrefRx)) links.push(match[1]);
  return links;
}

function normalizeRoute(route) {
  if (
    route === '/' ||
    route === '/robots.txt' ||
    route === '/llms.txt' ||
    route === '/sitemap-index.xml'
  )
    return route;
  return route.endsWith('/') ? route : `${route}/`;
}

function extractCliViolations(body) {
  const errors = [];
  const checkLine = (rawLine) => {
    const line = rawLine.trim().replace(/^\$\s*/, '');
    const cairnMatch = /^cairn\s+([a-z0-9-]+)/.exec(line);
    if (cairnMatch && !ALLOWED_CAIRN_SUBCOMMANDS.has(cairnMatch[1])) {
      errors.push(`unknown cairn CLI subcommand "${cairnMatch[1]}"`);
    }
    const npxMatch = /^npx\s+(?:--yes\s+)?(@xiechimon\/[a-z0-9-]+)/.exec(line);
    if (npxMatch && !ALLOWED_NPX_PACKAGES.has(npxMatch[1])) {
      errors.push(`unknown npx package "${npxMatch[1]}"`);
    }
  };
  for (const fence of body.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) {
    for (const rawLine of fence[1].split('\n')) {
      checkLine(rawLine);
    }
  }
  const withoutFences = body.replace(/```[\s\S]*?```/g, '');
  for (const inline of withoutFences.matchAll(/`([^`\n]+)`/g)) {
    checkLine(inline[1]);
  }
  return [...new Set(errors)];
}

function checkPositioningAndClaims(text) {
  const errors = [];
  if (
    /npx\s+@xiechimon\/cairn\s+is\s+the\s+only\s+way|only\s+available\s+(?:via|through)\s+npx|install\s+via\s+npx\s+@xiechimon\/cairn\s+only/i.test(
      text,
    )
  ) {
    errors.push(
      'positioning violation: claims npx is the only installation path instead of Mac desktop app first',
    );
  }
  if (/cairn cloud is (?:available|live|shipped) today|sign up for cairn cloud/i.test(text)) {
    errors.push('ungrounded claim: Cairn Cloud is planned, not available today');
  }
  if (
    /mail,\s*calendar(?:,|\s+and)\s+job\s+search\s+are\s+(?:shipped|live|ready)\s+today/i.test(text)
  ) {
    errors.push('ungrounded claim: Mail, calendar, and job search are planned, not shipped today');
  }
  return errors;
}

function extractEvidenceTerms(text, locale) {
  const plain = stripMdxNoise(text)
    .toLowerCase()
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  if (locale === 'zh-cn') {
    return [
      ...new Set(
        (plain.match(/[a-z0-9][a-z0-9._-]{2,}/g) ?? []).filter((w) => !EN_STOPWORDS.has(w)),
      ),
    ];
  }
  return extractKeywords(plain, 'en');
}

function loadQuestions(questionsPath) {
  if (!existsSync(questionsPath)) return [];
  return readFileSync(questionsPath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function readFreezeState(siteDir) {
  const statePath = join(siteDir, 'geo/maintenance-state.json');
  if (!existsSync(statePath)) return null;
  return JSON.parse(readFileSync(statePath, 'utf8'));
}

export function validateGeoSite({
  repoRoot = process.cwd(),
  siteDir = join(repoRoot, 'site'),
} = {}) {
  const errors = [];
  const questionsPath = join(siteDir, 'geo/questions.jsonl');
  const questions = loadQuestions(questionsPath);
  const questionsById = new Map();
  const enQuestions = [];
  for (const row of questions) {
    if (questionsById.has(row.id)) {
      errors.push(`questions.jsonl: duplicate question id "${row.id}"`);
    }
    questionsById.set(row.id, row);
    if (row.locale === 'en') enQuestions.push(row);
  }

  const freezeState = readFreezeState(siteDir);
  const frozenIds =
    freezeState?.growthDecision === 'FREEZE_AND_AUDIT' &&
    Array.isArray(freezeState.frozenQuestionIds)
      ? new Set(freezeState.frozenQuestionIds)
      : null;

  const knownRoutes = collectKnownRoutes(siteDir);
  const guideFiles = [
    ...walkMdx(join(siteDir, 'src/content/docs/guides')),
    ...walkMdx(join(siteDir, 'src/content/docs/zh-cn/guides')),
  ].sort();

  const pageShingles = [];
  let checkedPages = 0;

  for (const file of guideFiles) {
    const relPath = relative(join(siteDir, 'src/content/docs'), file).split(sep).join('/');
    const isZh = relPath.startsWith('zh-cn/guides/');
    const locale = isZh ? 'zh-cn' : 'en';
    const raw = readFileSync(file, 'utf8');
    const { data, body } = parseFrontmatter(raw);
    if (!data || typeof data.title !== 'string' || typeof data.description !== 'string') {
      errors.push(`${relPath}: missing valid frontmatter title or description`);
      continue;
    }

    for (const link of extractInternalLinks(body)) {
      const normalized = normalizeRoute(link);
      if (!knownRoutes.has(normalized)) {
        errors.push(`${relPath}: dead internal link "${link}"`);
      }
    }
    for (const cliErr of extractCliViolations(body)) {
      errors.push(`${relPath}: ${cliErr}`);
    }
    for (const posErr of checkPositioningAndClaims(body)) {
      errors.push(`${relPath}: ${posErr}`);
    }

    if (basename(file) === 'index.mdx' || basename(file) === 'index.md') {
      continue;
    }

    checkedPages += 1;
    const slug = basename(file).replace(/\.(mdx|md)$/, '');

    if (data.title.length > 90 || data.title.includes(' | ') || /\s\/\s/.test(data.title)) {
      errors.push(`${relPath}: title looks keyword-stuffed or too long (${data.title})`);
    }

    const geo = data.geo;
    if (!geo || typeof geo !== 'object') {
      errors.push(`${relPath}: missing geo frontmatter metadata`);
      continue;
    }

    if (!ALLOWED_TEMPLATES.has(geo.template)) {
      errors.push(`${relPath}: invalid geo.template "${geo.template}"`);
    }

    if (frozenIds && !frozenIds.has(geo.questionId)) {
      errors.push(
        `${relPath}: growth is frozen (FREEZE_AND_AUDIT); new questionId "${geo.questionId}" is blocked`,
      );
    }

    const q = questionsById.get(geo.questionId);
    if (!q) {
      errors.push(
        `${relPath}: geo.questionId "${geo.questionId}" not found in site/geo/questions.jsonl`,
      );
    } else {
      if (q.slug !== slug || q.locale !== locale) {
        errors.push(
          `${relPath}: question row "${q.id}" mismatches slug (${q.slug}) or locale (${q.locale})`,
        );
      }
      if (q.template !== geo.template || q.cluster !== geo.cluster) {
        errors.push(
          `${relPath}: geo template/cluster (${geo.template}/${geo.cluster}) mismatches question row (${q.template}/${q.cluster})`,
        );
      }
      if (
        !Array.isArray(q.source_urls) ||
        q.source_urls.length === 0 ||
        q.source_urls.some((u) => !/^https?:\/\//.test(u))
      ) {
        errors.push(
          `${relPath}: question "${q.id}" requires at least one valid https:// source_urls entry`,
        );
      }
      if (isZh) {
        const hasCnSource = q.source_urls.some(
          (u) =>
            CN_COMMUNITY_PATTERN.test(u) ||
            (u.includes('github.com/xiechimon/cairn') && HAN_CHAR.test(q.question)),
        );
        if (!hasCnSource) {
          errors.push(`${relPath}: Chinese-community source_urls required for zh-cn guide`);
        }
        const sortedZhSources = [...q.source_urls].sort().join('\n');
        const matchingEnDup = enQuestions.some(
          (enRow) =>
            enRow.slug !== q.slug &&
            [...(enRow.source_urls ?? [])].sort().join('\n') === sortedZhSources,
        );
        if (matchingEnDup) {
          errors.push(
            `${relPath}: zh-cn guide with distinct slug cannot reuse identical source_urls from an English guide`,
          );
        }
      }
      for (const topicErr of validateTopicAndJsonLd(data, body, q, geo.template, locale, relPath)) {
        errors.push(topicErr);
      }
    }

    if (!Array.isArray(geo.sources) || geo.sources.length < 2) {
      errors.push(`${relPath}: geo.sources must cite at least 2 repo-relative paths`);
    } else {
      let combinedSourcesLower = '';
      for (const srcPath of geo.sources) {
        const absSrc = join(repoRoot, srcPath);
        if (!existsSync(absSrc)) {
          errors.push(`${relPath}: cited repo source "${srcPath}" does not exist`);
        } else {
          combinedSourcesLower += `\n${readFileSync(absSrc, 'utf8').toLowerCase()}`;
        }
      }
      if (combinedSourcesLower) {
        const bodyTerms = extractEvidenceTerms(body, locale);
        const overlappingTerms = bodyTerms.filter((term) => combinedSourcesLower.includes(term));
        if (overlappingTerms.length < 2) {
          errors.push(
            `${relPath}: cited geo.sources do not contain supporting evidence terms for this page`,
          );
        }
      }
    }

    if (!geo.verifiedVersion || !geo.verifiedDate) {
      errors.push(`${relPath}: geo.verifiedVersion and geo.verifiedDate are required`);
    } else {
      if (!/^desktop-v\d+\.\d+\.\d+$/.test(String(geo.verifiedVersion))) {
        errors.push(
          `${relPath}: geo.verifiedVersion "${geo.verifiedVersion}" must match desktop-v<semver>`,
        );
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(geo.verifiedDate))) {
        errors.push(`${relPath}: geo.verifiedDate "${geo.verifiedDate}" must match YYYY-MM-DD`);
      }
      if (!body.includes(String(geo.verifiedVersion)) || !body.includes(String(geo.verifiedDate))) {
        errors.push(
          `${relPath}: missing visible verification disclosure naming ${geo.verifiedVersion} and ${geo.verifiedDate}`,
        );
      }
    }

    const firstPara = extractFirstProseParagraph(body);
    const plainBody = stripMdxNoise(body);
    if (isZh) {
      if (!HAN_CHAR.test(data.title)) {
        errors.push(`${relPath}: zh-cn page title must be written in Chinese`);
      }
      if (countHanChars(firstPara) < MIN_ZH_OPENING_CHARS) {
        errors.push(`${relPath}: opening paragraph is too short for a direct answer`);
      }
      if (countHanChars(plainBody) < MIN_ZH_CHARS) {
        errors.push(
          `${relPath}: page is too thin (${countHanChars(plainBody)} Han chars < ${MIN_ZH_CHARS})`,
        );
      }
    } else {
      if (countWords(firstPara) < MIN_EN_OPENING_WORDS) {
        errors.push(`${relPath}: opening paragraph is too short for a direct answer`);
      }
      if (countWords(plainBody) < MIN_EN_WORDS) {
        errors.push(
          `${relPath}: page is too thin (${countWords(plainBody)} words < ${MIN_EN_WORDS})`,
        );
      }
    }

    if (geo.template === 'compare') {
      if (
        !Array.isArray(geo.competitorSources) ||
        geo.competitorSources.length === 0 ||
        geo.competitorSources.some(
          (c) => !c || !/^https?:\/\//.test(c.url) || !/^\d{4}-\d{2}-\d{2}$/.test(c.date),
        )
      ) {
        errors.push(
          `${relPath}: compare page requires dated competitorSources with url and YYYY-MM-DD date`,
        );
      }
      if (
        !/^#{2,3}\s+.*(?:is better|choose|alternative|better fit|\u66f4\u9002\u5408|\u4ec0\u4e48\u65f6\u5019\u9009)/im.test(
          body,
        )
      ) {
        errors.push(
          `${relPath}: compare page requires an explicit concession heading showing where the alternative is better`,
        );
      }
    }

    pageShingles.push({ relPath, locale, shingles: buildShingles(body, locale) });
  }

  for (let i = 0; i < pageShingles.length; i += 1) {
    for (let j = i + 1; j < pageShingles.length; j += 1) {
      const left = pageShingles[i];
      const right = pageShingles[j];
      if (left.locale !== right.locale) continue;
      const sim = jaccardSimilarity(left.shingles, right.shingles);
      if (sim >= SIMILARITY_THRESHOLD) {
        errors.push(
          `near-duplicate content (${sim.toFixed(2)} similarity >= ${SIMILARITY_THRESHOLD}): ${left.relPath} and ${right.relPath}`,
        );
      }
    }
  }

  return { ok: errors.length === 0, errors, checkedPages };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const repoRoot = resolve(import.meta.dirname, '../..');
  const result = validateGeoSite({ repoRoot });
  if (result.ok) {
    console.log(`[geo-quality-gate] PASS (${result.checkedPages} guide page(s) verified)`);
    process.exit(0);
  }
  for (const err of result.errors) {
    console.error(`[geo-quality-gate] FAIL: ${err}`);
  }
  console.error(
    `[geo-quality-gate] ${result.errors.length} violation(s) across ${result.checkedPages} page(s)`,
  );
  process.exit(1);
}
