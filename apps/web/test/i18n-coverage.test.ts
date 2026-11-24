import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import {
  AGENT_PERMISSION_COPY,
  AGENT_TOOL_COPY,
  AGENT_TOOL_SWITCHES,
  CHIEF_INPUT_PLACEHOLDER,
  CHIEF_INPUT_PLACEHOLDER_QUEUED,
  CHIEF_INPUT_PLACEHOLDER_STEERING,
  CHIEF_REBIND_CONFIRM_COPY,
  FS_PICK_ERROR_COPY,
  GATE_ANNOUNCEMENTS,
  LOCAL_ERROR_REASON_COPY,
  MCP_CATALOG,
  MEMORY_UI_COPY,
  NOTIFICATION_BANNER_COPY,
  SKILL_PAGE_COPY,
} from '@cairn/shared';
import { describe, expect, it } from 'vitest';
import { NOTIFICATION_TITLES } from '../src/api/sse.js';
import { PROBE_TOOL_CALL_LABEL } from '../src/fixtures/fixtures.js';
import { EN } from '../src/i18n/en.js';
import { translate } from '../src/i18n/translate.js';
import { scanFile } from './i18n-scan.js';

const SRC = resolve(import.meta.dirname, '../src');

/** CJK literals that deliberately stay out of the dict, keyed `rel::text`. */
const ALLOWLIST: Record<string, string> = {

  'i18n/locale.ts::简体中文': 'language endonym — identical in every locale by design',
  'chief/approval-card-model.ts::审批': 'matches the server-generated approval card text verbatim, not UI copy',
  'chief/approval-card-model.ts::对外发送：': 'matches the server-generated approval card text verbatim, not UI copy',
  'chief/approval-card-model.ts::参数': 'matches the server-generated approval card text verbatim, not UI copy',
  'chief/approval-card-model.ts::收件人': 'matches the server-generated approval card text verbatim, not UI copy',
  'chief/approval-card-model.ts::正文': 'matches the server-generated approval card text verbatim, not UI copy',
};

/** Latin strings allowed to reach the user without t(), keyed `rel::text`:
 *  brand and product names, glossary terms kept in English (CONTEXT.md),
 *  protocol/header literals and keycap labels — plus input placeholders that
 *  name a format (owner/repo, a token shape, a URL), not a sentence. */
const LATIN_ALLOWLIST: Record<string, string> = {
  'board/first-run-setup.tsx::Cairn': 'product name',
  'chief/memory-edit-composer.tsx::MEMORY.md': 'memory file name fallback',
  'components/thread/pr-card.tsx::PR #': 'PR is a kept term; the issue number follows',
  'components/thread/pr-link.tsx::PR #': 'PR is a kept term; the issue number follows',
  'pages/dir-browser.tsx::git': 'tool name badge',
  'pages/project-new-page.tsx::owner/repo': 'input placeholder example',
  'pages/project-new-page.tsx::/path/to/repo': 'path placeholder example',
  'pages/project-settings-page.tsx::main': 'default git branch name',
  'pages/project-settings-page.tsx::owner/repo': 'input placeholder example',
  "resources/bulk-secret-dialog.tsx::API_KEY='secret-value'\nNODE_ENV=development":
    '.env format example',
  'resources/composio-section.tsx::Composio': 'product name',
  'resources/composio-section.tsx::ak_…': 'token shape example',
  'resources/create-machine-dialog.tsx::XXXX-XXXX': 'pairing code shape',
  'resources/create-provider-dialog.tsx::https://api.example.com/v1': 'URL placeholder',
  'resources/mail-connectors.tsx::imap.example.com': 'hostname placeholder',
  'resources/mail-connectors.tsx::smtp.example.com': 'hostname placeholder',
  'resources/mail-connectors.tsx::boss@example.com': 'address placeholder',
  'resources/mcp-connector-dialog.tsx::Authorization': 'HTTP header name',
  'resources/mcp-connector-dialog.tsx::Bearer …': 'HTTP auth scheme',
  'resources/secret-dialog.tsx::MY_VAR': 'env var example',
  'resources/skill-dialog.tsx::deploy-to-prod': 'skill name example',
  'resources/skill-import-dialog.tsx::/Users/you/skills/deploy-to-prod': 'path placeholder',
  'resources/skill-import-dialog.tsx::https://github.com/anthropics/skills/tree/main/document-skills/pdf':
    'URL placeholder',
  'resources/upstream-model-picker.tsx::HTTP ': 'protocol literal in the `HTTP ${status}` tooltip',
  'resources/vault-pair-dialog.tsx::github.com': 'hostname placeholder',
  'resources/vault-pair-dialog.tsx::GITHUB_COM': 'env var example',
  'resources/vault-pair-dialog.tsx::alice@example.com': 'address placeholder',
  'routes/api-key-create-dialog.tsx::MY_KEY': 'env var example',
  'routes/im-page.tsx::123456:ABC…': 'bot token shape',
  'routes/im-page.tsx::xapp-…': 'token shape',
  'routes/im-page.tsx::xoxb-…': 'token shape',
  'tray/tray-page.tsx::Cairn': 'product name',
};

/** t() keys with no CJK that still render correctly in zh: product names and
 *  kept terms identical in both locales, and pure-punctuation joins. */
const LATIN_KEY_ALLOWLIST: Record<string, string> = {
  Coordinator: 'product name kept in English (CONTEXT.md)',
  PPT: 'file-type name',
  'PR #{n}': 'PR is a kept term; the issue number is the variable',
  '{n} tokens': 'technical unit suffix',
  Tailscale: 'product name',
  '，': 'punctuation passthrough',
  '、': 'punctuation passthrough',
  '{first}、{second}': 'punctuation joiner',
  '{use}：{problem}': 'punctuation joiner',
  'Cron：{expression}': 'Cron is a technical term',
};

/** Dict keys assembled at module scope (exact-value fixture chrome; the
 *  #114 banner copy keys live in the shared NOTIFICATION_BANNER_COPY canon
 *  — packages/shared, outside the src/ scan tree — and reach t() through
 *  the constant, never as literals). */
const COMPUTED_KEYS = new Set<string>([
  PROBE_TOOL_CALL_LABEL,
  NOTIFICATION_BANNER_COPY.title,
  NOTIFICATION_BANNER_COPY.body,
  NOTIFICATION_BANNER_COPY.action,

  CHIEF_REBIND_CONFIRM_COPY,

  CHIEF_INPUT_PLACEHOLDER,
  CHIEF_INPUT_PLACEHOLDER_QUEUED,
  CHIEF_INPUT_PLACEHOLDER_STEERING,

  SKILL_PAGE_COPY.empty,
  SKILL_PAGE_COPY.hint,

  ...Object.values(LOCAL_ERROR_REASON_COPY),

  ...MCP_CATALOG.flatMap((entry) => [
    entry.description,
    ...(entry.tokenLabel === undefined ? [] : [entry.tokenLabel]),
    ...(entry.tokenHelp === undefined ? [] : [entry.tokenHelp]),
    ...(entry.setup === undefined
      ? []
      : [entry.setup.installLabel, ...entry.setup.steps]),
    ...entry.options.map((option) => option.label),
  ]),

  ...Object.values(FS_PICK_ERROR_COPY),

  ...AGENT_TOOL_SWITCHES,
  ...Object.values(AGENT_TOOL_COPY),
  AGENT_PERMISSION_COPY.secrets,
  AGENT_PERMISSION_COPY.responsibility,
  AGENT_PERMISSION_COPY.defaultSkill,
  AGENT_PERMISSION_COPY.skillsAllowlist,

  MEMORY_UI_COPY.searchPlaceholder,
  MEMORY_UI_COPY.sort,

  ...GATE_ANNOUNCEMENTS.map((announcement) => `{name} ${announcement}`),
]);

/** The desktop-notification titles the SSE path translates, as
 *  `type`/source-key pairs (api/ sits outside the static scan above, so its
 *  translation keys are named here instead of discovered). */
const NOTIFICATION_TITLE_SOURCES = Object.entries(NOTIFICATION_TITLES).flatMap(
  ([type, source]) => (source === undefined ? [] : [{ type, source }]),
);

const EXCLUDED_DIRS = ['fixtures', 'api'];
const EXCLUDED_FILES = ['i18n/en.ts'];
const LATIN_EXCLUDED_DIRS = ['fixtures', 'api', 'design'];

function sourceFiles(dir: string, includeExcluded = false, excluded = EXCLUDED_DIRS): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (includeExcluded || !excluded.includes(entry)) out.push(...sourceFiles(full, includeExcluded, excluded));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const files = sourceFiles(SRC).filter(
  (f) => !EXCLUDED_FILES.includes(relative(SRC, f).replaceAll('\\', '/')),
);
const all = files.flatMap((f) => scanFile(f, SRC));

describe('CJK coverage against the en dict', () => {
  it('no CJK survives in JSX text (unwrapped render sites)', () => {
    const jsx = all.filter((f) => f.kind === 'jsx-text');
    expect(jsx.map((f) => `${f.rel}: ${f.text}`)).toEqual([]);
  });

  it('no CJK survives in template-literal quasis (use dict {vars} templates)', () => {
    const templates = all.filter((f) => f.kind === 'template');
    expect(templates.map((f) => `${f.rel}: ${f.text}`)).toEqual([]);
  });

  it('every CJK literal is an EN dict key or allowlisted', () => {
    const missing = all
      .filter((f) => f.kind === 'literal')
      .filter((f) => !(f.text in EN) && !(`${f.rel}::${f.text}` in ALLOWLIST))
      .map((f) => `${f.rel}: ${JSON.stringify(f.text)}`);
    expect([...new Set(missing)]).toEqual([]);
  });
});

describe('EN dict coverage of computed keys', () => {

  it('every computed key resolves in EN', () => {
    const missing = [...COMPUTED_KEYS].filter((key) => !(key in EN));
    expect(missing).toEqual([]);
  });

  it('every desktop-notification title the SSE path shows resolves in EN', () => {
    const missing = NOTIFICATION_TITLE_SOURCES.filter(({ source }) => !(source in EN)).map(
      ({ type, source }) => `${type}: ${source}`,
    );
    expect(missing).toEqual([]);
  });

  it('no desktop-notification title falls back to Chinese on an English desktop', () => {
    const chinese = NOTIFICATION_TITLE_SOURCES.map(
      ({ type, source }) => `${type}: ${translate('en', EN, source)}`,
    ).filter((shown) => /[一-鿿]/.test(shown));
    expect(chinese).toEqual([]);
  });
});

describe('EN dict liveness', () => {
  it('every key appears as a literal somewhere in src/ (no dead entries)', () => {

    const corpus = files
      .map((f) => readFileSync(f, 'utf8'))
      .concat(sourceFiles(join(SRC, 'fixtures')).map((f) => readFileSync(f, 'utf8')))
      .concat(sourceFiles(join(SRC, 'api')).map((f) => readFileSync(f, 'utf8')))
      .join('\n');
    const dead = Object.keys(EN).filter(
      (key) =>
        !COMPUTED_KEYS.has(key) &&
        !corpus.includes(key) &&
        !corpus.includes(key.replaceAll('\u00a0', '\\u00a0')),
    );
    expect(dead).toEqual([]);
  });
});

describe('translation call coverage', () => {
  it('every literal t() key contains CJK or is an own EN key', () => {
    const missing = sourceFiles(SRC, true)
      .flatMap((file) => scanFile(file, SRC, true))
      .filter((item) => item.kind === 'translation')
      .filter((item) => !/[一-鿿]/.test(item.text) && !Object.hasOwn(EN, item.text))
      .map((item) => `${item.rel}: ${JSON.stringify(item.text)}`);
    expect([...new Set(missing)]).toEqual([]);
  });

  it('no literal t() key is raw English — zh renders the key verbatim', () => {
    const latin = sourceFiles(SRC, true)
      .flatMap((file) => scanFile(file, SRC, true))
      .filter((item) => item.kind === 'translation')
      .filter(
        (item) =>
          !/[一-鿿]/.test(item.text) &&
          /[A-Za-z]{2,}/.test(item.text) &&
          !Object.hasOwn(LATIN_KEY_ALLOWLIST, item.text),
      )
      .map((item) => `${item.rel}: ${JSON.stringify(item.text)}`);
    expect([...new Set(latin)]).toEqual([]);
  });
});

describe('Latin bypass coverage', () => {
  it('no user-facing Latin literal bypasses t() outside the allowlist', () => {
    const latinFiles = sourceFiles(SRC, false, LATIN_EXCLUDED_DIRS).filter(
      (f) => !EXCLUDED_FILES.includes(relative(SRC, f).replaceAll('\\', '/')),
    );
    const latin = latinFiles
      .flatMap((file) => scanFile(file, SRC, false, true))
      .filter(
        (item) =>
          item.kind.startsWith('latin') &&
          !(`${item.rel}::${item.text}` in LATIN_ALLOWLIST),
      )
      .map((item) => `${item.rel} [${item.kind}] ${JSON.stringify(item.text)}`);
    expect([...new Set(latin)]).toEqual([]);
  });
});

function unbranchedPlurals(template: string): string[] {
  return [...template.matchAll(/\{\w+\}\s+[A-Za-z]+s\b/g)]
    .filter((match) => !['is', 'has', 'expires', 'writes', 'sees'].includes(match[0].split(/\s+/)[1] ?? ''))
    .map((match) => match[0]);
}

describe('English plural coverage', () => {
  it('gives every count followed by a plural noun a singular form', () => {
    expect(
      Object.entries(EN).flatMap(([key, value]) =>
        unbranchedPlurals(value).map((match) => `${key}: ${match}`),
      ),
    ).toEqual([]);
  });

  it.each(['{n} members', '{running} tasks running, {done} merged today'])(
    'rejects the audit negative control %s',
    (value) => {
      expect(unbranchedPlurals(value)).toHaveLength(1);
    },
  );

  it('checks each occurrence even when another count has a singular branch', () => {
    expect(unbranchedPlurals('{n#1 member|# members}, {m} tasks')).toEqual(['{m} tasks']);
    expect(unbranchedPlurals('{n#1 member|# members}, {n} tasks')).toEqual(['{n} tasks']);
    expect(unbranchedPlurals('{n#1 member|# members}')).toEqual([]);
  });

  it('does not mistake a singular verb for a plural noun', () => {
    expect(unbranchedPlurals('{name} sees images')).toEqual([]);
    expect(unbranchedPlurals('{name} sees {n} images')).toEqual(['{n} images']);
  });
});
