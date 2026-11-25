import { expect, test } from '@playwright/test';

test.describe('Coordinator composer unified list markers and keys', () => {
  test('1. / 2. / 10. and - live-render as distinct list markers immediately on Space and stay aligned with textarea', async ({
    page,
  }) => {
    await page.goto('/app?scenario=114');
    const home = page.getByTestId('home-c');
    const composer = home.getByTestId('chief-composer-input');
    const mirror = home.getByTestId('mention-highlight');
    await expect(composer).toBeVisible();

    await composer.click();
    await composer.pressSequentially('1.');
    await expect(mirror.locator('[data-list-marker]')).toHaveCount(0);

    await composer.press('Space');
    const orderedMarker = mirror.locator('[data-list-marker="ordered"]');
    await expect(orderedMarker).toHaveCount(1);
    await expect(orderedMarker).toHaveText('1.');

    await composer.pressSequentially('第一项');
    await composer.press('Shift+Enter');
    await expect(composer).toHaveValue('1. 第一项\n2. ');
    await expect(orderedMarker).toHaveCount(2);
    await expect(orderedMarker.nth(1)).toHaveText('2.');

    await composer.pressSequentially('第二项');
    await composer.press('Shift+Enter');
    await composer.press('Shift+Enter');
    await expect(composer).toHaveValue('1. 第一项\n2. 第二项\n');
    await expect(orderedMarker).toHaveCount(2);

    await composer.pressSequentially('10. 第十项');
    await composer.press('Shift+Enter');
    await expect(composer).toHaveValue('1. 第一项\n2. 第二项\n10. 第十项\n11. ');
    await expect(orderedMarker).toHaveCount(4);
    await expect(orderedMarker.nth(2)).toHaveText('10.');

    await composer.press('Backspace');
    await expect(composer).toHaveValue('1. 第一项\n2. 第二项\n10. 第十项\n');
    await expect
      .poll(() => composer.evaluate((el) => (el as HTMLTextAreaElement).selectionStart))
      .toBe('1. 第一项\n2. 第二项\n10. 第十项\n'.length);

    await composer.pressSequentially('- 无序项');
    const bulletMarker = mirror.locator('[data-list-marker="bullet"]');
    await expect(bulletMarker).toHaveCount(1);
    await expect(bulletMarker).toHaveText('-');

    await composer.press('Shift+Enter');
    await expect(composer).toHaveValue('1. 第一项\n2. 第二项\n10. 第十项\n- 无序项\n- ');
    await expect(bulletMarker).toHaveCount(2);

    await composer.press('Backspace');
    await expect(composer).toHaveValue('1. 第一项\n2. 第二项\n10. 第十项\n- 无序项\n');

    const styles = await mirror.evaluate((el) => {
      const ord = el.querySelector('[data-list-marker="ordered"]');
      const bul = el.querySelector('[data-list-marker="bullet"]');
      const plain = [...el.querySelectorAll('span')].find(
        (span) => !span.hasAttribute('data-list-marker') && (span.textContent ?? '').includes('第一项'),
      );
      if (!ord || !bul || !plain) return null;
      const csOrd = getComputedStyle(ord);
      const csBul = getComputedStyle(bul);
      const csPlain = getComputedStyle(plain);
      return {
        ordBg: csOrd.backgroundColor,
        ordColor: csOrd.color,
        ordRadius: csOrd.borderRadius,
        bulBg: csBul.backgroundColor,
        bulColor: csBul.color,
        bulRadius: csBul.borderRadius,
        plainBg: csPlain.backgroundColor,
        plainColor: csPlain.color,
      };
    });
    expect(styles).not.toBeNull();
    expect(styles!.ordBg).toBe(styles!.bulBg);
    expect(styles!.ordColor).toBe(styles!.bulColor);
    expect(styles!.ordRadius).toBe(styles!.bulRadius);
    expect(styles!.ordBg).not.toBe(styles!.plainBg);

    const alignment = await page.evaluate(() => {
      const ta = document.querySelector('[data-testid="chief-composer-input"]') as HTMLTextAreaElement;
      const mh = document.querySelector('[data-testid="mention-highlight"]') as HTMLElement;
      const tr = ta.getBoundingClientRect();
      const mr = mh.getBoundingClientRect();
      const ts = getComputedStyle(ta);
      const ms = getComputedStyle(mh);
      return {
        dx: Math.abs(tr.left - mr.left),
        dy: Math.abs(tr.top - mr.top),
        dw: Math.abs(tr.width - mr.width),
        dh: Math.abs(tr.height - mr.height),
        fontFamily: ts.fontFamily === ms.fontFamily,
        fontSize: ts.fontSize === ms.fontSize,
        fontWeight: ts.fontWeight === ms.fontWeight,
        lineHeight: ts.lineHeight === ms.lineHeight,
        paddingLeft: ts.paddingLeft === ms.paddingLeft,
      };
    });
    expect(alignment.dx).toBeLessThanOrEqual(0.5);
    expect(alignment.dy).toBeLessThanOrEqual(0.5);
    expect(alignment.dw).toBeLessThanOrEqual(0.5);
    expect(alignment.dh).toBeLessThanOrEqual(0.5);
    expect(alignment.fontFamily).toBe(true);
    expect(alignment.fontSize).toBe(true);
    expect(alignment.fontWeight).toBe(true);
    expect(alignment.lineHeight).toBe(true);
    expect(alignment.paddingLeft).toBe(true);
  });

  test('does not trigger list rendering or key continuation during Chinese IME composition, and keeps pasted text intact', async ({
    page,
  }) => {
    await page.goto('/app?scenario=114');
    const home = page.getByTestId('home-c');
    const composer = home.getByTestId('chief-composer-input');
    const mirror = home.getByTestId('mention-highlight');
    await expect(composer).toBeVisible();
    await composer.click();

    await composer.evaluate((el) => {
      const ta = el as HTMLTextAreaElement;
      ta.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(ta, '1. ');
      ta.setSelectionRange(3, 3);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(mirror.locator('[data-list-marker]')).toHaveCount(0);

    await composer.evaluate((el) => {
      el.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, isComposing: true, bubbles: true }),
      );
    });
    await expect(composer).toHaveValue('1. ');

    await composer.evaluate((el) => {
      const ta = el as HTMLTextAreaElement;
      ta.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '1. ' }));
    });
    await expect(mirror.locator('[data-list-marker="ordered"]')).toHaveCount(1);

    await composer.fill('');
    await composer.evaluate((el) => {
      const ta = el as HTMLTextAreaElement;
      const dt = new DataTransfer();
      dt.setData('text/plain', '1. 粘贴甲\n2. 粘贴乙');
      const pasteEvent = new ClipboardEvent('paste', {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
      });
      ta.dispatchEvent(pasteEvent);
      if (!pasteEvent.defaultPrevented) {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
        setter.call(ta, '1. 粘贴甲\n2. 粘贴乙');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await expect(composer).toHaveValue('1. 粘贴甲\n2. 粘贴乙');
  });
});
