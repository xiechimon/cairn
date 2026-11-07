import { hoverAcross, press, sleep, typeSlow, wheel } from './common.mjs';

export const themeStorageKey = 'cairn-theme';

export const baseUrl = process.env.CAIRN_CAPTURE_BASE ?? 'http://127.0.0.1:5273';

const sidebarRows = (page) =>
  page.locator(
    '[data-slot="sidebar-nav-row"], [data-slot="sidebar-thread-row"], [data-slot="sidebar-project-row"]',
  );
const composer = (page) => page.locator('[data-testid="chief-composer-block"] textarea').first();
const transcript = (page) => page.locator('[data-slot="message-scroller-viewport"]').first();
const jumpButton = (page) => page.locator('[data-slot="message-scroller-jump"]').first();
const sidebarToggle = (page) =>
  page.locator('button[aria-label*="sidebar" i], button[aria-label*="侧栏"]').first();
const menuTrigger = (page) =>
  page.locator('[data-testid="chief-composer-block"] [data-slot="dropdown-menu-trigger"]').first();
const settingsButton = (page) => page.locator('[data-testid="sidebar-settings"]').first();
const settingsNav = (page, text) =>
  page
    .locator('a, button')
    .filter({ hasText: new RegExp(`^\\s*${text}`) })
    .first();

export const journeys = {
  shell: {
    url: '/app?scenario=chief-md',
    watch: ['aside', '[role="menu"]', '[role="dialog"]', '[role="tooltip"]'],
    ready: (page) =>
      page.waitForSelector('[data-testid="chief-composer-block"]', { timeout: 30000 }),
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
        run: (page) =>
          hoverAcross(
            page,
            page.locator('[data-testid="chief-composer-block"] button').first(),
            1,
            1200,
          ),
        settle: 400,
      },
      {
        label: 'press-composer-plus',
        run: (page, c) =>
          press(page, page.locator('[data-testid="chief-composer-block"] button').first(), 220, c),
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
        run: (page, c) => press(page, menuTrigger(page), 150, c),
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
        run: (page, c) => press(page, settingsButton(page), 120, c),
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
    url: '/app?scenario=chief-scroll-long',
    watch: [
      '[data-slot="message-scroller"]',
      '[data-slot="message-scroller-jump"]',
      '[role="tooltip"]',
      'aside',
    ],
    ready: (page) =>
      page.waitForSelector('[data-slot="message-scroller-viewport"]', { timeout: 30000 }),
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
        run: (page) => hoverAcross(page, page.locator('[data-testid="chief-msg-tools"] button'), 5),
        settle: 600,
      },
      { label: 'scroll-to-code', run: (page) => wheel(page, transcript(page), -900), settle: 800 },
      {
        label: 'hover-code-block',
        run: (page) => hoverAcross(page, page.locator('[data-testid="md-code"]').first(), 1, 1200),
        settle: 400,
        dump: true,
      },
      {
        label: 'open-side-panel',
        run: (page, c) =>
          press(page, page.locator('button', { hasText: 'View thread' }).first(), 120, c),
        settle: 1200,
        dump: true,
      },
      { label: 'close-side-panel', run: (page) => page.keyboard.press('Escape'), settle: 1200 },
    ],
  },
  'send-stream': {
    url: '/app?scenario=chief-working',
    watch: ['[data-slot="message-scroller"]', '[data-slot="message-scroller-jump"]'],
    textWatch: ['[data-testid="chief-bubble"]'],
    ready: (page) =>
      page.waitForSelector('[data-testid="chief-composer-block"]', { timeout: 30000 }),
    steps: [
      {
        label: 'type-prompt',
        run: async (page) => {
          await composer(page).click();
          await typeSlow(page, 'Design capture test: explain binary search.', 25);
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
      { label: 'stream', run: () => sleep(6000), settle: 200, dump: true },
    ],
  },
  settings: {
    url: '/app/account',
    watch: ['[data-testid="settings-backdrop"]', '[role="listbox"]', '[role="menu"]'],
    ready: (page) => page.waitForSelector('[data-testid="settings-content"]', { timeout: 30000 }),
    steps: [
      { label: 'settle-dialog', run: () => sleep(1500), settle: 200, dump: true },
      {
        label: 'hover-nav',
        run: (page) =>
          hoverAcross(
            page,
            page.locator(
              '[data-testid="settings-backdrop"] nav button, [data-testid="settings-backdrop"] nav a',
            ),
            8,
          ),
        settle: 400,
      },
      {
        label: 'nav-page-1',
        run: (page, c) => press(page, settingsNav(page, 'Account'), 120, c),
        settle: 1500,
        dump: true,
      },
      {
        label: 'open-select',
        run: (page, c) => press(page, page.locator('[data-slot="select-trigger"]').first(), 120, c),
        settle: 900,
        dump: true,
      },
      { label: 'close-select', run: (page) => page.keyboard.press('Escape'), settle: 800 },
      {
        label: 'nav-page-2',
        run: (page, c) => press(page, settingsNav(page, 'Machines'), 120, c),
        settle: 1500,
        dump: true,
      },
      {
        label: 'nav-appearance',
        run: (page, c) => press(page, settingsNav(page, 'Appearance'), 120, c),
        settle: 1500,
      },

      {
        label: 'scroll-settings',
        run: (page) => wheel(page, page.locator('[data-testid="settings-body"]').first(), 600),
        settle: 800,
      },
      { label: 'close-dialog', run: (page) => page.keyboard.press('Escape'), settle: 1200 },
    ],
  },
  'search-palette': {
    url: '/app?scenario=chief-md',
    watch: ['[role="dialog"]', '[role="listbox"]', '[role="option"]'],
    ready: (page) =>
      page.waitForSelector('[data-testid="chief-composer-block"]', { timeout: 30000 }),
    steps: [
      {
        label: 'open-palette',
        run: (page) => page.keyboard.press('Control+K'),
        settle: 1200,
        dump: true,
      },
      {
        label: 'type-query',
        run: (page) => typeSlow(page, 'README', 90),
        settle: 1500,
        dump: true,
      },
      {
        label: 'hover-results',
        run: (page) =>
          hoverAcross(
            page,
            page.locator(
              '[role="dialog"] [role="option"], [role="dialog"] a, [role="dialog"] button',
            ),
            5,
          ),
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
    url: '/app?scenario=chief-md',
    watch: [],
    ready: (page) =>
      page.waitForSelector('[data-testid="chief-composer-block"]', { timeout: 30000 }),
    steps: Array.from({ length: 8 }, (_, i) => ({
      label: `tab-${i + 1}`,
      run: (page) => page.keyboard.press('Tab'),
      settle: 500,
      dump: i < 4,
    })),
  },
  projects: {
    url: '/app?scenario=prj-tasks',
    watch: ['main'],
    ready: () => sleep(1500),
    steps: [
      {
        label: 'hover-cards',
        run: (page) =>
          hoverAcross(
            page,
            page.locator('[data-slot="sidebar-project-row"], [data-slot="thread-card"]'),
            4,
            500,
          ),
        settle: 400,
        dump: true,
      },
      {
        label: 'hover-primary',
        run: (page) =>
          hoverAcross(
            page,
            page.locator('[data-slot="button"][data-variant="default"]').first(),
            1,
            900,
          ),
        settle: 400,
      },
    ],
  },
};

export const roles = {
  'shell.sidebar': 'aside',
  'shell.main': 'main, [data-testid="home-c"]',
  'shell.header': 'header',
  'sidebar.navrow': '[data-slot="sidebar-nav-row"]',
  'sidebar.row': '[data-slot="sidebar-thread-row"], [data-slot="sidebar-project-row"]',
  'sidebar.row.fill': '[data-slot="sidebar-thread-row"] >>filled',
  'sidebar.section': '[data-testid="thread-groups"] button, [data-testid="project-group"] button',
  'sidebar.footer': '[data-testid="sidebar-footer"]',
  'home.greeting': '[data-slot="greeting"] h2, [data-slot="greeting"] h1',
  'composer.input': '[data-testid="chief-composer-block"] textarea',
  'composer.box': '[data-testid="chief-composer-block"] textarea >>rounded',
  'composer.button': '[data-testid="chief-composer-block"] button',
  'composer.model': '[data-testid="chief-composer-block"] [data-slot="dropdown-menu-trigger"]',
  'message.user': '[data-testid="chief-bubble"]',
  'message.user.bubble': '[data-testid="chief-bubble"] >>filled',
  'message.reply': '[data-slot="bubble-content"]',
  'message.reply.p': '[data-slot="bubble-content"] p',
  'message.reply.heading':
    '[data-slot="bubble-content"] h1, [data-slot="bubble-content"] h2, [data-slot="bubble-content"] h3',
  'message.reply.li': '[data-slot="bubble-content"] li',
  'message.reply.strong': '[data-slot="bubble-content"] strong',
  'message.actions.button':
    '[data-testid="chief-msg-tools"] button, [data-testid="chief-msg-foot"] button',
  'code.block': 'pre',
  'code.block.box': 'pre >>filled',
  'code.inline': '[data-slot="bubble-content"] p code, [data-slot="bubble-content"] li code',
  'table.th': 'th',
  'table.td': 'td',
  blockquote: 'blockquote',
  jump: '[data-slot="message-scroller-jump"]',
  menu: '[role="menu"]',
  'menu.item': '[role="menu"] [role^="menuitem"]',
  'menu.separator': '[role="menu"] [role="separator"]',
  dialog: '[data-testid="settings-content"], [role="dialog"]',
  'dialog.navitem':
    '[data-testid="settings-backdrop"] nav button, [data-testid="settings-backdrop"] nav a',
  'dialog.input': '[data-testid="settings-content"] input',
  'dialog.select': '[data-testid="settings-content"] [data-slot="select-trigger"]',
  'dialog.switch': '[data-testid="settings-content"] [role="switch"]',
  'dialog.radiogroup': '[data-testid="settings-content"] [role="radiogroup"]',
  tooltip: '[role="tooltip"]',
  listbox: '[role="listbox"]',
  'panel.side': '[data-slot="side-panel"], aside:not(:first-of-type)',
  'button.primary': '[data-slot="button"][data-variant="default"]',
  'project.card': '[data-slot="thread-card"], [data-slot="card"]',
};
