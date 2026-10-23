// 应用内目录浏览器（ADR 0003 D5/D6，#441）：remote/headless 形态下
// POST /api/fs/pick 422 unavailable 的兜底——server readdir 只读投影
// （GET /api/fs/list，数据源单源 = shared FsListResult）经面包屑 + 逐级下钻
// 浏览，单击行「选择」回填。组件边界 = 「带浏览能力的路径输入框」的浏览面，
// 本票只接新建项目 localPath 一个消费点（ProjectNewPage），不铺第二消费者。
//
// 失败方式清单钉在 e2e/project-new-dir-browser.spec.ts（W 族）：
// - 起点 = localStorage lastDir（记住上次位置，W1）；无效则自动回落缺省
//   HOME（server 判 $HOME，web 无从知道，W2）——dir=null = 缺省请求。
// - 列表 500/网络错 = overlay 内错误行、overlay 不关、面包屑仍可导航重试（W3）；
//   面包屑真值走 lastGoodPath ref，错误面（无 data）不塌缩。
// - 快速连点导航 = queryKey 含 dir 按键隔离 + keepPreviousData 防塌缩闪烁（W4）。
// - dotfiles 默认隐藏 + toggle（aria-pressed 可断言，仿 macOS ⌘⇧.，W8）；
//   server 全量返回，隐藏/toggle 是本显示层语义（F16）。
// - 空目录空态、超大目录截断提示（truncated 旗标，W9/W10）。
// - localStorage 隐私模式抛 = 读写 try/catch 降级（缺省起点、不记住，W13）。
// 弹层承载 = registry Popover（#983 floating-shell 族拆判决：锚定 absolute
// 族 → Popover，Positioner 锚定）——Esc / 外点关 / 焦点归还 / 进出场动效全归
// Base UI 原语；外点语义随壳退役换原生 outside-press（穿透下层，#425 遗留
// 待定项按 #991 归原型实审裁决）。
// #946：per-face 类（dir-browser-*）退役——e2e 载体迁语义位
// （role=dialog/list/listitem、按钮文案、aria-pressed）。

import { FS_LIST_MAX_ENTRIES } from '@cairn/shared';
import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client.js';
import { useFsList } from '../api/hooks.js';
import { Button } from '../components/ui/button.js';
import { PopoverContent } from '../components/ui/popover.js';
import { useI18n } from '../i18n/provider.js';
import { ChevronRight, GitCommit } from '../icons/index.js';

/** 记住上次位置的 localStorage 键（单租户单机，ADR 0003 D5）。 */
const LAST_DIR_KEY = 'cairn.dirBrowser.lastDir';

/** 面包屑段钮：ghost 件默认形态 + 紧凑布局位；末段（aria-current=location）
 *  加重 = 状态载体，字重/墨色走 registry 词汇。 */
const CRUMB_CLS =
  'h-auto max-w-40 shrink cursor-pointer truncate p-1 font-normal text-muted-foreground hover:text-foreground aria-[current=location]:font-medium aria-[current=location]:text-foreground';

/** 行名钮：ghost 件；行盒（li）是唯一 hover 涂底面（hover:bg-accent，
 *  registry 菜单行词汇），行内钮自身涂底并掉——一个可供性面不叠两层。 */
const ROW_NAME_CLS =
  'h-auto min-w-0 flex-1 cursor-pointer justify-start truncate px-1.5 py-1 font-normal hover:bg-transparent dark:hover:bg-transparent';

/** 「选择」钮：outline 件 xs 档；静息隐身，行 hover（group）/自身
 *  focus-visible 现身（渐进披露是交互设计位，非皮肤）。 */
const PICK_CLS =
  'flex-none cursor-pointer opacity-0 group-hover:opacity-100 focus-visible:opacity-100';

function readLastDir(): string | null {
  try {
    return window.localStorage.getItem(LAST_DIR_KEY);
  } catch {
    return null; // 隐私模式等抛 = 无记忆起点（W13）
  }
}

function writeLastDir(path: string): void {
  try {
    window.localStorage.setItem(LAST_DIR_KEY, path);
  } catch {
    // 写不进 = 不记住，浏览本身不受损（W13）
  }
}

/** 绝对路径 → 面包屑段（根 `/` 单段起，逐段累积 canonical 前缀）。 */
function breadcrumb(path: string): { label: string; path: string }[] {
  const segs = [{ label: '/', path: '/' }];
  let acc = '';
  for (const part of path.split('/')) {
    if (part === '') continue;
    acc += `/${part}`;
    segs.push({ label: part, path: acc });
  }
  return segs;
}

/** 目录浏览弹层板（#983 floating-shell 族拆判决：registry Popover 承载）。
 *  本件只渲 PopoverContent——Popover Root/Trigger 归消费点（project-new-page
 *  的 浏览 钮 = Trigger；422 兜底的程序开面走受控 open）。开面即挂载：
 *  lastDir 起点走 useState 惰性初始化（记住上次位置 W1，单请求——挂载即
 *  dir 就位，无「缺省 + lastDir」双发面）；关面即卸载，状态自然归零。 */
export function DirBrowser({
  onPick,
}: {
  /** 单击行「选择」：回填该目录 canonical 绝对路径（消费点接输入框 + 关面）。 */
  onPick: (path: string) => void;
}) {
  const { t } = useI18n();
  const [dir, setDir] = useState<string | null>(() => readLastDir());
  const [showDotfiles, setShowDotfiles] = useState(false);

  const listQ = useFsList(dir, true);

  // 面包屑/记住位置真值 = canonical path（非 placeholder 的成功数据）。错误面
  // （无 data）走 lastGoodPath ref 不塌缩（W3）；列表成功即写 lastDir（W6）。
  const lastGoodPath = useRef<string | null>(null);
  const dataPath = listQ.data && !listQ.isPlaceholderData ? listQ.data.path : null;
  useEffect(() => {
    if (dataPath !== null) {
      lastGoodPath.current = dataPath;
      writeLastDir(dataPath);
    }
  }, [dataPath]);
  const currentPath = dataPath ?? lastGoodPath.current;

  // W2 lastDir 失效（被删/变文件/不可读）= 自动回落缺省 HOME，不死端。dir=null
  // 缺省面自身错误不再回落（防 null→null 循环），落错误行（W3）。
  const reason = listQ.error instanceof ApiError ? listQ.error.reason : undefined;
  useEffect(() => {
    if (
      dir !== null &&
      (reason === 'not_found' || reason === 'not_dir' || reason === 'not_readable')
    ) {
      setDir(null);
    }
  }, [dir, reason]);

  const entries = listQ.data?.entries ?? [];
  const visible = showDotfiles ? entries : entries.filter((e) => !e.name.startsWith('.'));
  const crumbs = currentPath !== null ? breadcrumb(currentPath) : [];

  return (
    <PopoverContent side="bottom" align="end" sideOffset={8} aria-label={t('浏览本地文件夹')}>
      <div className="flex items-center gap-2 px-1">
        <nav className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5">
          {crumbs.map((seg, i) => (
            <span key={seg.path} className="inline-flex min-w-0 items-center gap-0.5">
              {i > 0 && (
                <span className="inline-flex text-muted-foreground" aria-hidden="true">
                  <ChevronRight width={12} height={12} />
                </span>
              )}
              {/* XMON-25 收编：ghost；h-auto 保内容高（focus 环矩形 =
                    现行为）、shrink 保面包屑挤压可缩（base shrink-0 会改
                    溢出行为）。hover 提亮 + 下划线 = 原 per-face hover 面；
                    末段（aria-current=location）primary 墨 + 500 字重。 */}
              <Button
                variant="ghost"
                className={CRUMB_CLS}
                // 末段 = 当前目录（不可再下钻到自己，仍渲染为钮保持一致性）。
                aria-current={i === crumbs.length - 1 ? 'location' : undefined}
                onClick={() => setDir(seg.path)}
              >
                {seg.label}
              </Button>
            </span>
          ))}
        </nav>
        {/* toggle 钮：registry 形态 outline/secondary 双档（aria-pressed
              选中态载体保持，品牌描边 pill 手写皮肤退役）。 */}
        <Button
          variant={showDotfiles ? 'secondary' : 'outline'}
          size="xs"
          className="flex-none whitespace-nowrap"
          aria-pressed={showDotfiles}
          onClick={() => setShowDotfiles((v) => !v)}
        >
          {t('显示隐藏文件')}
        </Button>
      </div>
      <ul className="flex max-h-72 flex-col overflow-y-auto">
        {listQ.isError ? (
          <div className="px-3 py-2 text-xs leading-4 text-destructive" role="alert">
            {(listQ.error as Error).message}
          </div>
        ) : (
          visible.map((entry) => {
            const base = currentPath ?? '/';
            // canonical 绝对路径 + 目录名 → 子路径（base 恒以 `/` 开头无尾斜杠）。
            const child = base === '/' ? `/${entry.name}` : `${base}/${entry.name}`;
            return (
              <li
                className="group flex h-8 items-center gap-1.5 rounded-md px-1 hover:bg-accent"
                key={entry.name}
              >
                {/* 行钮：ghost；行盒（li hover:bg-accent）是唯一涂底面，
                      行内钮自身 hover 涂底并掉——一个可供性面不叠两层。 */}
                <Button variant="ghost" className={ROW_NAME_CLS} onClick={() => setDir(child)}>
                  {entry.name}
                </Button>
                {entry.git && (
                  <span
                    className="inline-flex flex-none text-primary"
                    role="img"
                    aria-label={t('git 仓库')}
                  >
                    <GitCommit width={13} height={13} />
                  </span>
                )}
                {/* 「选择」：outline xs 档；opacity 0→1（行 hover 经 group /
                      自身 focus-visible）渐进披露。 */}
                <Button
                  variant="outline"
                  size="xs"
                  className={PICK_CLS}
                  onClick={() => onPick(child)}
                >
                  {t('选择')}
                </Button>
              </li>
            );
          })
        )}
        {!listQ.isError &&
          !listQ.isPlaceholderData &&
          listQ.data !== undefined &&
          visible.length === 0 && (
            <li className="px-3 py-2 text-xs leading-4 text-muted-foreground">
              {/* 真无子目录 vs 子目录全被 dotfiles 隐藏（toggle 是就近 affordance）
                    ——两态分译，不对「有但隐藏」谎称「没有」。 */}
              {entries.length === 0 ? t('没有子目录') : t('子目录均已隐藏')}
            </li>
          )}
      </ul>
      {listQ.data?.truncated === true && (
        <div className="border-t border-border p-1 text-xs leading-4 text-muted-foreground">
          {t('目录条目过多，只列出前 {n} 条', { n: FS_LIST_MAX_ENTRIES })}
        </div>
      )}
    </PopoverContent>
  );
}
