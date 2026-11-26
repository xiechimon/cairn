import { expect, type Locator, type Page, test } from '@playwright/test';
import { evidencePanelShot } from './evidence';

const ROUTE = '/app?scenario=chief-code';

type Box = { x: number; y: number; width: number; height: number };

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

async function hits(page: Page, target: Locator): Promise<boolean> {
  return target.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return top !== null && el.contains(top);
  });
}

for (const scheme of ['light', 'dark'] as const) {
  for (const width of [1440, 390]) {
    test(`a hovered code block keeps its own buttons clear of the message toolbar (${scheme}, ${width}px)`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width, height: 900 });
      await page.goto(ROUTE);
      const codeBlocks = page.getByTestId('home-c').getByTestId('md-code-block');
      await expect(codeBlocks).toHaveCount(2);
      for (const [n, name] of ['ends-with-code', 'code-in-middle'].entries()) {
        const code = codeBlocks.nth(n);
        await code.scrollIntoViewIfNeeded();
        const block = code.locator('xpath=ancestor::*[@data-testid="chief-msg"][1]');
        await code.getByTestId('md-code').hover();
        const tools = block.locator('[data-slot="message-meta"]');
        if (width === 390) {
          await expect(tools, `${name}: no reply toolbar at 390px`).toHaveCount(0);
          for (const own of [code.getByTestId('md-code-expand'), code.getByTestId('md-code-copy')])
            expect(await hits(page, own), `${name}: code button is reachable`).toBe(true);
          await evidencePanelShot(page, `code-block-tools-${name}-${scheme}-${width}.png`, block, 48);
          continue;
        }
        await expect(tools).toHaveCSS('opacity', '1');
        await evidencePanelShot(page, `code-block-tools-${name}-${scheme}-${width}.png`, block, 48);
        const ownButtons = [code.getByTestId('md-code-expand'), code.getByTestId('md-code-copy')];
        const toolButtons = tools.getByRole('button');
        await expect(toolButtons).toHaveCount(1);
        for (const own of ownButtons) {
          const ownBox = await own.boundingBox();
          expect(ownBox).not.toBeNull();
          for (const tool of await toolButtons.all()) {
            const toolBox = await tool.boundingBox();
            expect(toolBox).not.toBeNull();
            if (ownBox === null || toolBox === null) continue;
            expect(overlaps(ownBox, toolBox), `${name}: toolbar button covers a code button`).toBe(
              false,
            );
          }
          expect(await hits(page, own), `${name}: code button is reachable`).toBe(true);
        }
        await expect(
          tools.getByTestId('msg-stamp'),
          `${name}: the meta row under the reply carries its time`,
        ).toHaveCount(1);
        for (const tool of await toolButtons.all())
          expect(await hits(page, tool), `${name}: toolbar button is reachable`).toBe(true);
        const codeBox = await code.boundingBox();
        const headerBox = await code.locator('xpath=./div[1]').boundingBox();
        if (codeBox === null || headerBox === null) throw new Error(`${name}: code block not laid out`);
        for (const part of await toolButtons.all()) {
          const box = await part.boundingBox();
          if (box === null || box.x >= codeBox.x + codeBox.width) continue;
          for (const line of [codeBox.y, headerBox.y + headerBox.height])
            expect(
              box.y < line && box.y + box.height > line,
              `${name}: toolbar sits across a code block border`,
            ).toBe(false);
        }
      }
    });
  }
}
