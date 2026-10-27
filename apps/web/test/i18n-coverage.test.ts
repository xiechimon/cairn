import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import {
  AGENT_PERMISSION_COPY,
  AGENT_TOOL_COPY,
  AGENT_TOOL_SWITCHES,
  CHIEF_DIGEST_GROUP_LABELS,
  CHIEF_INPUT_PLACEHOLDER,
  CHIEF_INPUT_PLACEHOLDER_STEERING,
  CHIEF_REBIND_CONFIRM_COPY,
  FS_PICK_ERROR_COPY,
  LOCAL_ERROR_REASON_COPY,
  MEMORY_EMPTY_COPY,
  MEMORY_UI_COPY,
  NOTIFICATION_BANNER_COPY,
  SKILL_PAGE_COPY,
} from '@cairn/shared';
import { describe, expect, it } from 'vitest';
import { PROBE_TOOL_CALL_LABEL } from '../src/fixtures/fixtures.js';
import { EN } from '../src/i18n/en.js';
import { scanFile } from './i18n-scan.js';

const SRC = resolve(import.meta.dirname, '../src');

/** CJK literals that deliberately stay out of the dict, keyed `rel::text`. */
const ALLOWLIST: Record<string, string> = {

  'i18n/locale.ts::简体中文': 'language endonym — identical in every locale by design',
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

  ...Object.values(CHIEF_DIGEST_GROUP_LABELS),

  CHIEF_INPUT_PLACEHOLDER,
  CHIEF_INPUT_PLACEHOLDER_STEERING,

  SKILL_PAGE_COPY.empty,
  SKILL_PAGE_COPY.directoryHint,

  ...Object.values(LOCAL_ERROR_REASON_COPY),

  ...Object.values(FS_PICK_ERROR_COPY),

  ...AGENT_TOOL_SWITCHES,
  ...Object.values(AGENT_TOOL_COPY),
  AGENT_PERMISSION_COPY.secrets,
  AGENT_PERMISSION_COPY.mcpServers,
  AGENT_PERMISSION_COPY.responsibility,
  AGENT_PERMISSION_COPY.defaultSkill,
  AGENT_PERMISSION_COPY.skillsAllowlist,
  MEMORY_EMPTY_COPY,

  MEMORY_UI_COPY.searchPlaceholder,
  MEMORY_UI_COPY.sort,
]);

const EXCLUDED_DIRS = ['fixtures', 'api'];
const EXCLUDED_FILES = ['i18n/en.ts'];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!EXCLUDED_DIRS.includes(entry)) out.push(...sourceFiles(full));
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
});

describe('EN dict liveness', () => {
  it('every key appears as a literal somewhere in src/ (no dead entries)', () => {

    const corpus = files
      .map((f) => readFileSync(f, 'utf8'))
      .concat(sourceFiles(join(SRC, 'fixtures')).map((f) => readFileSync(f, 'utf8')))
      .concat(sourceFiles(join(SRC, 'api')).map((f) => readFileSync(f, 'utf8')))
      .join('\n');
    const dead = Object.keys(EN).filter(
      (key) => !COMPUTED_KEYS.has(key) && !corpus.includes(key),
    );
    expect(dead).toEqual([]);
  });
});
