import { expect, type Page, test } from '@playwright/test';

// #1266, hung on the gesture-machine regression set (#1267): the second ⌘J
// (the minimizing press) must not repaint the chief window. The state half
// of that press is reduceGesture chief/toggle in
// apps/web/src/overlay/gesture-machine.ts. Failure modes pinned here, from
// the measured repro (CDP screencast + passive style-event log on the
// fixture build):
//   1. post-exit opacity bounce (the reported flash): the exit keyframe
//      ends with fill-mode none, so the computed opacity snaps back to the
//      base value; the element's incidental `transition: all` (the
//      duration-* utility sets transition-duration and transition-property
//      defaults to all) turns that snap-back into a painted 200ms re-fade —
//      the closed window flashes back to ~full brightness and fades out
//      again. Mechanical signature: a `transitionrun` for `opacity` on the
//      aside during the close, and a +12 luminance spike in painted frames.
//      Pre-#1234 this was invisible: preflight's [hidden] display:none
//      stopped painting before the bounce; the #1067 visibility park keeps
//      the box painted, so the bounce became user-visible.
//   2. remount: the toggle must keep the SAME popup node (keepMounted park
//      contract, ADR 0013 D6/#1067 — draft/scroll/thread state ride node
//      identity). A remount would also flash and would lose the park.
//   3. over-fix guards: the intended enter/exit keyframe motion must keep
//      playing (a fix that deletes animate-out would silence mode 1 by
//      killing the motion), and the closed window must stay parked in the
//      DOM with the hidden attribute (a fix that unmounts or drops hidden
//      would break #1067 scroll retention and the a11y park).
//
// Heisenbug warning for future edits: reading computed styles of the aside
// (getComputedStyle, Playwright visibility polling, rAF style samplers)
// forces synchronous style recalculation and can collapse the two-recalc
// bounce window into one — masking the flash. Between the press and the
// assertion window this spec must stay passive: waitForTimeout only, and
// the detectors below are passive event listeners.

const drawer = (page: Page) => page.locator('.chief-drawer');

interface Recorder {
  opacityTransitions: number;
  animStarts: string[];
  animEnds: string[];
}

/** Arm passive detectors on the current popup node. Returns nothing; read
 *  back with readRecorder. The node marker (data-flash-probe) is an
 *  attribute no JSX renders, so a remount drops it. */
async function armRecorder(page: Page) {
  await page.evaluate(() => {
    const el = document.querySelector('.chief-drawer');
    if (!el) throw new Error('chief drawer node missing');
    el.setAttribute('data-flash-probe', 'armed');
    const w = window as unknown as { __flashRec: Recorder };
    w.__flashRec = { opacityTransitions: 0, animStarts: [], animEnds: [] };
    el.addEventListener('transitionrun', (e) => {
      if ((e as TransitionEvent).propertyName === 'opacity') w.__flashRec.opacityTransitions += 1;
    });
    el.addEventListener('animationstart', (e) => w.__flashRec.animStarts.push(e.animationName));
    el.addEventListener('animationend', (e) => w.__flashRec.animEnds.push(e.animationName));
  });
}

async function readRecorder(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as { __flashRec: Recorder };
    const el = document.querySelector('.chief-drawer');
    return {
      ...w.__flashRec,
      sameNode: el?.getAttribute('data-flash-probe') === 'armed',
      parked: el?.hasAttribute('hidden') ?? false,
    };
  });
}

/** One-shot open-state read (allowed OUTSIDE the critical window; never
 *  poll styles between a press and its assertion — Heisenbug note above). */
async function isOpen(page: Page): Promise<boolean> {
  return page.evaluate(
    () => !!document.querySelector('.chief-drawer')?.hasAttribute('data-open'),
  );
}

/** Settle to a known state with fixed waits (no style polling). */
async function normalizeOpen(page: Page) {
  if (!(await isOpen(page))) {
    await page.keyboard.press('Meta+j');
    await page.waitForTimeout(600);
  }
  await page.waitForTimeout(300);
}

async function normalizeClosed(page: Page) {
  if (await isOpen(page)) {
    await page.keyboard.press('Meta+j');
    await page.waitForTimeout(600);
  }
  await page.waitForTimeout(300);
}

test.describe('chief ⌘J toggle does not flash (#1266)', () => {
  test('second ⌘J minimizes without an opacity repaint or remount', async ({ page }) => {
    await page.goto('/app?scenario=111');
    // the reported flow: summon with ⌘J, press again — the bounce needs the
    // toggle-opened path (a load-opened window does not reproduce it), so
    // normalize to closed first and summon with the chord like the user did.
    await normalizeClosed(page);
    await armRecorder(page);
    await page.keyboard.press('Meta+j'); // summon
    await page.waitForTimeout(600);
    expect(await isOpen(page)).toBe(true);

    await page.keyboard.press('Meta+j'); // the reported flash moment
    await page.waitForTimeout(600); // passive window — do not poll styles

    const rec = await readRecorder(page);
    // the flash signature: no opacity transition may run on the close path
    expect(rec.opacityTransitions).toBe(0);
    // intended motion still plays, start to end
    expect(rec.animStarts).toContain('exit');
    expect(rec.animEnds).toContain('exit');
    // park contract: same node, hidden, still in the DOM
    expect(rec.sameNode).toBe(true);
    expect(rec.parked).toBe(true);
    await expect(drawer(page)).toBeHidden();
  });

  test('summon-then-minimize cycle twice: node identity holds, zero opacity transitions', async ({
    page,
  }) => {
    await page.goto('/app?scenario=111');
    await normalizeClosed(page);

    await armRecorder(page);
    for (let cycle = 0; cycle < 2; cycle++) {
      await page.keyboard.press('Meta+j'); // summon
      await page.waitForTimeout(600);
      await page.keyboard.press('Meta+j'); // minimize — flash moment
      await page.waitForTimeout(600);
    }

    const rec = await readRecorder(page);
    expect(rec.opacityTransitions).toBe(0);
    expect(rec.animStarts.filter((n) => n === 'enter').length).toBe(2);
    expect(rec.animEnds.filter((n) => n === 'enter').length).toBe(2);
    expect(rec.animStarts.filter((n) => n === 'exit').length).toBe(2);
    expect(rec.animEnds.filter((n) => n === 'exit').length).toBe(2);
    expect(rec.sameNode).toBe(true);
    expect(rec.parked).toBe(true);
  });
});
