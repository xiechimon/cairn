#!/usr/bin/env node

// One-shot icon component generator (issue #53): reads the r7 icon dump
// (docs/research/assets/r7/icons.json, 218 entries / 64 unique raw
// markups) plus the r6 detail-route scopes (r7 §2 measured the detail
// surfaces by set-diff against r6, so r6 icons.json is the recorded source
// of their markups; #56) and emits one typed React SVG component per
// unique normalized markup into apps/web/src/icons/. Normalization drops
// width/height/class, so size and text-color class variants of the same
// glyph collapse. The NAME_TABLE below maps each normalized markup to a
// semantic component name; an unmapped markup fails the run so any new
// baseline icon forces an explicit naming decision.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ICONS_JSON = 'docs/research/assets/r7/icons.json';
// r6 detail-route scopes carry the detail-surface markups: r7 §2 measured
// those surfaces as a set-diff against r6, so r6 stays their recorded
// source. r7 covers every other surface.
const EXTRA_SCOPES_JSON = 'docs/research/assets/r6/icons.json';
const EXTRA_SCOPE_RE = /detail|更多/;
const OUT_DIR = 'apps/web/src/icons';

// The AI 审核 markup exists only as bitmap (r7 §6 records the button, not
// its svg); traced 1:1 from the r7 17 capture so regeneration keeps it.
// `trace` = per-icon provenance line for the generated header comment.
const EXTRA_ICONS = [
  {
    name: 'SearchPlus',
    size: [18, 18],
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"></circle><path d="M11 8v6"></path><path d="M8 11h6"></path><path d="M21 21l-4.3-4.3"></path></svg>',
    contexts: ['aria:AI 审核 (traced from r7 17)'],
    trace: 'a 1:1 trace of the r7 17 bitmap (r7 §6 records the control, not its markup)',
  },
  {
    // file-row 👁 in the diff pane (r5b §3.8 records the control, r7 27
    // shows the pixels: almond outline + center dot, x349..362 y93..102)
    name: 'Eye',
    size: [14, 14],
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"></path><circle cx="12" cy="12" r="3"></circle></svg>',
    contexts: ['diff file row (traced from r7 27)'],
    trace: 'a 1:1 trace of the r7 27 bitmap (r5b §3.8 records the control, not its markup)',
  },
  {
    // 编辑分配 row gear in the status-chip popover (r7 §6 leaves the
    // popover undumped; r7 19 shows the pixels: cog + hub, x299..313
    // y205..213 — lucide settings shape)
    name: 'Settings',
    size: [14, 14],
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle></svg>',
    contexts: ['chip popover 编辑分配 row (traced from r7 19)'],
    trace: 'a 1:1 trace of the r7 19 bitmap (r7 §6 leaves the popover undumped)',
  },
  {
    // tool-pill prefix in the transcript (r7 28: chevron + underscore,
    // x779..790 y556..565 — lucide terminal shape)
    name: 'Terminal',
    size: [12, 12],
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" x2="20" y1="19" y2="19"></line></svg>',
    contexts: ['transcript tool pill (traced from r7 28)'],
    trace: 'a 1:1 trace of the r7 28 bitmap (r5b §3.8 records the pill, not its markup)',
  },
  {
    // 筛选 funnel on the project 任务 toolbar (r2 24b/26; the r7 dump never
    // captured the project routes, so the markup is traced from the bitmap)
    name: 'Funnel',
    size: [14, 14],
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"></path></svg>',
    contexts: ['project 任务 toolbar (traced from r2 24b)'],
    trace: 'a 1:1 trace of the r2 24b bitmap (project routes predate the r7 dump)',
  },
  {
    // list view glyph of the 任务 toolbar view toggle (r2 26), paired with
    // the existing Grid2x2 grid glyph
    name: 'ListLines',
    size: [16, 16],
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" x2="20" y1="6" y2="6"></line><line x1="4" x2="20" y1="12" y2="12"></line><line x1="4" x2="20" y1="18" y2="18"></line></svg>',
    contexts: ['project 任务 view toggle (traced from r2 26)'],
    trace: 'a 1:1 trace of the r2 26 bitmap (project routes predate the r7 dump)',
  },
  {
    // repo share/export glyph top-right of the project 文件 tree pane
    // (r2 07e/24)
    name: 'Upload',
    size: [16, 16],
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"></path><polyline points="16 6 12 2 8 6"></polyline><line x1="12" x2="12" y1="2" y2="15"></line></svg>',
    contexts: ['project 文件 pane (traced from r2 07e)'],
    trace: 'a 1:1 trace of the r2 07e bitmap (project routes predate the r7 dump)',
  },
  {
    // avatar placeholder glyph on /app/project/new (r2 07): image frame
    // with dot + mountain
    name: 'ImageFrame',
    size: [24, 24],
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="9" cy="9" r="2"></circle><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L3 21"></path></svg>',
    contexts: ['project new avatar tile (traced from r2 07)'],
    trace: 'a 1:1 trace of the r2 07 bitmap (project routes predate the r7 dump)',
  },
  // Chief surfaces (issue #72): the r5 icon dump never scoped the drawer or
  // the 总管设置 view (r5/icons.json carries 12 chief-adjacent entries, none
  // of these glyphs), so all seven are 1:1 traces of the r5 100/101/111
  // bitmaps — same provenance class as the traced trio above.
  {
    name: 'ChiefHash',
    size: [13, 13],
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" x2="20" y1="9" y2="9"></line><line x1="4" x2="20" y1="15" y2="15"></line><line x1="10" x2="8" y1="3" y2="21"></line><line x1="16" x2="14" y1="3" y2="21"></line></svg>',
    contexts: ['chief drawer header thread glyph (traced from r5 100)'],
    trace: 'a 1:1 trace of the r5 100 bitmap header glyph',
  },
  {
    name: 'ChiefGear',
    size: [18, 18],
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle></svg>',
    contexts: ['aria:总管设置 (traced from r5 100)'],
    trace: 'a 1:1 trace of the r5 100 bitmap gear (lucide settings shape)',
  },
  {
    name: 'ChiefExpand',
    size: [16, 16],
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="8 4 4 4 4 8"></polyline><line x1="4" x2="11" y1="4" y2="11"></line><polyline points="16 20 20 20 20 16"></polyline><line x1="20" x2="13" y1="20" y2="13"></line></svg>',
    contexts: ['aria:全屏 (traced from r5 100)'],
    trace: 'a 1:1 trace of the r5 100 bitmap diagonal-arrows glyph',
  },
  {
    name: 'ChiefUserPlus',
    size: [16, 16],
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><line x1="19" x2="19" y1="8" y2="14"></line><line x1="22" x2="16" y1="11" y2="11"></line></svg>',
    contexts: ['chief example card 帮我组建 Agent 团队 (traced from r5 100)'],
    trace: 'a 1:1 trace of the r5 100 bitmap example glyph (lucide user-plus shape)',
  },
  {
    name: 'ChiefFolder',
    size: [16, 16],
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"></path></svg>',
    contexts: ['chief example card 帮我创建一个新项目 (traced from r5 100)'],
    trace: 'a 1:1 trace of the r5 100 bitmap example glyph (lucide folder shape)',
  },
  {
    // #1097 project files-pane folder rows（目录下钻）：与 ChiefFolder 同一
    // lucide folder 字形，走 #249 别名通道发第二个语义名——chief 面继续用
    // ChiefFolder，项目文件面不借 Chief* 名。
    name: 'Folder',
    size: [14, 14],
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"></path></svg>',
    contexts: ['project files pane folder row (#1097)'],
    trace: 'same lucide folder shape as the r5 100 trace (ChiefFolder alias, #249 path)',
  },
  {
    name: 'ChiefUserSolid',
    size: [24, 24],
    svg: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="12" cy="8" r="4"></circle><path d="M4 19c0-3.5 3.6-5.5 8-5.5s8 2 8 5.5v1.5H4Z"></path></svg>',
    contexts: ['chief stream user avatar (traced from r5 114)'],
    trace: 'a 1:1 trace of the r5 114 bitmap solid user avatar',
  },
  {
    name: 'RuntimePi',
    size: [12, 12],
    svg: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2 2h15v10h-5V7H2ZM2 7h5v5h5v5H7v5H2ZM17 12h5v10h-5Z"></path></svg>',
    contexts: ['chief model slot runtime mark (pi)', 'providers runtime tab 内置 (pi)'],
    trace:
      'the todos.dev providers runtime tab mark (DOM capture 2026-10-02); supersedes the ChiefPi bitmap trace, which misread the 10px r5 111 glyph',
  },
  {
    name: 'RuntimeClaudeCode',
    size: [12, 12],
    svg: '<svg viewBox="0 0 24 24" fill="#D97757"><path d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z"></path></svg>',
    contexts: ['chief model slot runtime mark (claude-code)', 'providers runtime tab Claude Code'],
    trace:
      'the todos.dev providers runtime tab Claude Code brand mark (DOM capture 2026-10-02, brand fill kept as captured)',
  },
  {
    // #828: the card 分支与 PR button switches off the download-arrow
    // glyph (which reads as "download" — todos.dev uses the same
    // download-arrow markup here, ego-browser DOM capture 2026-10-04, so
    // this diverges from the reference on purpose) to the lucide
    // git-branch shape.
    name: 'GitBranch',
    size: [13, 13],
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" x2="6" y1="3" y2="15"></line><circle cx="18" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><path d="M18 9a9 9 0 0 1-9 9"></path></svg>',
    contexts: ['card 分支与 PR button (lucide git-branch shape, #828)'],
    trace: 'lucide git-branch shape (ISC), adopted for #828',
  },
  {
    // ADR 0013 D3: the chief floating window's only dismiss is a Minimize
    // button (Minus glyph, no X) — Multica's chat-window minimize uses the
    // lucide minus shape (chat-window.tsx header, 2026-10-08 source read).
    name: 'Minus',
    size: [16, 16],
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"></path></svg>',
    contexts: ['chief window Minimize button (ADR 0013 D3)'],
    trace: 'lucide minus shape (ISC), adopted for ADR 0013 D3 (Multica chat-window minimize)',
  },
  {
    // #1009 A1: the registry MessageScrollerButton (jump-to-latest) renders
    // its own ArrowDownIcon from lucide-react inside the pristine file; the
    // consumption point overrides children with the repo icon + t() sr-only
    // label, so the repo seam needs the same lucide arrow-down shape.
    name: 'ArrowDown',
    size: [16, 16],
    svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"></path><path d="m19 12-7 7-7-7"></path></svg>',
    contexts: [
      'chief stream jump-to-latest button (#1009 A1, MessageScrollerButton children override)',
    ],
    trace: 'lucide arrow-down shape (ISC), the registry message-scroller default glyph',
  },
];

// D5 replacement batch (#249, 素材替换计划 D5): the five todos.dev custom
// marks its source audit flagged as the non-lucide legal-risk set — clock
// (定时) / key (密钥) / server (机器) / user (帐号) / task badge (dog-ear
// square + check) — are emitted from the official lucide package instead of
// the dump markup. lucide-static is the pinned generation source (ISC); the
// Thin variants keep their 1.75 stroke against lucide's default 2.
const LUCIDE_OVERRIDE = {
  Clock: { icon: 'clock' },
  ClockThin: { icon: 'clock', strokeWidth: '1.75' },
  Key: { icon: 'key' },
  KeyThin: { icon: 'key', strokeWidth: '1.75' },
  Server: { icon: 'server' },
  ServerThin: { icon: 'server', strokeWidth: '1.75' },
  UserCircle: { icon: 'circle-user' },
  FileCheck: { icon: 'square-check-big' },
  GitBranch: { icon: 'git-branch' },
};

const LUCIDE_DIR = fileURLToPath(new URL('../node_modules/lucide-static/icons/', import.meta.url));

/** Official lucide svg, license-comment prefix stripped for normalize(). */
function lucideSvg(name) {
  const raw = readFileSync(join(LUCIDE_DIR, `${name}.svg`), 'utf8');
  return raw.slice(raw.indexOf('<svg')).trim();
}

/** Attr names JSX renders in camelCase. */
const CAMEL = {
  'stroke-width': 'strokeWidth',
  'stroke-linecap': 'strokeLinecap',
  'stroke-linejoin': 'strokeLinejoin',
  'stroke-miterlimit': 'strokeMiterlimit',
  'fill-rule': 'fillRule',
  'clip-rule': 'clipRule',
};

const ATTR_RE = /([a-zA-Z0-9-]+)="([^"]*)"/g;

function parseAttrs(str) {
  const attrs = [];
  for (const m of str.matchAll(ATTR_RE)) {
    attrs.push([m[1], m[2]]);
  }
  return attrs;
}

/** Root svg: keep everything except width/height/class and the xmlns the
 * lucide-static files carry (inline JSX svg needs no namespace). */
function rootAttrs(svg) {
  const open = svg.match(/^<svg\s+([^>]*)>/);
  if (open == null) throw new Error('not an svg element');
  return parseAttrs(open[1]).filter(
    ([k]) => k !== 'width' && k !== 'height' && k !== 'class' && k !== 'xmlns',
  );
}

/** Inner children markup, verbatim. */
function innerMarkup(svg) {
  const open = svg.match(/^<svg\s+[^>]*>/);
  return svg.slice(open[0].length, -6);
}

/** Attr list → JSX attribute string (drops class, camelCase hyphens). */
function attrsToJsx(attrs) {
  return attrs
    .filter(([k]) => k !== 'class')
    .map(([k, v]) => (CAMEL[k] ? `${CAMEL[k]}="${v}"` : `${k}="${v}"`))
    .join(' ');
}

/** JSX-ify a child element: camelCase hyphenated attr names, drop class. */
function toJsx(element) {
  const m = element.match(/^<([a-zA-Z]+)\s*([^>]*?)\/?>/);
  if (m == null) throw new Error(`unparsable element: ${element}`);
  const [, tag, attrStr] = m;
  const attrs = attrsToJsx(parseAttrs(attrStr));
  return `<${tag}${attrs ? ` ${attrs}` : ''} />`;
}

function normalize(svg) {
  const children = innerMarkup(svg)
    // outerHTML keeps explicit closing tags; collapse to self-closing form
    .replace(/<\/[a-zA-Z]+>/g, '')
    .split(/(?=<[a-zA-Z])/)
    .filter((s) => s.trim() !== '')
    .map((s) => toJsx(s.trim()));
  return { attrs: rootAttrs(svg), children };
}

const entries = JSON.parse(readFileSync(ICONS_JSON, 'utf8'));
const extraEntries = JSON.parse(readFileSync(EXTRA_SCOPES_JSON, 'utf8')).filter((e) =>
  EXTRA_SCOPE_RE.test(e.route ?? ''),
);
const uniq = new Map(); // normalized markup string -> { attrs, children, size, contexts }
for (const [src, e] of [...entries.map((e) => ['r7', e]), ...extraEntries.map((e) => ['r6', e])]) {
  const n = normalize(e.svg);
  const key = JSON.stringify([n.attrs, n.children]);
  if (!uniq.has(key)) {
    uniq.set(key, { ...n, size: [e.w, e.h], count: 0, contexts: [], source: src });
  }
  const u = uniq.get(key);
  u.count += 1;
  u.contexts.push(e.context ?? e.route);
}

for (const x of EXTRA_ICONS) {
  const n = normalize(x.svg);
  const key = JSON.stringify([n.attrs, n.children]);
  const existing = uniq.get(key);
  if (existing != null && existing.name !== x.name) {
    // Same glyph under a second semantic name (the chip-popover 编辑分配
    // gear and the chief 总管设置 gear are both the lucide settings shape):
    // emit an alias component instead of letting the later set() silently
    // drop the earlier name (#249 regeneration surfaced the collision).
    // hashKey keeps both headers at the shared markup hash.
    uniq.set(`${key}::alias-${x.name}`, {
      ...n,
      size: x.size,
      count: 1,
      contexts: x.contexts,
      source: 'trace',
      trace: x.trace,
      name: x.name,
      hashKey: key,
    });
    continue;
  }
  uniq.set(key, {
    ...n,
    size: x.size,
    count: 1,
    contexts: x.contexts,
    source: 'trace',
    trace: x.trace,
    name: x.name,
  });
}

// Dump glyphs whose only UI entry point was removed but whose markup still
// records in the r7 dump: pruned so regeneration stays idempotent with the
// tree (#121 removed the 安装 App sidebar entry and its Smartphone component
// by hand; #304 removed the two 语音输入 toolbar buttons — composer + new
// task dialog, 08 册 C5 — and the Mic component by hand; #363 removed the
// 看板指南 topbar button and its HelpCircle component; without this list
// every regeneration resurrects them).
// Caveat: the block is by component NAME — a future legitimate reintroduction
// of a same-named icon is silently dropped from the emit; remove the name
// from PRUNED first or the new icon never reaches the tree.
const PRUNED = new Set(['Smartphone', 'Mic', 'HelpCircle']);

const sorted = [...uniq.entries()].sort((a, b) => b[1].count - a[1].count);

if (process.argv.includes('--list')) {
  for (const [key, u] of sorted) {
    const hash = createHash('sha1')
      .update(u.hashKey ?? key)
      .digest('hex')
      .slice(0, 10);
    console.log(
      `#${hash} size=${u.size} count=${u.count} ctx=${u.contexts.slice(0, 2).join(' | ')}`,
    );
    console.log(`  attrs: ${attrsToJsx(u.attrs)}`);
    console.log(`  children: ${u.children.join(' ')}`);
  }
  process.exit(0);
}

const NAME_TABLE = JSON.parse(readFileSync(new URL('./icon-names.json', import.meta.url), 'utf8'));

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

const usedNames = new Set();
const exports = [];
for (const [key, u] of sorted) {
  const hash = createHash('sha1')
    .update(u.hashKey ?? key)
    .digest('hex')
    .slice(0, 10);
  const name = u.name ?? NAME_TABLE[hash];
  if (name == null) {
    console.error(`unmapped icon markup #${hash} — add to scripts/icon-names.json`);
    console.error(`  contexts: ${u.contexts.join(' | ')}`);
    console.error(`  children: ${u.children.join(' ')}`);
    process.exit(1);
  }
  if (PRUNED.has(name)) continue;
  const pascal = name[0].toUpperCase() + name.slice(1);
  if (usedNames.has(pascal)) throw new Error(`duplicate component name ${pascal}`);
  usedNames.add(pascal);

  const override = LUCIDE_OVERRIDE[name];
  if (override != null) {
    const lucide = normalize(lucideSvg(override.icon));
    u.attrs = lucide.attrs.map(([k, v]) =>
      k === 'stroke-width' && override.strokeWidth != null ? [k, override.strokeWidth] : [k, v],
    );
    u.children = lucide.children;
  }

  const [w, h] = u.size;
  const from =
    override != null
      ? `lucide-static icon \`${override.icon}\` (ISC; D5 replacement of the todos.dev custom mark, #249)`
      : u.source === 'trace'
        ? u.trace
        : `docs/research/assets/${u.source}/icons.json`;
  const file = `// Generated by scripts/generate-icons.mjs from ${from} (#${hash}, seen ${u.count}×: ${u.contexts.slice(0, 3).join(' | ')}). Do not edit.
import type { SVGProps } from 'react';

export function ${pascal}({ width = ${w}, height = ${h}, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg aria-hidden="true" width={width} height={height} ${attrsToJsx(u.attrs)} {...props}>
${u.children.map((c) => `      ${c}`).join('\n')}
    </svg>
  );
}
`;
  writeFileSync(join(OUT_DIR, `${name}.tsx`), file);
  exports.push(`export { ${pascal} } from './${name}.js';`);
}

writeFileSync(
  join(OUT_DIR, 'index.ts'),
  `// Generated by scripts/generate-icons.mjs. Do not edit.
${exports.sort().join('\n')}
`,
);

// emit Biome-stable formatting so regeneration keeps `biome ci` green
const formatted = spawnSync('pnpm', ['exec', 'biome', 'check', '--write', OUT_DIR], {
  encoding: 'utf8',
});
if (formatted.status !== 0) {
  console.error(`biome check --write failed:\n${formatted.stdout}\n${formatted.stderr}`);
  process.exit(1);
}

console.log(`wrote ${usedNames.size} icon components to ${OUT_DIR}`);
