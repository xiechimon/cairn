#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');

const T1_ALLOWED_LATIN = new Set([
  'coordinator',
  'cairn',
  'mac',
  'macos',
  'linux',
  'windows',
  'github',
  'claude',
  'codex',
  'anthropic',
  'openai',
  'gemini',
  'chatgpt',
  'copilot',
  'devin',
  'antigravity',
  'composio',
  'tailscale',
  'telegram',
  'slack',
  'todoist',
  'gmail',
  'outlook',
  'imessage',
  'imsg',
  'botfather',
  'oauth',
  'token',
  'tokens',
  'cron',
  'webhook',
  'http',
  'https',
  'smtp',
  'imap',
  'bearer',
  'post',
  'markdown',
  'html',
  'toml',
  'json',
  'yaml',
  'pnpm',
  'lint',
  'repo',
  'main',
  'head',
  'push',
  'pull',
  'issues',
  'issue',
  'contents',
  'permissions',
  'scope',
  'user',
  'users',
  'owner',
  'team',
  'agent',
  'agents',
  'skills',
  'skill',
  'shell',
  'local',
  'server',
  'mini',
  'setup',
  'login',
  'connections',
  'credentials',
  'deploy',
  'develop',
  'example',
  'code',
  'serve',
  'browser',
  'chrome',
  'pixel',
  'fusion',
  'base',
  'basic',
  'level',
  'relay',
  'share',
  'start',
  'status',
  'studio',
  'logs',
  'write',
  'force',
  'machine',
  'integration',
  'wiki',
  'apppasswords',
  'myaccount',
  'google',
  'done',
  'running',
  'waiting',
  'failed',
  'review',
  'name',
  'value',
  'settings',
  'keys',
  'information',
  'allow',
]);

const DESIGN_EXEMPT = /^(?:design\/|vendor-open-design\/)/;

function walk(dir, predicate, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== 'node_modules') walk(full, predicate, out);
    } else if (predicate(full)) {
      out.push(full);
    }
  }
  return out;
}

function lineNumberAt(text, index) {
  return text.slice(0, index).split('\n').length;
}

function readJsxOpeningTag(text, startIndex) {
  let depth = 0;
  let quote = '';
  for (let i = startIndex; i < text.length; i++) {
    const ch = text[i];
    if (quote !== '') {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      if (depth > 0) depth -= 1;
    } else if (ch === '>' && depth === 0) {
      return text.slice(startIndex, i + 1);
    }
  }
  return text.slice(startIndex);
}

function createVfs(root, files, isolated) {
  const map = new Map(Object.entries(files ?? {}));
  return {
    exists(rel) {
      if (map.has(rel)) return true;
      return !isolated && existsSync(join(root, rel));
    },
    read(rel) {
      if (map.has(rel)) return map.get(rel);
      if (isolated) return null;
      const full = join(root, rel);
      return existsSync(full) ? readFileSync(full, 'utf8') : null;
    },
    list(prefix, exts) {
      const seen = new Set();
      if (!isolated) {
        const base = join(root, prefix);
        for (const full of walk(base, (f) => exts.some((ext) => f.endsWith(ext)))) {
          seen.add(relative(root, full).replace(/\\/g, '/'));
        }
      }
      for (const rel of map.keys()) {
        if (rel.startsWith(prefix) && exts.some((ext) => rel.endsWith(ext))) seen.add(rel);
      }
      return [...seen].sort();
    },
  };
}

function checkCssRules(vfs, push) {
  const appCss = vfs.read('apps/web/src/styles/app.css');
  if (appCss !== null) {
    if (!appCss.includes('@media (prefers-reduced-motion: reduce)')) {
      push(
        'A2',
        'apps/web/src/styles/app.css',
        1,
        'missing @media (prefers-reduced-motion: reduce)',
      );
    }
    if (!appCss.includes('touch-action: manipulation')) {
      push(
        'C38',
        'apps/web/src/styles/app.css',
        1,
        'missing touch-action: manipulation on interactive controls',
      );
    }
    if (!appCss.includes('overscroll-behavior: contain')) {
      push(
        'C38',
        'apps/web/src/styles/app.css',
        1,
        'missing overscroll-behavior: contain on overlays',
      );
    }
    for (const match of appCss.matchAll(/overscroll-behavior:\s*none\b/g)) {
      const before = appCss.slice(0, match.index);
      const mediaIdx = before.lastIndexOf('@media (pointer: fine)');
      if (
        mediaIdx === -1 ||
        before.slice(mediaIdx).split('{').length <= before.slice(mediaIdx).split('}').length
      ) {
        push(
          'C38',
          'apps/web/src/styles/app.css',
          lineNumberAt(appCss, match.index),
          'overscroll-behavior: none must sit inside @media (pointer: fine)',
        );
      }
    }
    if (!appCss.includes('-webkit-user-drag: none')) {
      push(
        'C39',
        'apps/web/src/styles/app.css',
        1,
        'missing -webkit-user-drag: none on interactive images',
      );
    }
    for (const [token, desc] of [
      ['user-select: none', 'user-select: none on non-input controls'],
      ['text-wrap: balance', 'text-wrap: balance on headings'],
      ['scroll-margin-top', 'scroll-margin-top on headings'],
      ['scroll-padding-block-start', 'scroll-padding-block-start on root'],
      ['::selection', '::selection highlight rule'],
    ]) {
      if (!appCss.includes(token)) {
        push('C40', 'apps/web/src/styles/app.css', 1, `missing ${desc}`);
      }
    }
    const strippedCss = appCss.replace(/\/\*[\s\S]*?\*\//g, '');
    let buttonTouchAction = false;
    for (const block of strippedCss.matchAll(/([^{}@]+)\{([^{}]+)\}/g)) {
      const selectorText = block[1].trim();
      const body = block[2];
      const selectors = selectorText.split(',').map((s) => s.trim());
      if (selectors.includes('button') && /touch-action:\s*manipulation\b/.test(body)) {
        buttonTouchAction = true;
      }
      if (/user-select:\s*none\b/.test(body) && selectors.includes('a')) {
        push(
          'C40',
          'apps/web/src/styles/app.css',
          lineNumberAt(strippedCss, block.index),
          'user-select: none must not apply to standalone inline links (a)',
        );
      }
    }
    if (!buttonTouchAction) {
      push(
        'C38',
        'apps/web/src/styles/app.css',
        1,
        'missing touch-action: manipulation in button control block',
      );
    }
    if (!appCss.includes('text-autospace: normal')) {
      push('T7', 'apps/web/src/styles/app.css', 1, 'missing text-autospace: normal');
    }
    if (!appCss.includes('-webkit-text-size-adjust: 100%')) {
      push('V31', 'apps/web/src/styles/app.css', 1, 'missing -webkit-text-size-adjust: 100%');
    }
  }

  const shadcnCss = vfs.read('apps/web/src/styles/shadcn.css');
  if (shadcnCss !== null) {
    const combo = shadcnCss.match(/color-scheme:\s*dark\s+light\b/);
    if (combo !== null) {
      push(
        'C42',
        'apps/web/src/styles/shadcn.css',
        lineNumberAt(shadcnCss, combo.index),
        'replace color-scheme: dark light with explicit per-theme color-scheme values',
      );
    }
    if (
      !/color-scheme:\s*dark\s*;/.test(shadcnCss) ||
      !/color-scheme:\s*light\s*;/.test(shadcnCss)
    ) {
      push(
        'C42',
        'apps/web/src/styles/shadcn.css',
        1,
        'missing explicit color-scheme: dark and color-scheme: light',
      );
    }
  }

  const themeTs = vfs.read('apps/web/src/theme.ts');
  if (themeTs !== null && !themeTs.includes('root.style.colorScheme')) {
    push(
      'C42',
      'apps/web/src/theme.ts',
      1,
      'paintTheme must sync document.documentElement.style.colorScheme',
    );
  }
}

function checkHtmlAndInputs(vfs, push) {
  for (const htmlRel of ['apps/web/index.html', 'apps/web/design.html']) {
    const html = vfs.read(htmlRel);
    if (html !== null && !html.includes('viewport-fit=cover')) {
      push('C42', htmlRel, 1, 'viewport meta must include viewport-fit=cover');
    }
  }
}

function checkOutlineNone(rel, lines, push) {
  if (rel.startsWith('apps/web/src/components/ui/')) return;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/\boutline-none\b/.test(line)) continue;
    if (/focus-visible:outline-none|\[&_canvas\]:outline-none/.test(line)) continue;
    const windowText = lines.slice(Math.max(0, i - 6), Math.min(lines.length, i + 7)).join('\n');
    if (
      /focus-visible:|tabIndex=\{-1\}|focus-within:|Dialog|AlertDialog|Combobox\.(?:Popup|List)|TabsPrimitive\.Panel|DialogBody|delete-confirm/.test(
        windowText,
      )
    ) {
      continue;
    }
    push('A2', rel, i + 1, 'bare outline-none without focus-visible replacement');
  }
}

function checkKeydownGuards(rel, text, lines, push) {
  for (let i = 0; i < lines.length; i++) {
    if (!/(?:window|document)\.addEventListener\(\s*['"]keydown['"]/.test(lines[i])) continue;
    if (
      /(?:isEditable|isContentEditable|INPUT|TEXTAREA|SELECT|isComposing|Escape|shouldIgnoreKey)/i.test(
        text,
      )
    ) {
      continue;
    }
    push('C44', rel, i + 1, 'global keydown listener missing editable target or Escape guard');
  }
}

function checkDetailCodeTags(rel, text, push) {
  for (const match of text.matchAll(/<(?:pre|code)\b/g)) {
    const tag = readJsxOpeningTag(text, match.index);
    if (!/\btranslate=["']no["']/.test(tag)) {
      push(
        'T6',
        rel,
        lineNumberAt(text, match.index),
        'rendered <pre>/<code> in detail must set translate="no"',
      );
    }
  }
}

function checkWebSources(vfs, push) {
  for (const rel of vfs.list('apps/web/src/', ['.ts', '.tsx', '.css'])) {
    if (rel.includes('.test.')) continue;
    const sub = rel.slice('apps/web/src/'.length);
    if (DESIGN_EXEMPT.test(sub)) continue;
    const text = vfs.read(rel);
    if (text === null) continue;
    const lines = text.split('\n');

    if (rel.endsWith('.ts') || rel.endsWith('.tsx')) {
      checkOutlineNone(rel, lines, push);
      checkKeydownGuards(rel, text, lines, push);

      if (!sub.startsWith('components/ui/')) {
        for (const match of text.matchAll(/<(div|span)\b/g)) {
          const tag = readJsxOpeningTag(text, match.index);
          if (/\bonClick\s*=/.test(tag) && !/\baria-hidden\b/.test(tag)) {
            push(
              'A7',
              rel,
              lineNumberAt(text, match.index),
              `clickable <${match[1]}> must be a semantic button or link`,
            );
          }
        }
      }
      if (!sub.startsWith('components/ui/')) {
        for (const match of text.matchAll(/<select\b/g)) {
          push(
            'A7',
            rel,
            lineNumberAt(text, match.index),
            'bare <select> banned outside components/ui',
          );
        }
        for (const match of text.matchAll(/\btransition-all\b/g)) {
          push(
            'T6',
            rel,
            lineNumberAt(text, match.index),
            'transition-all banned; animate explicit properties',
          );
        }
      }
      for (const match of text.matchAll(
        /hover:font-(?:thin|extralight|light|normal|medium|semibold|bold|extrabold|black)\b/g,
      )) {
        push('T6', rel, lineNumberAt(text, match.index), 'hover:font-* causes layout shift');
      }
      for (const match of text.matchAll(/\bfont-(?:thin|extralight|light)\b/g)) {
        push('V31', rel, lineNumberAt(text, match.index), 'light font weights below 400 banned');
      }
      for (const match of text.matchAll(/toast\.\w+\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g)) {
        const msg = match[2];
        if (/\([^)]*\)$|Error:|\b[45]\d{2}\b/.test(msg)) {
          push('C5', rel, lineNumberAt(text, match.index), 'raw error literal in toast call');
        }
      }
      for (const match of text.matchAll(/<img\b/g)) {
        const tag = readJsxOpeningTag(text, match.index);
        if (!/\balt=/.test(tag)) {
          push('C39', rel, lineNumberAt(text, match.index), '<img> missing explicit alt attribute');
        }
      }
      if (!sub.startsWith('components/ui/')) {
        for (const match of text.matchAll(/<(?:Input|InputGroupInput|input)\b/g)) {
          const tag = readJsxOpeningTag(text, match.index);
          if (
            /\btype=(['"])(?:email|url|password)\1/.test(tag) &&
            !/\bspellCheck=\{false\}/.test(tag)
          ) {
            push(
              'C41',
              rel,
              lineNumberAt(text, match.index),
              'email, url and password inputs must set spellCheck={false}',
            );
          }
        }
      }
      if (sub.startsWith('detail/')) {
        checkDetailCodeTags(rel, text, push);
      }
    }

    if (rel === 'apps/web/src/i18n/en.ts') {
      const entryRe =
        /^\s*(?:(['"])([^'"]*[\u4e00-\u9fff][^'"]*)\1|([^\s:'"]*[\u4e00-\u9fff][^\s:'"]*))\s*:\s*(?:\n\s*)?(['"])((?:\\.|(?!\4).)*)\4/gm;
      for (const m of text.matchAll(entryRe)) {
        const line = lineNumberAt(text, m.index);
        const zh = m[2] ?? m[3] ?? '';
        const en = m[5] ?? '';
        if (zh.includes('...') || en.includes('...')) {
          push('T7', rel, line, 'use typographic ellipsis … instead of ASCII ...');
        }
        if (/\d(?:MB|GB|KB|TB|ms)\b/.test(zh)) {
          push('T7', rel, line, 'add a space between number and unit in Chinese copy');
        }
        const cleaned = zh
          .replace(/\{[^}]+\}/g, ' ')
          .replace(/https?:\/\/\S+/g, ' ')
          .replace(/\/[A-Za-z0-9_./-]+/g, ' ')
          .replace(
            /\b(?:gh|git|pnpm|npm|npx|node|docker|brew|ssh|curl)(?:\s+[A-Za-z0-9_.-]+)+/g,
            ' ',
          );
        for (const w of cleaned.matchAll(/\b[A-Za-z]{4,}\b/g)) {
          if (!T1_ALLOWED_LATIN.has(w[0].toLowerCase())) {
            push('T1', rel, line, `unexpected Latin word "${w[0]}" inside Chinese copy`);
          }
        }
      }
    } else if (rel.endsWith('.ts') || rel.endsWith('.tsx')) {
      for (let i = 0; i < lines.length; i++) {
        for (const lit of lines[i].matchAll(
          /(['"])((?:\\.|(?!\1).)*[\u4e00-\u9fff](?:\\.|(?!\1).)*)\1/g,
        )) {
          if (lit[2].includes('...')) {
            push(
              'T7',
              rel,
              i + 1,
              'use typographic ellipsis … instead of ASCII ... in Chinese string',
            );
          }
          if (/\d(?:MB|GB|KB|TB)\b/.test(lit[2])) {
            push('T7', rel, i + 1, 'add a space between number and unit in Chinese string');
          }
        }
      }
    }
  }
}

function checkDesktopChrome(vfs, push) {
  const menu = vfs.read('apps/desktop/src/app-menu.ts');
  if (menu !== null) {
    const zhBlock = menu.match(/zh:\s*\{([\s\S]*?)\n {2}\},/);
    if (zhBlock !== null) {
      const startLine = lineNumberAt(menu, zhBlock.index);
      const blockLines = zhBlock[1].split('\n');
      for (let i = 0; i < blockLines.length; i++) {
        for (const lit of blockLines[i].matchAll(
          /(['"`])((?:\\.|(?!\1).)*[\u4e00-\u9fff](?:\\.|(?!\1).)*)\1/g,
        )) {
          if (/(?:\([^)]*\)|\.\.\.)/.test(lit[2])) {
            push(
              'C45',
              'apps/desktop/src/app-menu.ts',
              startLine + i,
              'use full-width Chinese parens and … in zh menu labels',
            );
          }
        }
      }
    }
  }

  const offline = vfs.read('apps/desktop/src/offline-page.ts');
  if (offline !== null) {
    for (const [token, label] of [
      ['viewport-fit=cover', 'viewport-fit=cover'],
      ['color-scheme: light', 'color-scheme: light'],
      ['color-scheme: dark', 'color-scheme: dark'],
      ['100dvh', 'min-height: 100dvh'],
      ['touch-action: manipulation', 'touch-action: manipulation'],
      ['user-select: none', 'user-select: none'],
      ['button:focus-visible', 'button:focus-visible outline'],
    ]) {
      if (!offline.includes(token)) {
        push('C45', 'apps/desktop/src/offline-page.ts', 1, `missing ${label}`);
      }
    }
    if (!offline.includes('role="status"') && !offline.includes('aria-live="polite"')) {
      push(
        'C45',
        'apps/desktop/src/offline-page.ts',
        1,
        'missing live status region (role="status" or aria-live="polite")',
      );
    }
  }
}

export function checkUiGuidelines({ root = REPO_ROOT, files = null, isolated = false } = {}) {
  const violations = [];
  const push = (rule, file, line, message) => violations.push({ rule, file, line, message });
  const vfs = createVfs(root, files, isolated);
  checkCssRules(vfs, push);
  checkHtmlAndInputs(vfs, push);
  checkWebSources(vfs, push);
  checkDesktopChrome(vfs, push);
  return { ok: violations.length === 0, violations };
}

function main() {
  const result = checkUiGuidelines();
  for (const v of result.violations) {
    console.error(`[ui-guidelines-gate] ${v.rule} ${v.file}:${v.line} ${v.message}`);
  }
  if (!result.ok) {
    console.error(`[ui-guidelines-gate] FAIL: ${result.violations.length} violation(s)`);
    process.exit(1);
  }
  console.log('[ui-guidelines-gate] PASS: static UI guideline checks clean');
}

if (process.argv[1] === import.meta.filename) main();
