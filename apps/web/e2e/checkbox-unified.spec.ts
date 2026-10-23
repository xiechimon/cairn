import { expect, type Page, test } from '@playwright/test';
import { evidenceShot } from './evidence';

// 复选正典（#1003 对齐 registry base-nova 同源；历史：XMON-72 建、#690 迁
// Base UI 官方件、#789 P2 手作 V2 骨架与动效、#952 扩三态——V2 皮肤/动效随
// #982 判决退役）：件 = 上游 Checkbox.Root 透传（16px 盒 / rounded-[4px] /
// border-input，开态 data-checked:bg-primary）+ 一件仓内零皮肤语义映射——
// indeterminate 时 Indicator 渲染横杠（上游 mixed 态复用勾形，会丢「部分
// 选中」语义；#952，board 全选行依赖；账本登记见 scripts/ui-registry.json）。
// 件内容（含上游动效类串）由 #989 ui-registry-gate 的 hash 账本钉住，本
// spec 只钉行为契约与消费面组合：行盒 = 消费点 label 包裹（整行可点走
// label 激活转发）。e2e 锚：盒 = [data-slot=checkbox]，隐藏原生 input =
// 弹层内 input[type=checkbox]（Base UI 官方契约：id 落隐藏 input）。
// 钉住的失败方式，逐条对应一个测试：
//   1. accept：原生 input 被画出来（没走官方遮蔽机制）；
//   2. accept：未选中态露勾（Indicator 不随 checked 卸载）；
//   3. accept：整行点击不切换（label 激活行为不再转发到隐藏 input——
//      消费面 label 组合契约）；
//   4. accept：盒几何漂移（16×16 / 圆角 4px / 与文字 gap 8 / 文字 13px =
//      上游 registry 默认 + 消费面行盒配方）；
//   5. provider：未选中态露白勾（与 2 同族）；id 仍落在真 input[type=checkbox]
//      上，provider-add-dialog 的 pin 照常成立；
//   6. accept：键盘 Space 不切换（官方件 Root tabIndex=0 的键盘契约）。
// 旧「手作三值动效」探针随 V2 皮肤退役删除（#991 Q9：动效 = base-nova 形态
// 一部分；上游动效类串由 hash 账本钉住，不再需要行为级复读）。
// 三态 mixed（aria-checked=mixed + 横杠）钉在 board 全选行面
// （board-filter.spec，role=checkbox 载体）。
// stop-confirm dialog 与 accept 同形（同类同 JSX），但 fixture 面没有
// running 态可开它（OverlayKind 无 stop、fixtures 无 activeRun）：由 live 面
// verify-cairn 的 drive-stop 探针 + 截图证据覆盖，见 docs/verify/XMON-72/。
//
// 证据截图走 evidenceShot（默认不落盘；要为本票 PR 再生证据时设
// CAIRN_E2E_EVIDENCE=docs/verify/<ticket> 再跑，见 e2e/evidence.ts）。
// 历史证据 = 已提交的 docs/verify/XMON-72/，回归跑不许再重写它。

/** r7 34：accept 弹层冻开在看板面上，merge 默认勾选。 */
async function openAccept(page: Page) {
  await page.goto('/app?scenario=34');
  // #952/#910 重钉：壳级 .dlg → getByRole(dialog) + 可及名（§5.5）。
  const dialog = page.getByRole('dialog', { name: '完成任务' });
  await expect(dialog).toBeVisible();
  // #656: the dialog enter animation (tw-animate-css zoom-in-95) scales the panel
  // from 0.95 — settle it so interior-geometry measures ride the laid-out box
  // (the same getAnimations().finished wait the drawer specs use).
  await dialog.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  return dialog;
}

/** spec 11 §A6：picker 面进自定义端点表单，Bearer 复选默认 on（r3 §2）。 */
async function openProviderForm(page: Page) {
  await page.goto('/app/resources/providers?scenario=01');
  await page.getByRole('button', { name: '新建', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '添加模型服务' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '自定义端点' }).click();
  await expect(dialog.locator('#dlg-provider-id')).toBeVisible();
  // #677 wired tw-animate-css: same enter-animation settle as openAccept so
  // evidence shots and geometry never ride a transient scale.
  await dialog.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  return dialog;
}

test('accept: 原生 input 走官方遮蔽（不画 Mac 复选框）', async ({ page }) => {
  const dialog = await openAccept(page);
  const input = dialog.locator('input[type="checkbox"]');
  await expect(input).toBeChecked();
  // 官方 visually-hidden = 1×1 + clip-path inset(50%)（内联样式；覆盖层时代的
  // opacity 0 手法随真 input 一起退役）。
  const box = await input.boundingBox();
  expect(box).not.toBeNull();
  if (box == null) return;
  expect(box.width).toBeLessThanOrEqual(1);
  expect(box.height).toBeLessThanOrEqual(1);
  await expect(input).toHaveCSS('clip-path', 'inset(50%)');
  await evidenceShot(page, 'accept-checked.png');
});

test('accept: 未选中态不露勾', async ({ page }) => {
  const dialog = await openAccept(page);
  const input = dialog.locator('input[type="checkbox"]');
  const tile = dialog.locator('[data-slot="checkbox"]');
  await tile.click();
  await expect(input).not.toBeChecked();
  await expect(tile.locator('svg')).toHaveCount(0);
  await evidenceShot(page, 'accept-unchecked.png');
});

test('accept: 整行可点（文字也是点击目标）', async ({ page }) => {
  const dialog = await openAccept(page);
  const input = dialog.locator('input[type="checkbox"]');
  const label = dialog.getByText('将改动合并到默认分支');
  await label.click();
  await expect(input).not.toBeChecked();
  await label.click();
  await expect(input).toBeChecked();
});

// accept 面文字 = DESIGN.md 界面字 text-ui 13.5px（Paper 弹窗）。checkbox 盒
// 几何（16×16 / 4px）与 gap 8 是 registry 件自身契约，不动。
test('accept: 盒几何 = 16×16 / 圆角 4px / 与文字 gap 8 / 文字 13.5px', async ({
  page,
}) => {
  const dialog = await openAccept(page);
  const tile = dialog.locator('[data-slot="checkbox"]');
  const box = await tile.boundingBox();
  expect(box).not.toBeNull();
  if (box == null) return;
  expect(box.width).toBeGreaterThan(15.5);
  expect(box.width).toBeLessThan(16.5);
  expect(box.height).toBeGreaterThan(15.5);
  expect(box.height).toBeLessThan(16.5);
  await expect(tile).toHaveCSS('border-radius', '4px');
  const label = dialog.getByText('将改动合并到默认分支');
  await expect(label).toHaveCSS('font-size', '13.5px');
  const lb = await label.boundingBox();
  expect(lb).not.toBeNull();
  if (lb == null) return;
  const gap = lb.x - (box.x + box.width);
  expect(gap).toBeGreaterThan(7.5);
  expect(gap).toBeLessThan(8.5);
});

test('provider: 未选中态不露白勾（#dlg-provider-authheader id 存活）', async ({
  page,
}) => {
  const dialog = await openProviderForm(page);
  const input = dialog.locator('#dlg-provider-authheader');
  await expect(input).toBeChecked();
  await evidenceShot(page, 'provider-checked.png');
  // #944/#910 载体：.dlg-provider-authrow 类名钩退役 → 件 data-slot 直取
  // （#1003：registry 件的稳定观测点 = data-slot，域别名不再进件）。
  await dialog.locator('[data-slot="checkbox"]').click();
  await expect(input).not.toBeChecked();
  await expect(dialog.locator('[data-slot="checkbox"] svg')).toHaveCount(0);
  await evidenceShot(page, 'provider-unchecked.png');
});

test('accept: 键盘 Space 切换（焦点落在 Root 本体）', async ({ page }) => {
  const dialog = await openAccept(page);
  const input = dialog.locator('input[type="checkbox"]');
  const tile = dialog.locator('[data-slot="checkbox"]');
  await tile.focus();
  await page.keyboard.press('Space');
  await expect(input).not.toBeChecked();
  await page.keyboard.press('Space');
  await expect(input).toBeChecked();
});
