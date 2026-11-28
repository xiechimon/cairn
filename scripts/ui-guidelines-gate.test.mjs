import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkUiGuidelines } from './ui-guidelines-gate.mjs';

const CLEAN_FIXTURES = {
  'apps/web/index.html':
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />',
  'apps/web/design.html':
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />',
  'apps/web/src/styles/app.css': `
html {
  -webkit-text-size-adjust: 100%;
  scroll-padding-block-start: 4rem;
  text-autospace: normal;
}
h1, h2, h3 {
  text-wrap: balance;
  scroll-margin-top: 4rem;
}
button {
  touch-action: manipulation;
  user-select: none;
}
::selection {
  background: color-mix(in oklab, var(--accent) 26%, transparent);
}
[role="dialog"] {
  overscroll-behavior: contain;
}
a img {
  -webkit-user-drag: none;
}
@media (pointer: fine) {
  body {
    overscroll-behavior: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 0.01ms !important; }
}
`,
  'apps/web/src/styles/shadcn.css': `
:root { color-scheme: dark; }
.light { color-scheme: light; }
`,
  'apps/web/src/theme.ts': `
export function paintTheme(theme) {
  const root = document.documentElement;
  root.style.colorScheme = theme;
}
`,
  'apps/web/src/components/ui/input.tsx': `
export function Input({ type, ...props }) {
  return <input type={type} {...props} />;
}
`,
  'apps/web/src/form.tsx': `
export function LoginForm() {
  return <Input type="password" spellCheck={false} />;
}
`,
  'apps/web/src/detail/code.tsx': `
export function CodeView({ text }) {
  return <pre translate="no"><code translate="no">{text}</code></pre>;
}
`,
  'apps/web/src/i18n/en.ts': `
export const EN = {
  '处理中…': 'Working on it…',
  '附件超过 10 MB 上限': 'Attachment exceeds the 10 MB limit',
};
`,
  'apps/desktop/src/app-menu.ts': `
const LABELS = {
  zh: {
    downloadingUpdate: (v, p) => \`正在下载更新 \${v}（\${p}%）\`,
  },
};
`,
  'apps/desktop/src/offline-page.ts': `
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
:root { color-scheme: light; }
@media (prefers-color-scheme: dark) { :root { color-scheme: dark; } }
body { min-height: 100dvh; }
button { touch-action: manipulation; user-select: none; }
button:focus-visible { outline: 2px solid #c27829; }
<p class="status" role="status"></p>
`,
};

function rulesFor(overrides) {
  return checkUiGuidelines({
    files: { ...CLEAN_FIXTURES, ...overrides },
    isolated: true,
  }).violations.map((v) => v.rule);
}

test('clean fixtures pass with zero violations', () => {
  assert.deepEqual(rulesFor({}), []);
});

const NEGATIVE_CASES = [
  ['A2', { 'apps/web/src/page.tsx': '<button className="outline-none">Click</button>' }],
  ['A7', { 'apps/web/src/page.tsx': '<div onClick={run}>Go</div>' }],
  ['C5', { 'apps/web/src/page.ts': 'toast.error("Error: 500");' }],
  ['C5', { 'apps/web/src/page.ts': 'toast.error(t("Error: 500"));' }],
  ['C5', { 'apps/web/src/page.ts': 'toast.error(t("Failed"), { description: t("Error: 500") });' }],
  [
    'C38',
    {
      'apps/web/src/styles/app.css': CLEAN_FIXTURES['apps/web/src/styles/app.css'].replace(
        'touch-action: manipulation;',
        '',
      ),
    },
  ],
  ['C38', { 'apps/web/src/chat.tsx': '<div className="overflow-y-auto overscroll-none" />' }],
  ['C38', { 'apps/web/src/chat.tsx': '<div className="overflow-y-auto md:overscroll-none" />' }],
  ['C39', { 'apps/web/src/page.tsx': '<img src="/a.png" />' }],
  [
    'C40',
    {
      'apps/web/src/styles/app.css': CLEAN_FIXTURES['apps/web/src/styles/app.css'].replace(
        'text-wrap: balance;',
        '',
      ),
    },
  ],
  [
    'C40',
    {
      'apps/web/src/styles/app.css': `${CLEAN_FIXTURES['apps/web/src/styles/app.css']}\nbutton, a { user-select: none; }\n`,
    },
  ],
  ['C41', { 'apps/web/src/form.tsx': 'export const F = () => <Input type="password" />;' }],
  [
    'C42',
    {
      'apps/web/design.html':
        '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    },
  ],
  ['C44', { 'apps/web/src/hotkeys.ts': "window.addEventListener('keydown', (e) => run(e.key));" }],
  [
    'C44',
    {
      'apps/web/src/hotkeys.tsx': [
        'const onKey = (e) => { run(e.key); };',
        "window.addEventListener('keydown', onKey);",
        'export const Box = () => <input />;',
      ].join('\n'),
    },
  ],
  [
    'C44',
    {
      'apps/web/src/hotkeys-log.ts':
        "window.addEventListener('keydown', (e) => { console.log(e.target.tagName); run(e.key); });",
    },
  ],
  [
    'C44',
    {
      'apps/web/src/hotkeys-closest.ts':
        "window.addEventListener('keydown', (e) => { if (e.target.closest('.panel')) run(e.key); });",
    },
  ],
  [
    'C45',
    {
      'apps/desktop/src/app-menu.ts':
        'const LABELS = {\n  zh: {\n    downloading: () => "正在下载更新 (50%)",\n  },\n};',
    },
  ],
  [
    'T1',
    {
      'apps/web/src/i18n/en.ts':
        "export const EN = {\n  '请重试 loading': 'Please retry loading',\n};",
    },
  ],
  ['T6', { 'apps/web/src/detail/code.tsx': 'export const C = () => <pre>x</pre>;' }],
  [
    'T6',
    { 'apps/web/src/components/chat/trace-parts.tsx': 'export const T = () => <pre>x</pre>;' },
  ],
  [
    'T7',
    {
      'apps/web/src/i18n/en.ts':
        "export const EN = {\n  '处理中...': 'Working on it...',\n  '附件超过 10MB 上限': 'Attachment exceeds 10 MB',\n};",
    },
  ],
  ['V31', { 'apps/web/src/page.tsx': '<span className="font-light">Text</span>' }],
  ['C5', { 'apps/web/src/page.ts': "import { toast } from 'sonner';" }],
  [
    'C5',
    {
      'apps/web/src/picker.tsx':
        'export const P = ({ device }) => <p>{t("Open the link")} {device.verificationUri} {device.userCode}</p>;',
    },
  ],
  ['C5', { 'apps/web/src/page.ts': 'toastError(describeError(err, t) ?? t("Failed"), err);' }],
  ['C5', { 'apps/web/src/page.ts': 'toast.error(t("Failed"), { description: err.message });' }],
  [
    'C5',
    {
      'apps/web/src/picker.tsx':
        'export const P = ({ device }) => { const { userCode } = device; return <code>{userCode}</code>; };',
    },
  ],
  ['C5', { 'apps/web/src/page.ts': 'toast.error (t("Failed"), { description: err.message });' }],
  ['C5', { 'apps/web/src/api.ts': 'const save = useMutation({ mutationFn: () => post() });' }],
  [
    'C5',
    { 'apps/web/src/api.ts': 'const save = useMutation(\n  { mutationFn: () => post() },\n);' },
  ],
  [
    'C5',
    {
      'apps/web/src/api.ts':
        "const save = useMutation({ meta: { action: '保存不存在的东西' }, mutationFn: () => post() });",
    },
  ],
];

test('the shared sign-in view, toaster and labelled mutations pass C5', () => {
  assert.deepEqual(
    rulesFor({
      'apps/web/src/components/ui/toaster.tsx': "import { toast as sonnerToast } from 'sonner';",
      'apps/web/src/components/sign-in-view.tsx':
        'export const V = ({ device }) => <code>{device.userCode}</code>;',
      'apps/web/src/api.ts':
        "const save = useMutation({ meta: { action: '处理中…' }, mutationFn: () => post() });",
      'apps/web/src/page.ts':
        'toastError(t("Failed"), err); toast.error(t("Failed"), { description: describeError(err, t, { serverText: false }) }); toast.dismiss(item.message);',
    }),
    [],
  );
});

for (const [rule, overrides] of NEGATIVE_CASES) {
  test(`rule ${rule} rejects its negative fixture`, () => {
    assert.ok(
      rulesFor(overrides).includes(rule),
      `expected rule ${rule} in ${JSON.stringify(rulesFor(overrides))}`,
    );
  });
}

test('non-toast configuration description ending in parentheses does not trigger C5', () => {
  assert.deepEqual(
    rulesFor({
      'apps/web/src/page.ts':
        "export const ITEM = { title: 'Connect', description: 'Connect to work (optional)' };",
    }),
    [],
  );
});

test('multiline CSS comment does not shift reported line numbers', () => {
  const css = [
    CLEAN_FIXTURES['apps/web/src/styles/app.css'].trimEnd(),
    '/*',
    ' * line 2 of comment',
    ' * line 3 of comment',
    ' */',
    'button, a { user-select: none; }',
  ].join('\n');
  const expectedLine = css.split('\n').length;
  const hit = checkUiGuidelines({
    files: { ...CLEAN_FIXTURES, 'apps/web/src/styles/app.css': css },
    isolated: true,
  }).violations.find((v) => v.rule === 'C40');
  assert.equal(hit?.line, expectedLine);
});
