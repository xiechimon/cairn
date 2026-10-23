import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Locator, Page } from '@playwright/test';

/**
 * Opt-in evidence capture for fixture-face specs (#659).
 *
 * Regression runs (CI, any lane's full-suite run) must never write into
 * tracked paths. Three specs used to regenerate their ticket's committed
 * docs/verify PNGs on every run: the rendered UI drifts after the ticket
 * lands, so each full e2e rewrote tracked bytes and dirtied the working
 * tree for every other lane.
 *
 * Evidence generation is now explicit — a task that needs fresh screenshots
 * for its PR runs:
 *
 *   CAIRN_E2E_EVIDENCE=docs/verify/<ticket> npx playwright test <spec>
 *
 * The value resolves from the repo root (a subdir like <ticket>/after is
 * fine), the directory is created on demand, and the task branch commits the
 * regenerated PNGs. Unset = no-op: the committed history stays byte-frozen
 * and the SHA-pinned raw links in merged PR bodies keep matching main.
 */
const EVIDENCE_ROOT = process.env.CAIRN_E2E_EVIDENCE
  ? resolve(import.meta.dirname, '../../..', process.env.CAIRN_E2E_EVIDENCE)
  : null;

/**
 * Capture `name` under CAIRN_E2E_EVIDENCE; silently skipped when unset.
 *
 * `clip` (page coordinates) frames a panel instead of the whole viewport —
 * a detail change is unreadable in a 1440px-wide page shot. Callers clamp it
 * to the viewport themselves; nothing here guesses a frame.
 */
export async function evidenceShot(
  page: Page,
  name: string,
  clip?: { x: number; y: number; width: number; height: number },
): Promise<void> {
  if (EVIDENCE_ROOT === null) return;
  mkdirSync(EVIDENCE_ROOT, { recursive: true });
  await page.screenshot({ path: resolve(EVIDENCE_ROOT, name), ...(clip ? { clip } : {}) });
}

/** `evidenceShot` framed on `panel` (padded, clamped to the viewport). */
export async function evidencePanelShot(
  page: Page,
  name: string,
  panel: Locator,
  pad = 24,
): Promise<void> {
  if (EVIDENCE_ROOT === null) return;
  const box = await panel.boundingBox();
  if (box == null) return;
  const viewport = page.viewportSize();
  const x = Math.max(0, box.x - pad);
  const y = Math.max(0, box.y - pad);
  const right = Math.min(viewport?.width ?? Number.POSITIVE_INFINITY, box.x + box.width + pad);
  const bottom = Math.min(viewport?.height ?? Number.POSITIVE_INFINITY, box.y + box.height + pad);
  await evidenceShot(page, name, { x, y, width: right - x, height: bottom - y });
}
