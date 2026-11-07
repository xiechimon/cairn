import { center, hoverAcross, press, sleep, typeSlow, wheel } from './common.mjs';

export const baseUrl = 'https://claude.ai';

const sidebarRows = (page) =>
  page.locator(
    'aside a[href^="/chat/"], aside a[href="/projects"], aside a[href^="/cowork/projects"], aside a[href="/artifacts"]',
  );
const composer = (page) => page.locator('[contenteditable="true"]').first();
const modelButton = (page) => page.locator('button[aria-label^="Model"]').first();
const jumpButton = (page) => page.locator('button[aria-label="Scroll to bottom"]').first();
const transcript = (page) => page.locator('main').first();
const testChat = (page) =>
  page.locator('a[href^="/chat/"]', { hasText: 'Binary search explanation' }).first();
const sidebarToggle = (page) => page.locator('button[aria-label*="sidebar" i]').first();
const panelToggle = async (page) => {
  const share = page.locator('button', { hasText: 'Share' }).first();
  const [sx, sy] = await center(share);
  const buttons = page.locator('button');
  const n = await buttons.count();
  let best;
  for (let i = 0; i < n; i++) {
    const box = await buttons.nth(i).boundingBox();
    if (!box || Math.abs(box.y + box.height / 2 - sy) > 6 || box.x + box.width > sx - 30) continue;
    if (!best || box.x > best.box.x) best = { i, box };
  }
  if (!best) throw new Error('panel toggle not found');
  return buttons.nth(best.i);
};

const openTestChat = async (page) => {
  if (process.env.CLAUDE_TEST_CHAT) {
    await page.goto(baseUrl + process.env.CLAUDE_TEST_CHAT);
    await page.waitForSelector('[data-testid="user-message"]', { timeout: 30000 });
    return;
  }
  await page.goto(`${baseUrl}/new`);
  await page.waitForSelector('a[href^="/chat/"]', { timeout: 30000 });
  const href = await testChat(page).getAttribute('href');
  if (!href) throw new Error('test chat missing');
  await page.goto(baseUrl + href);
  await page.waitForSelector('[data-testid="user-message"]', { timeout: 30000 });
};

const prompt =
  'Design capture test: explain binary search in about 500 words, with two headings, a Python code block, a three-row table, a bulleted list and one blockquote.';

export const journeys = {
  shell: {
    url: '/new',
    watch: ['aside', '[role="menu"]', '[role="dialog"]', '[role="tooltip"]'],
    ready: (page) => page.waitForSelector('[contenteditable="true"]', { timeout: 30000 }),
    steps: [
      {
        label: 'hover-sidebar-rows',
        run: async (page, c) => {
          if (c.mobile) {
            await press(page, sidebarToggle(page), 120, c);
            await sleep(900);
          }
          await hoverAcross(page, sidebarRows(page), 6);
        },
        settle: 600,
        dump: true,
      },
      {
        label: 'close-drawer',
        run: async (page, c) => {
          if (c.mobile) await page.keyboard.press('Escape');
        },
        settle: 900,
      },
      {
        label: 'hover-composer-plus',
        run: async (page) =>
          hoverAcross(page, page.locator('button[aria-label*="Add" i]').first(), 1, 1200),
        settle: 400,
      },
      {
        label: 'press-composer-plus',
        run: (page, c) => press(page, page.locator('button[aria-label*="Add" i]').first(), 220, c),
        settle: 900,
        dump: true,
      },
      { label: 'close-plus-menu', run: (page) => page.keyboard.press('Escape'), settle: 800 },
      {
        label: 'type-composer',
        run: async (page) => {
          await composer(page).click();
          await typeSlow(page, 'How should a sidebar row respond to hover?');
        },
        settle: 600,
        dump: true,
      },
      {
        label: 'clear-composer',
        run: async (page) => {
          await page.keyboard.press('Control+A');
          await page.keyboard.press('Backspace');
        },
        settle: 600,
      },
      {
        label: 'open-model-menu',
        run: (page, c) => press(page, modelButton(page), 150, c),
        settle: 900,
        dump: true,
      },
      {
        label: 'hover-model-menu',
        run: (page) => hoverAcross(page, page.locator('[role="menu"] [role^="menuitem"]'), 4),
        settle: 400,
      },
      { label: 'close-model-menu', run: (page) => page.keyboard.press('Escape'), settle: 900 },
      {
        label: 'collapse-sidebar',
        run: (page, c) => press(page, sidebarToggle(page), 120, c),
        settle: 1200,
        dump: true,
      },
      {
        label: 'expand-sidebar',
        run: (page, c) => press(page, sidebarToggle(page), 120, c),
        settle: 1200,
      },
      {
        label: 'open-settings-dialog',
        run: (page) =>
          page.evaluate(() => {
            location.hash = 'settings/general';
          }),
        settle: 1500,
        dump: true,
      },
      {
        label: 'close-settings-dialog',
        run: (page) => page.keyboard.press('Escape'),
        settle: 1200,
      },
    ],
  },
  'chat-long': {
    url: '/new',
    watch: ['main', 'button[aria-label="Scroll to bottom"]', 'aside', '[role="tooltip"]'],
    ready: openTestChat,
    steps: [
      {
        label: 'scroll-up',
        run: (page) => wheel(page, transcript(page), -2400),
        settle: 1000,
        rescan: true,
        dump: true,
      },
      {
        label: 'hover-jump',
        run: (page) => hoverAcross(page, jumpButton(page), 1, 900),
        settle: 300,
      },
      {
        label: 'jump-to-latest',
        run: (page, c) => press(page, jumpButton(page), 120, c),
        settle: 1500,
        dump: true,
      },
      {
        label: 'hover-reply-actions',
        run: (page) =>
          hoverAcross(
            page,
            page.locator('button[aria-label="Copy"], button[aria-label="Retry"]'),
            5,
          ),
        settle: 600,
      },
      { label: 'scroll-to-code', run: (page) => wheel(page, transcript(page), -900), settle: 800 },
      {
        label: 'hover-code-block',
        run: (page) => hoverAcross(page, page.locator('pre').first(), 1, 1200),
        settle: 400,
        dump: true,
      },
      {
        label: 'open-side-panel',
        run: async (page, c) => press(page, await panelToggle(page), 120, c),
        settle: 1200,
        dump: true,
      },
      {
        label: 'close-side-panel',
        run: async (page, c) => press(page, await panelToggle(page), 120, c),
        settle: 1200,
      },
    ],
  },
  'send-stream': {
    url: '/new',
    watch: ['main', 'button[aria-label="Scroll to bottom"]', '[data-testid="user-message"]'],
    textWatch: ['.font-claude-response'],
    ready: (page) => page.waitForSelector('[contenteditable="true"]', { timeout: 30000 }),
    steps: [
      {
        label: 'type-prompt',
        run: async (page) => {
          await composer(page).click();
          await typeSlow(page, prompt, 25);
        },
        settle: 500,
      },
      {
        label: 'send',
        run: (page) => page.keyboard.press('Enter'),
        settle: 4000,
        rescan: true,
        dump: true,
      },
      { label: 'stream', run: () => sleep(14000), settle: 200, rescan: true, dump: true },
      {
        label: 'scroll-up-during-stream',
        run: (page) => wheel(page, transcript(page), -1200),
        settle: 3000,
      },
      { label: 'wait-done', run: () => sleep(25000), settle: 500, dump: true },
      {
        label: 'jump-after-stream',
        run: (page, c) => press(page, jumpButton(page), 120, c),
        settle: 1500,
      },
    ],
  },
  settings: {
    url: '/new#settings/general',
    watch: ['[role="dialog"]', '[role="listbox"]', '[role="menu"]'],
    ready: (page) =>
      page.getByText('Appearance', { exact: true }).first().waitFor({ timeout: 30000 }),
    steps: [
      { label: 'settle-dialog', run: () => sleep(1500), settle: 200, dump: true },
      {
        label: 'hover-nav',
        run: (page) =>
          hoverAcross(page, page.locator('[role="dialog"] nav button, [role="dialog"] nav a'), 8),
        settle: 400,
      },
      {
        label: 'nav-page-1',
        run: (page, c) =>
          press(
            page,
            page.getByRole('button', { name: 'Notifications', exact: true }).first(),
            120,
            c,
          ),
        settle: 1500,
        dump: true,
      },
      {
        label: 'nav-page-2',
        run: (page, c) =>
          press(
            page,
            page.getByRole('button', { name: 'Capabilities', exact: true }).first(),
            120,
            c,
          ),
        settle: 1500,
        dump: true,
      },
      {
        label: 'nav-appearance',
        run: (page, c) =>
          press(
            page,
            page.getByRole('button', { name: 'Appearance', exact: true }).first(),
            120,
            c,
          ),
        settle: 1500,
      },
      {
        label: 'open-select',
        run: (page, c) =>
          press(page, page.locator('button').filter({ hasText: 'Narrow' }).first(), 120, c),
        settle: 900,
        dump: true,
      },
      { label: 'close-select', run: (page) => page.keyboard.press('Escape'), settle: 800 },
      {
        label: 'scroll-settings',
        run: (page) => wheel(page, page.locator('[role="dialog"]').first(), 600),
        settle: 800,
      },
      { label: 'close-dialog', run: (page) => page.keyboard.press('Escape'), settle: 1200 },
    ],
  },
  artifact: {
    url: '/new',
    watch: ['main', 'aside', '[role="dialog"]'],
    textWatch: ['.font-claude-response'],
    ready: (page) => page.waitForSelector('[contenteditable="true"]', { timeout: 30000 }),
    steps: [
      {
        label: 'type-artifact-prompt',
        run: async (page) => {
          await composer(page).click();
          await typeSlow(
            page,
            'Design capture test: make a small HTML artifact, a to-do list with three items and a checkbox each.',
            20,
          );
        },
        settle: 400,
      },
      {
        label: 'send-artifact',
        run: (page) => page.keyboard.press('Enter'),
        settle: 3000,
        rescan: true,
      },
      { label: 'artifact-stream', run: () => sleep(40000), settle: 1000, dump: true },
      {
        label: 'hover-artifact-card',
        run: (page) =>
          hoverAcross(
            page,
            page
              .locator('main button, main [role="button"]')
              .filter({ hasText: /to-do|todo|list/i }),
            1,
            900,
          ),
        settle: 400,
      },
      {
        label: 'close-artifact-panel',
        run: async (page) => {
          const close = page.locator('button[aria-label*="Close" i]').last();
          await close.click();
        },
        settle: 1500,
        dump: true,
      },
      {
        label: 'open-artifact-panel',
        run: async (page, c) =>
          press(
            page,
            page
              .locator('main button, main [role="button"]')
              .filter({ hasText: /to-do|todo|list/i })
              .first(),
            120,
            c,
          ),
        settle: 1500,
        dump: true,
      },
    ],
  },
  'tool-search': {
    url: '/new',
    watch: ['main'],
    textWatch: ['.font-claude-response'],
    ready: (page) => page.waitForSelector('[contenteditable="true"]', { timeout: 30000 }),
    steps: [
      {
        label: 'type-search-prompt',
        run: async (page) => {
          await composer(page).click();
          await typeSlow(
            page,
            'Design capture test: search the web for when the next full moon is and cite one source in two sentences.',
            20,
          );
        },
        settle: 400,
      },
      {
        label: 'send-search',
        run: (page) => page.keyboard.press('Enter'),
        settle: 3000,
        rescan: true,
        dump: true,
      },
      { label: 'tool-running', run: () => sleep(8000), settle: 200, dump: true },
      { label: 'tool-done', run: () => sleep(25000), settle: 500, dump: true },
      {
        label: 'hover-tool-block',
        run: (page) =>
          hoverAcross(
            page,
            page.locator('main [role="button"]').filter({ hasText: /Web search/, visible: true }),
            1,
            900,
          ),
        settle: 300,
      },
      {
        label: 'expand-tool-block',
        run: (page, c) =>
          press(
            page,
            page
              .locator('main [role="button"]')
              .filter({ hasText: /Web search/, visible: true })
              .first(),
            120,
            c,
          ),
        settle: 1500,
        dump: true,
      },
      {
        label: 'collapse-tool-block',
        run: (page, c) =>
          press(
            page,
            page
              .locator('main [role="button"]')
              .filter({ hasText: /Web search/, visible: true })
              .first(),
            120,
            c,
          ),
        settle: 1500,
      },
    ],
  },
  'search-palette': {
    url: '/new',
    watch: ['[role="dialog"]', '[role="listbox"]', '[role="option"]'],
    ready: (page) => page.waitForSelector('[contenteditable="true"]', { timeout: 30000 }),
    steps: [
      {
        label: 'open-palette',
        run: (page) => page.keyboard.press('Control+K'),
        settle: 1200,
        dump: true,
      },
      {
        label: 'type-query',
        run: (page) => typeSlow(page, 'binary', 90),
        settle: 1500,
        dump: true,
      },
      {
        label: 'hover-results',
        run: (page) =>
          hoverAcross(page, page.locator('[role="dialog"] [role="option"], [role="dialog"] a'), 5),
        settle: 400,
      },
      {
        label: 'arrow-results',
        run: async (page) => {
          for (let i = 0; i < 3; i++) {
            await page.keyboard.press('ArrowDown');
            await sleep(250);
          }
        },
        settle: 600,
      },
      { label: 'close-palette', run: (page) => page.keyboard.press('Escape'), settle: 1200 },
    ],
  },
  focus: {
    url: '/new',
    watch: [],
    ready: (page) => page.waitForSelector('[contenteditable="true"]', { timeout: 30000 }),
    steps: Array.from({ length: 8 }, (_, i) => ({
      label: `tab-${i + 1}`,
      run: (page) => page.keyboard.press('Tab'),
      settle: 500,
      dump: i < 4,
    })),
  },
  projects: {
    url: '/projects',
    watch: ['main'],
    ready: (page) => page.waitForSelector('h1', { timeout: 30000 }),
    steps: [
      {
        label: 'hover-cards',
        run: (page) => hoverAcross(page, page.locator('main a[href*="project"]'), 4, 500),
        settle: 400,
        dump: true,
      },
      {
        label: 'hover-primary',
        run: (page) =>
          hoverAcross(page, page.locator('main button', { hasText: 'New project' }), 1, 900),
        settle: 400,
      },
      {
        label: 'press-primary',
        run: async (page) => {
          const b = page.locator('main button', { hasText: 'New project' }).first();
          const [x, y] = await center(b);
          await page.mouse.move(x, y);
          await page.mouse.down();
          await sleep(250);
          await page.mouse.move(2, 2, { steps: 3 });
          await page.mouse.up();
        },
        settle: 800,
      },
    ],
  },
};

export const roles = {
  'shell.sidebar': 'aside',
  'shell.main': 'main',
  'shell.header': 'header',
  'sidebar.navrow':
    'aside a[href="/new"], aside a[href="/projects"], aside a[href^="/cowork/projects"], aside a[href="/artifacts"], aside a[href="/customize"]',
  'sidebar.row': 'aside a[href^="/chat/"]',
  'sidebar.row.fill': 'aside a[href^="/chat/"] >>filled',
  'sidebar.section': 'aside button[aria-expanded]',
  'sidebar.footer': 'aside button[aria-haspopup]',
  'home.greeting': 'main h1, main h2',
  'composer.input': '[contenteditable="true"]',
  'composer.box': '[contenteditable="true"] >>rounded',
  'composer.button':
    'button[aria-label*="Add" i], button[aria-label*="voice" i], button[aria-label="Dictate"]',
  'composer.model': 'button[aria-label^="Model"]',
  'message.user': '[data-testid="user-message"]',
  'message.user.bubble': '[data-testid="user-message"] >>filled',
  'message.reply': '.font-claude-response',
  'message.reply.p': '.font-claude-response p',
  'message.reply.heading':
    '.font-claude-response h1, .font-claude-response h2, .font-claude-response h3',
  'message.reply.li': '.font-claude-response li',
  'message.reply.strong': '.font-claude-response strong',
  'message.actions.button':
    'button[aria-label="Copy"], button[aria-label="Retry"], button[aria-label="Good response"]',
  'code.block': 'pre',
  'code.block.box': 'pre >>filled',
  'code.inline': '.font-claude-response p code, .font-claude-response li code',
  'table.th': 'th',
  'table.td': 'td',
  blockquote: 'blockquote',
  jump: 'button[aria-label="Scroll to bottom"]',
  menu: '[role="menu"]',
  'menu.item': '[role="menu"] [role^="menuitem"]',
  'menu.separator': '[role="menu"] [role="separator"]',
  dialog: '[role="dialog"]',
  'dialog.navitem': '[role="dialog"] nav button, [role="dialog"] nav a',
  'dialog.input': '[role="dialog"] input',
  'dialog.select': '[role="dialog"] button[aria-haspopup]',
  'dialog.switch': '[role="dialog"] [role="switch"]',
  'dialog.radiogroup': '[role="dialog"] [role="radiogroup"]',
  tooltip: '[role="tooltip"]',
  listbox: '[role="listbox"]',
  'panel.side': 'aside:not(:first-of-type)',
  'button.primary': 'main button',
  'project.card': 'main a[href*="project"] >>rounded',
};
