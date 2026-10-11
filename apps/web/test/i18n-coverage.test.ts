// en-coverage gate (issue #74 acceptance: 语言切换全已建屏生效). Walks the
// app source with the TypeScript scanner and enforces the zh-as-key contract:
//
//   1. every CJK string literal under src/ (fixtures/ excluded — that is
//      user/agent data, which never translates) is either an EN dict key
//      or on the documented allowlist;
//   2. no CJK survives in JSX text nodes or template-literal quasis —
//      both mean an unwrapped render site (JSX text must go through
//      {t('…')}, interpolation through dict templates with {vars});
//   3. every EN key is live — it appears as a literal somewhere in src/,
//      so the dict cannot rot with dead entries.
//
// A miss in (1) means the en screen would show a zh string; the identity
// fallback keeps it readable but the acceptance line demands the switch
// works on every built surface.
//
// The token walk itself lives in ./i18n-scan.ts (TS 7 native scanner state
// machine, with its own regression pins in i18n-scan.test.ts — including the
// #681 regex-literal wedge that used to hang this gate forever).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import {
  AGENT_PERMISSION_COPY,
  AGENT_TOOL_COPY,
  AGENT_TOOL_SWITCHES,
  CHIEF_INPUT_PLACEHOLDER,
  CHIEF_INPUT_PLACEHOLDER_STEERING,
  CHIEF_REBIND_CONFIRM_COPY,
  FS_PICK_ERROR_COPY,
  LOCAL_ERROR_REASON_COPY,
  MEMORY_EMPTY_COPY,
  MEMORY_UI_COPY,
  NOTIFICATION_BANNER_COPY,
  SKILL_PAGE_COPY,
} from '@pacman/shared';
import { describe, expect, it } from 'vitest';
import { PROBE_TOOL_CALL_LABEL } from '../src/fixtures/fixtures.js';
import { EN } from '../src/i18n/en.js';
import { scanFile } from './i18n-scan.js';

const SRC = resolve(import.meta.dirname, '../src');

/** CJK literals that deliberately stay out of the dict, keyed `rel::text`. */
const ALLOWLIST: Record<string, string> = {
  // endonym shown in the language dropdown under both locales ([设计])
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
  // #182: chief 换绑二次确认 copy 同为 shared canon（<agent> 占位由显示层
  // 替换），经 t() 消费、不作字面量出现。
  CHIEF_REBIND_CONFIRM_COPY,
  // #624: chief 抽屉输入占位双态 canon = shared CHIEF_INPUT_PLACEHOLDER（空闲）
  // 与 CHIEF_INPUT_PLACEHOLDER_STEERING（回合中 steer），经 t() 消费、不作
  // 字面量出现（detail 面 phase.ts 的同文 steer 字面量是 detail 域矩阵自持
  // 副本，与本键集无关，不入 liveness 豁免也不因本键集失效）。
  CHIEF_INPUT_PLACEHOLDER,
  CHIEF_INPUT_PLACEHOLDER_STEERING,
  // spec 13 #367: 技能页空态文案 canon = shared SKILL_PAGE_COPY（经 t() 消费，
  // directoryHint 的 {dir} 由 SKILLS_DIR_DEFAULT 插值），不作字面量出现。
  SKILL_PAGE_COPY.empty,
  SKILL_PAGE_COPY.directoryHint,
  // #386: local 400 分译键 canon = shared LOCAL_ERROR_REASON_COPY（reason code
  // → zh 键映射，页面经常量查 t()），不作字面量出现。
  ...Object.values(LOCAL_ERROR_REASON_COPY),
  // #440: fs/pick 分译键 canon = shared FS_PICK_ERROR_COPY（reason code → zh
  // 键映射，浏览钮失败面经常量查 t()），不作字面量出现。
  ...Object.values(FS_PICK_ERROR_COPY),
  // #485: Agent 配置面词表与文案 canon = shared AGENT_TOOL_SWITCHES（权限
  // 六开关文案；XMON-84 恢复全六档）、AGENT_TOOL_COPY（六档各自的说明副文案）、
  // AGENT_PERMISSION_COPY（密钥 / MCP 服务器 / 职责 / 默认 skill 四档副文案）
  // 与 MEMORY_EMPTY_COPY（记忆 tab 空态），均经 t() 消费、不作字面量出现。
  // #510 起 secrets 一档也进渲染面（密钥区聚合总开关的副文案）：其键内嵌
  // BRAND.cliCommandName 与 SECRET_MIN_CLI_VERSION 插值，在 shared 模块加载
  // 时就已定型，web 侧更不会出现同串字面量——故必须走本表，不能靠 liveness
  // 的字面量扫描兜。
  ...AGENT_TOOL_SWITCHES,
  ...Object.values(AGENT_TOOL_COPY),
  AGENT_PERMISSION_COPY.secrets,
  AGENT_PERMISSION_COPY.mcpServers,
  AGENT_PERMISSION_COPY.responsibility,
  AGENT_PERMISSION_COPY.defaultSkill,
  AGENT_PERMISSION_COPY.skillsAllowlist,
  MEMORY_EMPTY_COPY,
  // #499: 记忆 tab 的搜索/排序词 canon = shared MEMORY_UI_COPY（searchPlaceholder
  // 与 sort 两键本面渲染，sourceLink 未落地故不入 en 词典），经 t() 消费、
  // 不作字面量出现。
  MEMORY_UI_COPY.searchPlaceholder,
  MEMORY_UI_COPY.sort,
]);

/** Data layer: capture-verbatim user/agent content, never translated.
 *  `api` = M5 live 数据层（wire→display mappers）——产出的是与 fixtures 同族
 *  的记录内容串（zh-CN 权威 canon，01 §4.1/S6：workspace zh 权威 + en 兜底
 *  在组件 t() 位兑现），mapper 为纯数据变换、无 i18n 上下文。 */
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
  // COMPUTED_KEYS 的两条扫描都放行它们（源里没有同串字面量），所以「键写错
  // 一个字符」在 liveness 与 CJK 扫描下都是静默的——en 面会悄悄回落 zh。
  // #510 的密钥副文案正落在这条盲区里（键 = shared 侧插值后的成品串），钉住。
  it('every computed key resolves in EN', () => {
    const missing = [...COMPUTED_KEYS].filter((key) => !(key in EN));
    expect(missing).toEqual([]);
  });
});

describe('EN dict liveness', () => {
  it('every key appears as a literal somewhere in src/ (no dead entries)', () => {
    // corpus 含 api/ 数据层（M5）：规则 1–2 豁免该目录（记录内容串与
    // fixtures 同族），但其经 translate() 纯函数位消费的 dict 键（桌面通知
    // 标题，api/sse.ts）是活键——liveness 面计入。
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
