import { chromium } from '@playwright/test';

// 实测：live 栈上真点击「添加机器」钮，dialog 开不开？（判 add-machine-intact 红因）
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 732 } });
await page.goto('http://127.0.0.1:5273/app/resources/machines');
await page.waitForSelector('[data-route="/app/resources/machines"] div[data-kind="local"]');
const btn = page.locator('button:text-is("添加机器")');
console.log('button count:', await btn.count());
await btn.click();
await page.waitForTimeout(1500);
const dlgCount = await page.locator('[role="dialog"]').count();
console.log('dialog count after click:', dlgCount);
if (dlgCount > 0) {
  console.log('dialog text head:', (await page.locator('[role="dialog"]').first().innerText()).slice(0, 80).replace(/\n/g, ' | '));
}
await page.screenshot({ path: '/tmp/live-addmachine.png' });
await browser.close();
