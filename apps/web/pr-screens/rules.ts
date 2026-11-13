import type { Page } from '@playwright/test';

export interface Finding {
  id: string;
  key: string;
  message: string;
}

type Rule = (page: Page) => Promise<Finding[]>;

const LIMIT = 40;
const FONT_FAMILIES = ['source serif 4', 'sourceserif4', 'instrument sans', 'instrumentsans', 'jetbrains mono', 'jetbrainsmono'];
const GLOSSARY = ['github', 'claude', 'codex', 'cairn', 'anthropic', 'openai', 'gitlab', 'docker', 'orbstack', 'langfuse', 'markdown'];

const finding = (id: string, key: string, text: string): Finding => ({ id, key: `${id}|${key}`, message: `${id}: ${text}` });

const SHARED = `
const visible = (el) => {
  const r = el.getBoundingClientRect();
  const s = getComputedStyle(el);
  return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
};
const keyOf = (el) => {
  const id = el.getAttribute('data-testid') || el.getAttribute('data-slot');
  const cls = [...el.classList].slice(0, 2).join('.');
  return el.tagName.toLowerCase() + (id ? '[' + id + ']' : cls ? '.' + cls : '');
};
`;

const run = (page: Page, body: string): Promise<Finding[]> =>
  page.evaluate(
    ({ shared, code, limit, fonts, glossary }) =>
      new Function('limit', 'fonts', 'glossary', `${shared}\n${code}`)(limit, fonts, glossary),
    { shared: SHARED, code: body, limit: LIMIT, fonts: FONT_FAMILIES, glossary: GLOSSARY },
  );

const staticRule = (id: string, body: string): Rule => async (page) => {
  const found: { key: string; text: string }[] = await run(page, body);
  return found.slice(0, LIMIT).map((item) => finding(id, item.key, item.text));
};

const C1 = staticRule(
  'C1',
  `
const phases = new Map();
for (const el of document.querySelectorAll('[data-todo-id][data-phase]')) {
  const id = el.getAttribute('data-todo-id');
  const set = phases.get(id) || new Set();
  set.add(el.getAttribute('data-phase'));
  phases.set(id, set);
}
return [...phases].filter(([, set]) => set.size > 1).map(([id, set]) => ({ key: id, text: 'todo ' + id + ' shows phases ' + [...set].join(', ') }));
`,
);

const C2 = staticRule(
  'C2',
  `
const found = [];
for (const el of document.querySelectorAll('body *')) {
  if (!visible(el)) continue;
  const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
  if (own !== '' && (/^[\\s\\u2014\\u00b7-]+$/.test(own) || /coming soon|ships with/i.test(own))) found.push({ key: keyOf(el) + ':' + own, text: 'placeholder text "' + own + '" in ' + keyOf(el) });
  const ratio = getComputedStyle(el).aspectRatio;
  if (ratio !== 'auto' && el.textContent.trim() === '' && !el.querySelector('img,svg,canvas,video,iframe') && !['IMG','SVG','CANVAS','VIDEO','IFRAME'].includes(el.tagName.toUpperCase())) found.push({ key: keyOf(el) + ':ratio', text: 'empty ' + ratio + ' block ' + keyOf(el) });
}
return found;
`,
);

const C3 = staticRule(
  'C3',
  `
const messages = [...document.querySelectorAll('[data-testid="chief-msg"]')].filter(visible);
const found = [];
for (let i = 1; i < messages.length; i += 1) {
  const a = messages[i - 1].getBoundingClientRect();
  const b = messages[i].getBoundingClientRect();
  if (a.height > 80 || b.height > 80) continue;
  const gap = Math.round(b.top - a.bottom);
  if (gap < 16 || gap > 24) found.push({ key: 'msg' + i, text: 'gap ' + gap + 'px outside 16-24px between short messages ' + (i - 1) + ' and ' + i });
}
return found;
`,
);

const C5 = staticRule(
  'C5',
  `
const found = [];
for (const el of document.querySelectorAll('[role="alert"], [role="status"], [data-sonner-toast]')) {
  if (!visible(el)) continue;
  const text = el.textContent.trim();
  if (/\\(.*\\)$/.test(text) || /Error:/.test(text) || /\\b[45]\\d\\d\\b/.test(text)) found.push({ key: keyOf(el) + ':' + text.slice(0, 40), text: 'raw error text "' + text.slice(0, 60) + '"' });
}
return found;
`,
);

const C7 = staticRule(
  'C7',
  `
const found = [];
for (const area of document.querySelectorAll('textarea:disabled')) {
  if (!visible(area)) continue;
  let node = area.parentElement;
  let explained = false;
  for (let depth = 0; node && node !== document.body && depth < 3 && !explained; depth += 1, node = node.parentElement) {
    explained = [...node.querySelectorAll('*')].some((el) => !el.contains(area) && !area.contains(el) && el.tagName !== 'BUTTON' && visible(el) && el.children.length === 0 && el.textContent.trim().length > 3);
  }
  if (!explained) found.push({ key: keyOf(area), text: 'disabled composer ' + keyOf(area) + ' has no explanatory text next to it' });
}
return found;
`,
);

const C11 = staticRule(
  'C11',
  `
const messages = [...document.querySelectorAll('[data-testid="chief-msg"]')].filter(visible);
if (messages.length === 0) return [];
const last = messages[messages.length - 1].getBoundingClientRect();
const jump = document.querySelector('[data-slot="message-scroller"] button[data-active="true"]');
if (last.top >= 0 && last.top < window.innerHeight) return [];
return jump ? [] : [{ key: 'last-reply', text: 'latest message top ' + Math.round(last.top) + 'px is outside the ' + window.innerHeight + 'px viewport and no jump-to-latest control is active' }];
`,
);

const V2 = staticRule(
  'V2',
  `
const found = new Map();
for (const el of document.querySelectorAll('body *')) {
  if (!visible(el)) continue;
  const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== '');
  if (!own) continue;
  const first = getComputedStyle(el).fontFamily.split(',')[0].replace(/["']/g, '').trim().toLowerCase();
  if (!fonts.some((f) => first.includes(f))) found.set(first, found.get(first) || keyOf(el));
}
return [...found].map(([family, where]) => ({ key: family, text: 'font "' + family + '" first in the stack on ' + where }));
`,
);

const V3 = staticRule(
  'V3',
  `
const found = [];
for (const el of document.querySelectorAll('body *')) {
  if (!visible(el)) continue;
  const s = getComputedStyle(el);
  if (/gradient\\(/.test(s.backgroundImage)) found.push({ key: keyOf(el) + ':gradient', text: 'gradient background on ' + keyOf(el) });
  if (/blur\\(/.test(s.backdropFilter + ' ' + s.filter)) found.push({ key: keyOf(el) + ':blur', text: 'blur on ' + keyOf(el) });
  if (s.webkitBackgroundClip === 'text' || s.backgroundClip === 'text') found.push({ key: keyOf(el) + ':clip', text: 'gradient text on ' + keyOf(el) });
  const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('');
  if (/\\p{Extended_Pictographic}/u.test(own)) found.push({ key: keyOf(el) + ':emoji', text: 'emoji in text of ' + keyOf(el) });
}
return found;
`,
);

const V4 = staticRule(
  'V4',
  `
return [...document.querySelectorAll('[data-slot="card"] [data-slot="card"]')].filter(visible).map((el, i) => ({ key: 'nested' + i + keyOf(el.parentElement), text: 'card nested inside a card under ' + keyOf(el.parentElement) }));
`,
);

const V8 = staticRule(
  'V8',
  `
const found = new Map();
for (const el of document.querySelectorAll('body *')) {
  if (!visible(el) || el.closest('svg')) continue;
  const s = getComputedStyle(el);
  for (const prop of ['marginTop','marginRight','marginBottom','marginLeft','paddingTop','paddingRight','paddingBottom','paddingLeft']) {
    const value = parseFloat(s[prop]);
    if (Number.isFinite(value) && Math.abs(value) < 64 && Math.abs(value / 4 - Math.round(value / 4)) > 0.01) {
      const key = keyOf(el) + ':' + prop + ':' + value;
      if (!found.has(key)) found.set(key, { key, text: prop + ' ' + value + 'px on ' + keyOf(el) + ' is off the 4px grid' });
    }
  }
}
return [...found.values()];
`,
);

const V22 = staticRule(
  'V22',
  `
const found = new Map();
for (const el of document.querySelectorAll('body *')) {
  if (!visible(el) || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== '')) continue;
  const s = getComputedStyle(el);
  if (s.textTransform === 'uppercase') found.set(keyOf(el) + ':case', { key: keyOf(el) + ':case', text: 'uppercase text on ' + keyOf(el) });
  if (s.letterSpacing !== 'normal' && parseFloat(s.letterSpacing) !== 0) found.set(keyOf(el) + ':tracking', { key: keyOf(el) + ':tracking', text: 'letter-spacing ' + s.letterSpacing + ' on ' + keyOf(el) + ', not normal' });
}
return [...found.values()];
`,
);

const V23 = staticRule(
  'V23',
  `
const found = new Map();
for (const el of document.querySelectorAll('body *')) {
  if (!visible(el) || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== '')) continue;
  const s = getComputedStyle(el);
  if (Number(s.fontWeight) >= 800) found.set(keyOf(el) + ':weight', { key: keyOf(el) + ':weight', text: 'font-weight ' + s.fontWeight + ' on ' + keyOf(el) });
  if (s.fontStyle === 'italic' && !el.closest('em, i, cite, blockquote, dfn, var')) found.set(keyOf(el) + ':italic', { key: keyOf(el) + ':italic', text: 'italic chrome text on ' + keyOf(el) });
}
return [...found.values()];
`,
);

const V24 = staticRule(
  'V24',
  `
const LAYOUT = ['all', 'width', 'height', 'top', 'left', 'right', 'bottom', 'inset', 'margin', 'padding'];
const found = new Map();
for (const el of document.querySelectorAll('body *')) {
  if (!visible(el)) continue;
  const s = getComputedStyle(el);
  const durations = s.transitionDuration.split(',').map((d) => parseFloat(d));
  s.transitionProperty.split(',').map((p) => p.trim()).forEach((prop, i) => {
    if (!LAYOUT.some((name) => prop === name || prop.startsWith(name + '-')) || !(durations[i % durations.length] > 0)) return;
    const key = keyOf(el) + ':' + prop;
    found.set(key, { key, text: 'transition on "' + prop + '" for ' + keyOf(el) + '; transition color, background, border, opacity or transform' });
  });
}
return [...found.values()];
`,
);

const T4 = staticRule(
  'T4',
  `
const found = new Map();
for (const el of document.querySelectorAll('button, [role="button"], [role="tab"], [role="menuitem"], a, h1, h2, h3, h4, label, th')) {
  if (!visible(el)) continue;
  const text = el.textContent.trim();
  if (text === '' || text.length > 40) continue;
  if (/[.。!！]$/.test(text) && !/(\\.\\.\\.|…)$/.test(text)) found.set(keyOf(el) + ':' + text, { key: keyOf(el) + ':' + text, text: 'label "' + text + '" on ' + keyOf(el) + ' ends in punctuation' });
}
return [...found.values()];
`,
);

const T1 = staticRule(
  'T1',
  `
const found = new Map();
for (const el of document.querySelectorAll('body *')) {
  if (!visible(el)) continue;
  const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ');
  if (!/[\\u4e00-\\u9fff]/.test(own)) continue;
  for (const word of own.replaceAll('Claude Code', 'Claude').match(/[A-Za-z]{4,}/g) || []) {
    if (glossary.includes(word.toLowerCase())) continue;
    found.set(word.toLowerCase(), { key: word.toLowerCase(), text: '"' + own.trim().slice(0, 40) + '" has the Latin word "' + word + '" inside a CJK string' });
  }
}
return [...found.values()];
`,
);

const A1 = staticRule(
  'A1',
  `
const found = [];
for (const el of document.querySelectorAll('button, [role="button"], a[href], select, input:not([type="hidden"])')) {
  if (!visible(el)) continue;
  if (el.tagName === 'A' && getComputedStyle(el).display === 'inline') continue;
  const r = el.getBoundingClientRect();
  if (r.width < 24 || r.height < 24) found.push({ key: keyOf(el) + ':' + Math.round(r.width) + 'x' + Math.round(r.height), text: keyOf(el) + ' is ' + Math.round(r.width) + 'x' + Math.round(r.height) + 'px, under 24px' });
}
return found;
`,
);

const iconButtons = (page: Page) =>
  page.evaluate(() => {
    const visibleBox = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= window.innerHeight;
    };
    return [...document.querySelectorAll('button, [role="button"]')]
      .filter((el) => visibleBox(el) && el.textContent?.trim() === '' && el.querySelector('svg'))
      .slice(0, 2)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, name: el.getAttribute('aria-label') ?? el.getAttribute('title') ?? '' };
      });
  });

const C4: Rule = async (page) => {
  const found: Finding[] = [];
  for (const button of await iconButtons(page)) {
    await page.mouse.move(0, 0);
    await page.mouse.move(button.x, button.y);
    await page.waitForTimeout(700);
    const shown = await page.locator('[data-slot="tooltip-content"]:visible').count();
    if (shown === 0) found.push(finding('C4', `${button.name}:${Math.round(button.x)}`, `icon-only control "${button.name || 'unnamed'}" shows no tooltip after 600ms`));
  }
  await page.mouse.move(0, 0);
  return found;
};

const A2: Rule = async (page) => {
  const found: Finding[] = [];
  await page.keyboard.press('Tab');
  const ring = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    const s = getComputedStyle(el);
    const outline = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0;
    const shadow = s.boxShadow !== 'none';
    return { outline, shadow, name: el.tagName.toLowerCase() };
  });
  if (ring && !ring.outline && !ring.shadow) found.push(finding('A2', `focus:${ring.name}`, `keyboard focus on <${ring.name}> has no outline or ring`));
  const moving = await page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => a instanceof CSSAnimation && a.effect instanceof KeyframeEffect && a.effect.getComputedTiming().iterations === Infinity)
      .flatMap((a) => Object.keys((a.effect as KeyframeEffect).getKeyframes()[0] ?? {}).filter((p) => !['offset', 'easing', 'composite', 'opacity', 'transform', 'computedOffset'].includes(p))),
  );
  for (const prop of new Set(moving)) found.push(finding('A2', `animation:${prop}`, `an animation runs on "${prop}" under reduced motion`));
  return found;
};

const R1: Rule = async (page) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  await page.setViewportSize({ width: 1440, height: 900 });
  return widths.scroll > widths.inner ? [finding('R1', 'scrollWidth', `scrollWidth ${widths.scroll} > ${widths.inner} at 390px`)] : [];
};

export const RULES: Record<string, Rule> = { C1, C2, C3, C4, C5, C7, C11, V2, V3, V4, V8, V22, V23, V24, T1, T4, A1, A2, R1 };
export const RULE_IDS = Object.keys(RULES);

export async function runRules(page: Page, only: string[] = RULE_IDS): Promise<Finding[]> {
  const found: Finding[] = [];
  for (const id of only) found.push(...(await RULES[id]!(page)));
  return found;
}

