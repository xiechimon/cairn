import { expect, type Page, test } from '@playwright/test';
import { pressAndExpect } from './helpers.js';

// #462 symptom 2 (Escape 关层竞态) 的回归钉：**开着的层，其 Escape 接线必须
// 在整个开启期保持稳定**——重渲染（URL 写回、数据提交、SSE 失效）不得把它
// 卸载重挂。
//
// 失败机理（CI 实测 + 车道探针 23/23 复现，见报告）：层开着时若有一次重渲染
// 的 passive effect 尚未 flush，而 keydown 派发已经开始，同一派发中更早的
// window 监听者会触发那次 flush —— 层的清理在本派发中途跑掉，**被移除的监听
// 者在本次派发中不再被调用**（DOM 规范），于是这次 Escape 根本没到达该层，层
// 保持开态直到第二次 Escape。观测指纹：失败轮 100% 出现「派发中途 rem+add」，
// 通过轮 0/177（探针 200 轮）。#67 家族旧手写 Esc hook（已随 #656 退役）按 open 周期
// 注册一次（onClose 走 ref），开着的层不再有中途重挂。
//
// 每条用例钉一个失败方式：层开着的期间发生 URL 写回重渲染 → 接线被重挂
// （rem+add）。旧实现在此确定性红（本车道实测 3/3），dismiss.tsx 按 open 周期
// 注册后绿。同一用例同时钉用户可见律：URL 写回后单次 Escape 必须收层。

const EMPTY = '/app?scenario=board-tags-empty';

const typeBtn = (page: Page) => page.locator('.board-type-filter');
const typePopover = (page: Page) => page.locator('.type-filter-popover');
const typeOption = (page: Page, name: string) =>
  page.locator(`.type-filter-option[data-tag="${name}"]`);

/** keydown 接线的增删探针：只数**调用**，不依赖应用内部结构。读点固定在
 *  「开层期结束、关层之前」——关层本身必然 teardown，把它读进来就要额外论证
 *  哪几次 rem 合法，而那几个数字是实现的指纹（手写族在 window 挂 1 条，
 *  Base UI 在 document 挂 3 条/层），钉它等于钉实现而非钉律。开层期读则两条
 *  机制同判：病根位（重挂）非零即红，teardown 不混入。
 *
 *  **数两个目标**：仓内两代弹层机制的落点不同——手写族（dismiss.tsx 的
 *  useEscapeClose）挂 window，Base UI 的 useDismiss 挂 document
 *  （floating-ui-react/hooks/useDismiss 实测）。只钉 window 会让走了新轨的
 *  面得到空虚绿：接线明明在 document 上重挂，探针看不见。两个目标都数，
 *  再由各用例只对**属于被测层的那一个**断言。 */
async function installEscapeTap(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as {
      __escTap: { winAdds: number; winRems: number; docAdds: number; docRems: number };
    };
    w.__escTap = { winAdds: 0, winRems: 0, docAdds: 0, docRems: 0 };
    const tap = (target: Window | Document, addsKey: 'winAdds' | 'docAdds', remsKey: 'winRems' | 'docRems') => {
      const add = target.addEventListener.bind(target);
      const rem = target.removeEventListener.bind(target);
      target.addEventListener = ((type: string, fn: unknown, opts?: unknown) => {
        if (type === 'keydown') w.__escTap[addsKey] += 1;
        return add(type, fn as EventListener, opts as boolean);
      }) as typeof target.addEventListener;
      target.removeEventListener = ((type: string, fn: unknown, opts?: unknown) => {
        if (type === 'keydown') w.__escTap[remsKey] += 1;
        return rem(type, fn as EventListener, opts as boolean);
      }) as typeof target.removeEventListener;
    };
    tap(window, 'winAdds', 'winRems');
    tap(document, 'docAdds', 'docRems');
  });
}

const readEscapeTap = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __escTap: Record<string, number> }).__escTap as {
        winAdds: number;
        winRems: number;
        docAdds: number;
        docRems: number;
      },
  );

async function openTypePopover(page: Page) {
  await typeBtn(page).click();
  await expect(typePopover(page)).toBeVisible();
}

test('开着的层不被重渲染重挂 Escape 接线：URL 写回后单次 Escape 仍收层', async ({ page }) => {
  await page.goto(EMPTY);
  await openTypePopover(page);
  await installEscapeTap(page);
  // URL 写回 → 看板重渲染（类型轴见底 = 空态分支成形）
  await typeOption(page, 'chore').click();
  await expect(page).toHaveURL(/[\?&]tags=chore(&|$)/);
  await expect(page.locator('.board-filter-empty')).toBeVisible();
  // 开层期零重挂——**在关层之前读**：关层本身必然产生一次 teardown，把它读
  // 进来就要额外论证「哪几次 rem 是合法的」，而那几个数字是具体实现的指纹
  // （手写族在 window 上挂 1 条，Base UI 在 document 上挂 2 条），钉它等于
  // 钉实现而非钉律。开层期读则两条机制同判：病根位（重挂）非零即红，
  // teardown 不混入。旧实现在此确定性红（URL 写回那次重渲染 rem+add）。
  expect(await readEscapeTap(page)).toEqual({
    winAdds: 0,
    winRems: 0,
    docAdds: 0,
    docRems: 0,
  });
  await page.keyboard.press('Escape');
  await expect(typePopover(page)).not.toBeVisible();
});

// —— #466：对话框族同根因钉（AlertDialogShell 的 Esc 接线）—————————————————
//
// 删除确认层的 window keydown 接线曾以 [onClose, open] 注册，而根组件
// （todo-detail-page）传的是内联箭头——根组件任何一次重渲染都 rem+add，
// 与 popover 面（#462 症状 2）同根同形。重渲染触发器换成 ⌘K 往返：
// useSearchState 的状态就住在根组件里，面板一开一关各 commit 一次，确认
// 层每次都吃到新的 onClose；面板在 Escape 前已自关，分层律不涉案（单次
// Esc 只收确认层）。旧实现在本触发器下确定性红于零重挂指纹（车道实测
// adds:2/rems:3，每次 commit 重挂一次）；可见律断言在旧实现下亦绿——重挂
// 赶在 Escape 派发抵 window 前 flush 完毕，判别力全在指纹侧。重挂即丢失
// 窗口：flush 若落进派发中途（useSearchState 的 Escape 分支正是 #462 钉下
// 的「更早 window 监听者触发 flush」位），该按即丢、弹层滞留到第二按。
// 本钉因此钉根因侧（开层期接线稳定），并同断用户可见律（单次 Escape 收层）。

const DETAIL = '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=27';
// #948 载体重钉（#910 裁定 1）：确认层 = getByRole('alertdialog')（壳自带
// role + aria-label）；删除行 = getByRole('menuitem', { name })。
// .detail-head-icon--more 是 detail 域残留别名（#945 面），不动。
const confirmDialog = (page: Page) => page.getByRole('alertdialog');
// #949: 面板载体 = role dialog + 可及名（.search-panel 类钉退役）
const searchPanel = (page: Page) => page.getByRole('dialog', { name: '搜索' });

test('确认弹层不被根组件重渲染重挂 Escape 接线：⌘K 往返后单次 Escape 仍收层', async ({
  page,
}) => {
  await page.goto(DETAIL);
  await page.locator('.detail-head-icon--more').click();
  await page.getByRole('menuitem', { name: '删除' }).click();
  await expect(confirmDialog(page)).toBeVisible();
  await installEscapeTap(page);
  // 根组件级重渲染往返：⌘K 开搜索面板（commit 1）、⌘K 关（commit 2）——
  // 每次 commit 都重建确认层吃到的内联 onClose 箭头
  await pressAndExpect(page, 'Meta+k', searchPanel(page));
  await pressAndExpect(page, 'Meta+k', searchPanel(page), 'hidden');
  // 开层期零重挂（旧实现：⌘K 往返每次 commit 重挂一次，实测 win adds:2/rems:3）
  // ——同 popover 钉，**关层之前读**，只钉律（重挂）不钉实现的 teardown 条数。
  //
  // **只断 window**：确认层走手写族（AlertDialogShell → dismiss.tsx 的
  // useEscapeClose），落点在 window——这正是本钉的主体。document 上的增删
  // 是 ⌘K 搜索面板（新轨，Base UI）自己开合产生的，与被测层无关；把它一并
  // 钉成零会在「重渲染触发器恰好是另一个弹层」时变成假红。它另有一套律，
  // 单列一条断言：**开过又关掉的层不留残线**（收支平衡，只断 parity 不断条数
  // ——条数是实现指纹，parity 才是「没泄漏」）。
  // Poll: Base UI search teardown can lag the hidden wait by a frame; CDS
  // shadow/radius class churn made the race flaky (docAdds=docRems+1).
  await expect
    .poll(async () => {
      const t = await readEscapeTap(page);
      return { win: { winAdds: t.winAdds, winRems: t.winRems }, balanced: t.docAdds === t.docRems };
    })
    .toEqual({ win: { winAdds: 0, winRems: 0 }, balanced: true });
  const tap = await readEscapeTap(page);
  await page.keyboard.press('Escape');
  await expect(confirmDialog(page)).not.toBeVisible();
});