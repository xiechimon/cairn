export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const center = async (locator) => {
  const box = await locator.boundingBox();
  if (!box) throw new Error('no box');
  return [box.x + box.width / 2, box.y + box.height / 2];
};

export const hoverAcross = async (page, locator, count, dwell = 350) => {
  const n = Math.min(count, await locator.count());
  for (let i = 0; i < n; i++) {
    const [x, y] = await center(locator.nth(i));
    await page.mouse.move(x, y, { steps: 6 });
    await sleep(dwell);
  }
  await page.mouse.move(2, 2, { steps: 4 });
};

export const press = async (page, locator, hold = 200, { mobile = false } = {}) => {
  const [x, y] = await center(locator);
  if (mobile) {
    await page.touchscreen.tap(x, y);
    return;
  }
  await page.mouse.move(x, y, { steps: 6 });
  await sleep(250);
  await page.mouse.down();
  await sleep(hold);
  await page.mouse.up();
};

export const wheel = async (page, locator, total, step = 120, gap = 40) => {
  const [x, y] = await center(locator);
  await page.mouse.move(x, y);
  const n = Math.ceil(Math.abs(total) / step);
  for (let i = 0; i < n; i++) {
    await page.mouse.wheel(0, Math.sign(total) * step);
    await sleep(gap);
  }
};

export const typeSlow = async (page, text, delay = 70) => {
  await page.keyboard.type(text, { delay });
};
