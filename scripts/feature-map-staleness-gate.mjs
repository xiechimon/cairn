#!/usr/bin/env node
// feature-map 陈旧闸（#1160，advisory）：verify-pacman feature map 引用的仓内
// 路径与选择子必须能在当前树命中——过期必须机器可见，不靠人记得维护。
//
// 为什么它是机器活：#1156（Agent 详情页头像被裁）本该被 map 拦住——
// features/avatars.md 还写着「Root 走 `display:contents`」，而代码 #1003 起
// 已弃 contents 根、Root 变定尺盒（漏传 size class 即裁图）。文档停在旧模型，
// 没有人知道它过期了。陈旧检测 = 引用与树求差集，正是机器擅长、人必漏的活。
//
// 为什么 advisory（红灯可见、不拦合并）：故意不进分支保护 required contexts
// （仓规：必需检查一律等合完之后再由用户决定是否收紧——同 dead-class-gate
// 口径）。存量陈旧冻结在 scripts/feature-map-staleness-baseline.json，本闸只
// 对**新增**陈旧红；baseline 条目转绿反过来红、提示删除（防 baseline 腐烂）。
//
// 判定口径（四类，全部只查 features/*.md 行内反引号 span）：
//   path      源码扩展名 token（.ts/.tsx/.mjs/.css/.md/.sh 等；.json/.png 是
//             运行期工件/证据产物，排除）→ 仓内 exact / 路径后缀 / （裸文件名
//             时）basename 大小写不敏感兜底，三法全 miss 才报。
//   class     `.foo` 形 → apps/web/src 剥注释后 \bfoo\b 零命中报。裸 kebab
//             token（sub-feature id，如 `keys-create`）不查——形似类名但语义
//             是特性 id，查了全是假红。
//   data-attr `[data-x]` / `[data-x="v"]` / `[data-x="a"|"b"]` → 属性句柄
//             `data-x=` 在 src 零命中报；带值时静态字面 miss 且「动态绑定
//             `data-x={` + 值字面」也 miss 才报（值来自数据的句柄不误伤，如
//             data-column-list={columnId} 配 [data-column-list="todo"]）。
//             role/aria/open 等标准 HTML 状态属性不查（非仓内钩子，陈旧信号弱）。
//   css-decl  `prop:value` 且 prop ∈ {display,visibility,overflow,position} →
//             src 里 `prop: value` miss 且 tailwind 等价类（display:contents→
//             contents、visibility:hidden→invisible）也 miss 才报。
//             **同行点名了 src 组件文件时，语料收窄到那几个文件**：声明形陈述
//             说的是点名组件自己的形态（avatars.md「Root 走 display:contents」
//             与 seeded-avatar.tsx 同行）——全站搜会被无关组件的同类 token 洗绿
//             （chief-settings.tsx 的 className="contents" 就洗掉了这条真红）。
//
// 失败方式清单（先列后写码；校准数据见 #1160）：
//   假红面——占位符 token（含 <skill>/… 的 span 跳过）；运行期工件（.json/.png
//     排除）；动态属性值（见 data-attr 规则）；tailwind 等价类（见 css-decl）；
//     大小写（macOS 文件系统不敏感会骗 existsSync，故一律用 readdir 走出的
//     真实文件名做字符串比较，与 Linux CI 同口径；仅裸文件名兜底放宽为大小写
//     不敏感，覆盖 map 里 `skill.md` 这类故意提反例的写法）；退役历史提及
//     （「旧 X 随票退役」）闸读不出意图 → 进 baseline 并注 note。
//   假绿面——后缀/basename 兜底：文件挪窝仍算在（闸抓删除/改名，不抓搬家，
//     接受）；src 注释提及类名会喂假绿 → 语料剥注释（// 仅在非 `:` 后剥，
//     不误伤 URL；/* */ 整剥）压掉；动态拼类名（res-row${x}）字面片段命中
//     即绿（接受，压噪声优先）。
//   空转绿灯不算交付：--no-baseline 全量审计 + PR 里「故意改失效 → 红 →
//     报出哪条」实测是验收件。
//
// usage: node scripts/feature-map-staleness-gate.mjs [--no-baseline]
//          [--write-baseline] [--dir <features-dir>]
//   --no-baseline    忽略 baseline，报全部陈旧（审计/取证用）
//   --write-baseline 把当前全部陈旧写回 baseline（保留既有条目 note；
//                    baseline 扩容 = 新债入账，PR 里要能说出理由）
//   --dir            覆写 features 目录（自测/红态演示用，不碰真 map）
// 纯 node stdlib；只读仓内文件；无 node_modules、不联网。cwd = 仓根。

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const ROOT = process.cwd();
const FEATURES_DIR_DEFAULT = '.claude/skills/verify-pacman/features';
const SRC_DIR = 'apps/web/src';
const BASELINE_PATH = 'scripts/feature-map-staleness-baseline.json';

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  '.herdr-project',
  'test-results',
  'playwright-report',
  'coverage',
  '.turbo',
  'worktrees',
]);
const PATH_EXT_RE = /^[\w@.\-/]+\.(tsx|ts|mts|cts|mjs|cjs|js|jsx|css|md|py|sh|svg)$/;
const CLASS_RE = /^\.[A-Za-z][\w-]*$/;
const ATTR_RE = /^\[(data-[\w-]+)(?:=([^\]]*))?\]$/;
const DECL_RE = /^([a-z-]+):([a-z0-9-]+)$/;
const CSS_PROPS = new Set(['display', 'visibility', 'overflow', 'position']);
const TW_EQUIV = {
  display: { contents: 'contents', none: 'hidden', flex: 'flex' },
  visibility: { hidden: 'invisible', visible: 'visible' },
};
const SRC_EXT_RE = /\.(tsx|ts|jsx|js|css)$/;

function esc(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function walk(dir, rel, out) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      if (
        e.name.startsWith('.') &&
        e.name !== '.claude' &&
        e.name !== '.github' &&
        e.name !== '.cursor'
      )
        continue;
      walk(join(dir, e.name), `${rel}${e.name}/`, out);
    } else {
      out.push(`${rel}${e.name}`);
    }
  }
}

// 剥注释：块注释整剥；行注释仅在 `//` 前不是 `:` 时剥（不误伤 https:// 等
// URL 字面量）。字符串里出现 `/*` 的极端形态接受误差（语料用途是「有没有
// 命中」，剥多不会造假绿，剥少才会——而块注释剥是贪心的方向安全侧）。
function stripComments(text, isCss) {
  let t = text.replace(/\/\*[\s\S]*?\*\//g, ' ');
  if (!isCss) t = t.replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  return t;
}

function parseArgs(argv) {
  const args = { noBaseline: false, writeBaseline: false, dir: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-baseline') args.noBaseline = true;
    else if (a === '--write-baseline') args.writeBaseline = true;
    else if (a === '--dir') args.dir = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
    else {
      console.error(`feature-map-gate: unknown arg ${a}`);
      process.exit(2);
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      'usage: node scripts/feature-map-staleness-gate.mjs [--no-baseline] [--write-baseline] [--dir <features-dir>]',
    );
    return 0;
  }

  // 1. repo file universe（真实大小写，来自 readdir，不用 existsSync——
  //    macOS 大小写不敏感会骗出假绿）
  const files = [];
  walk(ROOT, '', files);
  const fileSet = new Set(files);

  // 2. src corpus（剥注释后拼接；srcFiles 留单文件语料供 css-decl 收窄）
  let src = '';
  const srcFiles = new Map(); // rel -> stripped content
  for (const f of files) {
    if (!f.startsWith(`${SRC_DIR}/`) || !SRC_EXT_RE.test(f)) continue;
    const text = stripComments(readFileSync(join(ROOT, f), 'utf8'), f.endsWith('.css'));
    srcFiles.set(f, text);
    src += `${text}\n`;
  }
  const hasWordIn = (corpus, w) => new RegExp(`\\b${esc(w)}\\b`).test(corpus);
  const hasWord = (w) => hasWordIn(src, w);

  // path token 三段解析：exact → 路径后缀 → （裸文件名）basename 大小写不敏感
  const resolvePathTok = (tok) => {
    const t = tok.replace(/^\//, ''); // `/avatar-*.svg` = public 资产引用
    if (fileSet.has(t)) return t;
    const suffix = files.find((f) => f.endsWith(`/${t}`));
    if (suffix) return suffix;
    if (!t.includes('/')) {
      const lower = basename(t).toLowerCase();
      const hit = files.find((f) => basename(f).toLowerCase() === lower);
      if (hit) return hit;
    }
    return null;
  };

  // 3. 引用提取与判定
  const featuresDir = args.dir ?? join(ROOT, FEATURES_DIR_DEFAULT);
  const mdFiles = readdirSync(featuresDir)
    .filter((f) => f.endsWith('.md'))
    .sort();
  const violations = new Map(); // key -> {file,line,kind,symbol,reason}
  let refsChecked = 0;

  const addViolation = (file, line, kind, symbol, reason) => {
    const key = `${file}\u0000${kind}\u0000${symbol}`;
    if (!violations.has(key)) violations.set(key, { file, line, kind, symbol, reason });
  };

  for (const md of mdFiles) {
    const lines = readFileSync(join(featuresDir, md), 'utf8').split('\n');
    lines.forEach((ln, idx) => {
      const spans = [...ln.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);
      const line = idx + 1;

      // 同行点名的 src 组件文件 → css-decl 语料收窄（声明形说的是点名组件
      // 自己的形态，全站搜会被无关组件的同类 token 洗绿）
      let scope = null;
      for (const tok of spans) {
        if (!PATH_EXT_RE.test(tok) || tok.includes('<') || tok.includes('>')) continue;
        const r = resolvePathTok(tok);
        if (r && srcFiles.has(r)) scope = (scope ?? '') + srcFiles.get(r);
      }

      for (const tok of spans) {
        // path
        if (PATH_EXT_RE.test(tok) && !tok.includes('<') && !tok.includes('>')) {
          refsChecked++;
          if (resolvePathTok(tok) == null)
            addViolation(
              md,
              line,
              'path',
              tok,
              'no such file in repo (exact / path-suffix / basename all miss)',
            );
          continue;
        }

        // class selector
        if (CLASS_RE.test(tok)) {
          refsChecked++;
          if (!hasWord(tok.slice(1)))
            addViolation(
              md,
              line,
              'class',
              tok,
              'zero word-boundary hits in apps/web/src (comments stripped)',
            );
          continue;
        }

        // data-* attribute selector
        const attr = tok.match(ATTR_RE);
        if (attr) {
          refsChecked++;
          const [, name, rawValue] = attr;
          if (!src.includes(`${name}=`)) {
            addViolation(
              md,
              line,
              'data-attr',
              tok,
              `attribute handle ${name}= not in apps/web/src`,
            );
            continue;
          }
          if (rawValue != null && rawValue !== '') {
            const variants = rawValue
              .split('|')
              .map((v) => v.trim().replace(/^["']|["']$/g, ''))
              .filter(Boolean);
            const dynamic = src.includes(`${name}={`);
            const ok = variants.some(
              (v) =>
                src.includes(`${name}="${v}"`) ||
                src.includes(`${name}='${v}'`) ||
                (dynamic && hasWord(v)),
            );
            if (!ok)
              addViolation(
                md,
                line,
                'data-attr',
                tok,
                `handle exists but value(s) ${variants.join(' / ')} neither literal nor dynamic-bound in apps/web/src`,
              );
          }
          continue;
        }

        // css declaration shape
        const decl = tok.match(DECL_RE);
        if (decl && CSS_PROPS.has(decl[1])) {
          refsChecked++;
          const [, prop, value] = decl;
          const corpus = scope ?? src;
          const where = scope
            ? 'component-scoped apps/web/src files named on the same line'
            : 'apps/web/src';
          const declHit = new RegExp(`${prop}:\\s*['"]?${esc(value)}\\b`).test(corpus);
          const eq = TW_EQUIV[prop]?.[value];
          if (!declHit && !(eq && hasWordIn(corpus, eq)))
            addViolation(
              md,
              line,
              'css-decl',
              tok,
              `declaration zero-hit in ${where}${eq ? ` and tailwind equivalent .${eq} zero-hit` : ' (no tailwind equivalent known)'}`,
            );
        }
      }
    });
  }

  // 4. baseline 结算
  const all = [...violations.values()];
  if (args.writeBaseline) {
    let prev = { entries: [] };
    if (existsSync(join(ROOT, BASELINE_PATH)))
      prev = JSON.parse(readFileSync(join(ROOT, BASELINE_PATH), 'utf8'));
    const notes = new Map(
      prev.entries.map((e) => [`${e.file}\u0000${e.kind}\u0000${e.symbol}`, e.note]),
    );
    const entries = all.map((v) => ({
      file: v.file,
      kind: v.kind,
      symbol: v.symbol,
      line: v.line,
      ...(notes.has(`${v.file}\u0000${v.kind}\u0000${v.symbol}`)
        ? { note: notes.get(`${v.file}\u0000${v.kind}\u0000${v.symbol}`) }
        : {}),
    }));
    writeFileSync(
      join(ROOT, BASELINE_PATH),
      `${JSON.stringify({ $comment: 'feature-map 陈旧闸（#1160）存量冻结：条目=file+kind+symbol（line 仅提示，map 行号会漂）；新增条目 = 新债入账，PR 里要能说出理由；条目转绿闸会红、要求删除。', entries }, null, 2)}\n`,
    );
    console.log(
      `feature-map-gate: baseline written — ${entries.length} entries (${mdFiles.length} md files, ${refsChecked} refs checked)`,
    );
    return 0;
  }

  let baseline = { entries: [] };
  if (!args.noBaseline && existsSync(join(ROOT, BASELINE_PATH)))
    baseline = JSON.parse(readFileSync(join(ROOT, BASELINE_PATH), 'utf8'));
  const baseKeys = new Set(
    baseline.entries.map((e) => `${e.file}\u0000${e.kind}\u0000${e.symbol}`),
  );
  const fresh = args.noBaseline
    ? all
    : all.filter((v) => !baseKeys.has(`${v.file}\u0000${v.kind}\u0000${v.symbol}`));
  const allKeys = new Set(all.map((v) => `${v.file}\u0000${v.kind}\u0000${v.symbol}`));
  const staleBaseline = args.noBaseline
    ? []
    : baseline.entries.filter((e) => !allKeys.has(`${e.file}\u0000${e.kind}\u0000${e.symbol}`));

  if (fresh.length === 0 && staleBaseline.length === 0) {
    console.log(
      `feature-map-gate: OK (${mdFiles.length} md files, ${refsChecked} refs checked, ${baseKeys.size} frozen in baseline)`,
    );
    return 0;
  }

  if (fresh.length > 0) {
    console.log(
      `feature-map-gate: ${fresh.length} stale reference(s) beyond baseline (${mdFiles.length} md files, ${refsChecked} refs checked):`,
    );
    for (const v of fresh.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line))
      console.log(`  features/${v.file}:${v.line}: [${v.kind}] \`${v.symbol}\` — ${v.reason}`);
  }
  if (staleBaseline.length > 0) {
    console.log(
      `feature-map-gate: ${staleBaseline.length} baseline entry(ies) now green — remove from ${BASELINE_PATH}:`,
    );
    for (const e of staleBaseline) console.log(`  ${e.file} [${e.kind}] \`${e.symbol}\``);
  }
  return 1;
}

process.exit(main());
