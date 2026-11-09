import { expect, type Page, test } from '@playwright/test';
import { PAGES } from '../e2e/audit-pages.js';
import { RULE_IDS, RULES } from './rules.js';

const TRIP_PAGE = PAGES.find((p) => p.name === 'team')!;

const MUTATIONS: Record<string, (page: Page) => Promise<void>> = {
  C1: (page) =>
    page.evaluate(() => {
      document.body.insertAdjacentHTML(
        'afterbegin',
        '<div data-todo-id="trip" data-phase="done">done</div><div data-todo-id="trip" data-phase="unverified">unverified</div>',
      );
    }),
  C2: (page) =>
    page.evaluate(() => {
      document.body.insertAdjacentHTML('afterbegin', '<div>—·—·</div>');
    }),
  C3: (page) =>
    page.evaluate(() => {
      document.body.insertAdjacentHTML(
        'afterbegin',
        '<div data-testid="chief-msg" style="height:30px">a</div><div data-testid="chief-msg" style="height:30px;margin-top:42px">b</div>',
      );
    }),
  C4: (page) =>
    page.evaluate(() => {
      document.body.insertAdjacentHTML(
        'afterbegin',
        '<button aria-label="trip" style="position:fixed;top:2px;left:2px;z-index:99999;width:30px;height:30px"><svg width="12" height="12"></svg></button>',
      );
    }),
  C5: (page) =>
    page.evaluate(() => {
      document.body.insertAdjacentHTML('afterbegin', '<div role="alert">chief agent not bound (todo 42)</div>');
    }),
  C7: (page) =>
    page.evaluate(() => {
      document.body.insertAdjacentHTML('afterbegin', '<div><textarea disabled></textarea></div>');
    }),
  C11: (page) =>
    page.evaluate(() => {
      document.body.insertAdjacentHTML(
        'beforeend',
        '<div data-testid="chief-msg" style="position:absolute;top:5000px;height:30px;width:100px">late</div>',
      );
    }),
  V2: (page) =>
    page.evaluate(() => {
      document.body.insertAdjacentHTML('afterbegin', '<p style="font-family: Arial">trip</p>');
    }),
  V3: (page) =>
    page.evaluate(() => {
      document.body.insertAdjacentHTML(
        'afterbegin',
        '<div style="background-image:linear-gradient(red,blue);width:20px;height:20px">g</div>',
      );
    }),
  V4: (page) =>
    page.evaluate(() => {
      document.body.insertAdjacentHTML(
        'afterbegin',
        '<div data-slot="card" style="width:50px;height:50px"><div data-slot="card" style="width:20px;height:20px">x</div></div>',
      );
    }),
  V8: (page) =>
    page.evaluate(() => {
      document.body.insertAdjacentHTML('afterbegin', '<div style="padding:5px">trip</div>');
    }),
  V22: (page) =>
    page.evaluate(() => {
      document.body.insertAdjacentHTML('afterbegin', '<span style="text-transform:uppercase;letter-spacing:0.1em">paid this month</span>');
    }),
  V23: (page) =>
    page.evaluate(() => {
      document.body.insertAdjacentHTML('afterbegin', '<h2 style="font-weight:900;font-style:italic">Inbox</h2>');
    }),
  V24: (page) =>
    page.evaluate(() => {
      document.body.insertAdjacentHTML('afterbegin', '<div style="transition:all 200ms ease;width:20px;height:20px">t</div>');
    }),
  T4: (page) =>
    page.evaluate(() => {
      document.body.insertAdjacentHTML('afterbegin', '<button style="width:60px;height:30px">Save!</button>');
    }),
  T1: (page) =>
    page.evaluate(() => {
      document.body.insertAdjacentHTML('afterbegin', '<span>查看 thread</span>');
    }),
  A1: (page) =>
    page.evaluate(() => {
      document.body.insertAdjacentHTML('afterbegin', '<button style="width:10px;height:10px;padding:0">x</button>');
    }),
  A2: (page) =>
    page.evaluate(() => {
      document.head.insertAdjacentHTML('beforeend', '<style>*:focus,*:focus-visible{outline:none!important;box-shadow:none!important}@keyframes trip-blur{to{filter:hue-rotate(90deg)}}#trip-spin{animation:trip-blur 1s infinite}</style>');
      document.body.insertAdjacentHTML('afterbegin', '<button id="trip-focus" style="outline:none;box-shadow:none">f</button><div id="trip-spin">s</div>');
    }),
  R1: (page) =>
    page.evaluate(() => {
      document.body.insertAdjacentHTML('afterbegin', '<div style="width:2000px;height:4px"></div>');
    }),
};

test.describe.configure({ mode: 'parallel' });

for (const [id, mutate] of Object.entries(MUTATIONS)) {
  test(`${id} reports a new finding after a violating change`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(TRIP_PAGE.url);
    await expect(TRIP_PAGE.ready(page)).toBeVisible();
    const before = new Set((await RULES[id]!(page)).map((f) => f.key));
    await mutate(page);
    const after = await RULES[id]!(page);
    const fresh = after.filter((f) => !before.has(f.key));
    expect(fresh.length, `${id} found nothing new`).toBeGreaterThan(0);
    for (const f of fresh) expect(f.message.startsWith(`${id}: `)).toBe(true);
    console.log(`TRIP ${fresh[0]!.message}`);
  });
}

test('every rule has a violating change', () => {
  expect(Object.keys(MUTATIONS).sort()).toEqual([...RULE_IDS].sort());
});
