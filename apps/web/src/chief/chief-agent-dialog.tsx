// 选择总管 Agent dialog (#182, r5 §2 绑定流): rides DialogShell (#68 家族律
// X/Esc/backdrop)。搜索框 + Agent 列(r5 截图 106 形态,几何 [推断] 贴
// new-task popover 行语言);live 面清单 = members 读面 memberType:"agent"
// 行(r5 §1:Agent 列表实走 GET teams/{id}/members),fixture 退 canon 单
// 默认行(r3-builder,r5 捕获名)。
// 选中流(r5 §2 wire 原样 PATCH {agent:{agentId,thinkingLevel:null}}):
// 未绑定 → 直发;已绑定且选中他员 → 换绑二次确认(shared
// CHIEF_REBIND_CONFIRM_COPY canon,<agent> 占位显示层替换);选中当前绑定
// = 空操作关窗。fixture 面 accept 律(#148:选择即关)。
// #209: 组件泛化为 agent 选择家族形态——title/confirmCopy 可选入参(缺省 =
// 总管 canon,本面行为字节不变),chip-popover「编辑分配」复用(r2 C.18:
// 该弹层内容从未捕获,任务面文案 [设计])。

// #318: 开始任务 dialog 的「选择 Agent」弹层复用(r9 §2.6:未指派 + agent 行
// 带 model 副题)——unassign 前置未指派行、option.model 副题、
// confirmRebind=false 跳过换绑二次确认(开始面重选无记忆告示语义)。

import { CHIEF_REBIND_CONFIRM_COPY, type TeamMember } from '@cairn/shared';
import { useEffect, useMemo, useState } from 'react';
import { SEARCH_BOX_CLS, SEARCH_INPUT_CLASS } from '../components/model-select-core.js';
import { Button } from '../components/ui/button.js';
import {
  DIALOG_PRIMARY_BUTTON,
  DIALOG_TEXT_BUTTON,
  DialogShell,
} from '../components/ui/dialog-shell.js';
import { Input } from '../components/ui/input.js';
import { SeededAvatar } from '../components/ui/seeded-avatar.js';
import { useI18n } from '../i18n/provider.js';
import { Check, Search } from '../icons/index.js';

/** Agent 候选行钮（#950 裸控件收编，旧 .chief-pick-row 等值：40 行 /
 *  14px 字 / px-8 / gap-10 / hover surface-secondary）。Button ghost 底座按
 *  七通道律归零（#908 裁决 3）；whitespace-normal 承旧行换行律（长名不截）；
 *  选中态只出 Check 勾不出底色（旧面同律）。 */
const AGENT_PICK_ROW_CLS =
  "h-10 w-full cursor-pointer justify-start gap-2.5 whitespace-normal rounded-none border-none bg-transparent px-2 text-left text-sm font-normal text-(--foreground) hover:bg-(--secondary) hover:text-(--foreground) dark:hover:bg-(--secondary) aria-expanded:bg-transparent aria-expanded:text-(--foreground) active:not-aria-[haspopup]:translate-y-0 [&_svg:not([class*='size-'])]:size-auto";

/** 头像位（旧 .chief-pick-avatar--img 等值，XMON-105 律：图即 24 圆盘，
 *  去 chip 底边——img 几何由 wrapper 的 [&_img] 与 SeededAvatar Root 定尺盒
 *  className 同值承载（#1003，contents 律随上游发丝环回源退役）。 */
const PICK_AVATAR_CLS = 'flex-none [&_img]:block [&_img]:size-6 [&_img]:rounded-full';

/** 选择器行最小投影(live = members 读面投影;fixture = canon 默认行)。
 *  #318: model 副题(r9 §2.6 行形「r3-builder · claude-sonnet-5 · 默认」的
 *  model 位;members 读面 actor.modelId 投影,无则不渲染副题)。 */
export interface ChiefAgentOption {
  id: string;
  name: string;
  model?: string;
  /** XMON-105: explicit avatar override (members read-side avatarUrl);
   *  null/absent = dicebear name seed, same law as every agent surface. */
  avatarUrl?: string | null;
}

/** #318 未指派行 id(开始 dialog 选择器;onBind('') = 双槽置 null)。 */
export const UNASSIGNED_AGENT_ID = '';

/** members 读面 → 选择器候选投影（#318 单源：detail 页与 board 页 #616 的
 *  开始任务 dialog 走同一份）。actor.modelId 有值才带副题；avatarUrl 覆盖
 *  律同 XMON-105 各 agent 面。 */
export function assignOptionsFromMembers(members: readonly TeamMember[]): ChiefAgentOption[] {
  return members
    .filter((m) => m.memberType === 'agent')
    .map((m) => {
      const actor = m.actor as
        | { displayName?: string; modelId?: string | null; avatarUrl?: string | null }
        | undefined;
      return {
        id: m.actorId,
        name: actor?.displayName ?? m.actorId,
        ...(actor?.modelId ? { model: actor.modelId } : {}),
        avatarUrl: actor?.avatarUrl ?? null,
      };
    });
}

/** fixture 面候选兜底(r5 捕获 Agent 名 canon;new-task DEFAULT_PROJECT 同律)。 */
const DEFAULT_AGENT: ChiefAgentOption = { id: 'r3-builder', name: 'r3-builder' };

interface ChiefAgentDialogProps {
  /** #73 retained-mount open flag。 */
  open?: boolean;
  onClose: () => void;
  /** 候选 Agent 集;缺省 = fixture canon 单默认行。 */
  agents?: ChiefAgentOption[];
  /** 当前绑定 Agent id(live 面真值);未绑定/缺省 = null。 */
  boundAgentId?: string | null;
  /** M5 live 面:选定 = PATCH chief agent 槽(父 onSuccess 关窗);缺省 =
   *  fixture 律(选择即关)。 */
  onBind?: (agentId: string) => void;
  /** #209: 标题(调用位预译,DialogShell 律);缺省 = 总管 canon。 */
  title?: string;
  /** #209: 换绑二次确认 copy(<agent> 占位显示层替换);缺省 = 总管记忆告示
   *  canon。 */
  confirmCopy?: string;
  /** #318: 前置「未指派」行(开始 dialog 选择器形态,r9 §2.6);选中走
   *  onBind(UNASSIGNED_AGENT_ID)。 */
  unassign?: boolean;
  /** #318: 已绑定后重选是否过换绑二次确认;false = 选择即发(开始面重选
   *  无记忆告示语义)。缺省 true(总管/编辑分配面字节不变)。 */
  confirmRebind?: boolean;
}

export function ChiefAgentDialog({
  open,
  onClose,
  agents,
  boundAgentId,
  onBind,
  title,
  confirmCopy,
  unassign,
  confirmRebind = true,
}: ChiefAgentDialogProps) {
  const { t } = useI18n();
  const dlgTitle = title ?? t('选择总管 Agent');
  const [query, setQuery] = useState('');
  const [confirming, setConfirming] = useState<ChiefAgentOption | null>(null);
  // retained mount:重开回列表态、清搜索(不带回上次残留)。
  useEffect(() => {
    if (open) {
      setQuery('');
      setConfirming(null);
    }
  }, [open]);
  const rows = useMemo(() => {
    const source = agents ?? [DEFAULT_AGENT];
    // #318 未指派行:恒在列首,搜索不滤除(它不是名字匹配对象,是清空动作)
    const withUnassign = unassign
      ? [{ id: UNASSIGNED_AGENT_ID, name: t('未指派') }, ...source]
      : source;
    const q = query.trim().toLowerCase();
    return q === ''
      ? withUnassign
      : withUnassign.filter(
          (row) => row.id === UNASSIGNED_AGENT_ID || row.name.toLowerCase().includes(q),
        );
  }, [agents, query, unassign, t]);

  const pick = (row: ChiefAgentOption) => {
    // 选中当前绑定 = 空操作(两态同律)。
    if (row.id === boundAgentId) {
      onClose();
      return;
    }
    if (onBind == null) {
      onClose(); // fixture accept 律:选择即关
      return;
    }
    // 已绑定 → 换绑二次确认(记忆不迁移告示 canon;#318 confirmRebind=false
    // 的开始面跳过);未绑定 → 直发,父 onSuccess 关窗(create-secret 同律)。
    if (confirmRebind && boundAgentId != null) {
      setConfirming(row);
      return;
    }
    onBind(row.id);
  };

  return (
    <DialogShell
      title={dlgTitle}
      open={open}
      onClose={onClose}
      size="m"
      footer={
        confirming != null ? (
          // e2e 载体 = getByRole('button')。
          <>
            <Button
              variant="ghost"
              className={DIALOG_TEXT_BUTTON}
              onClick={() => setConfirming(null)}
            >
              {t('取消')}
            </Button>
            <Button className={DIALOG_PRIMARY_BUTTON} onClick={() => onBind?.(confirming.id)}>
              {t('更换')}
            </Button>
          </>
        ) : undefined
      }
    >
      {confirming != null ? (
        <div className="flex flex-col gap-4">
          <p className="m-0 text-ui text-foreground">
            {t(confirmCopy ?? CHIEF_REBIND_CONFIRM_COPY).replaceAll('<agent>', confirming.name)}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className={SEARCH_BOX_CLS}>
            <Search width={14} height={14} />
            {/* #855→#950：Input 原语 + SEARCH_INPUT_CLASS 中和件单源
                （model-select-core，两面同形）；框形由 SEARCH_BOX_CLS 承载，
                环走 #388 家族律。e2e 载体 = getByPlaceholder / role。 */}
            <Input
              className={SEARCH_INPUT_CLASS}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('搜索 Agent…')}
            />
          </div>
          <div
            className="flex max-h-60 flex-col overflow-y-auto"
            role="listbox"
            aria-label={dlgTitle}
          >
            {rows.length === 0 ? (
              <div className="px-2 py-4 text-center text-ui text-content-tertiary">
                {t('没有匹配的 Agent')}
              </div>
            ) : (
              rows.map((row) => (
                <Button
                  key={row.id}
                  variant="ghost"
                  className={AGENT_PICK_ROW_CLS}
                  role="option"
                  aria-selected={row.id === boundAgentId}
                  onClick={() => pick(row)}
                >
                  {/* XMON-105: agent rows carry the agent's own avatar
                      (same identity as team page / board / transcript);
                      the initial chip was a divergent third style. */}
                  <span className={PICK_AVATAR_CLS}>
                    <SeededAvatar
                      className="size-6"
                      name={row.name}
                      src={row.avatarUrl}
                      fallback="/avatar-robot-1.svg"
                    />
                  </span>
                  <span>{row.name}</span>
                  {row.model != null && row.model !== '' && (
                    <span className="text-xs text-(--text-tertiary)">{row.model}</span>
                  )}
                  {row.id === boundAgentId && (
                    <span className="ml-auto flex flex-none text-(--text-tertiary)">
                      <Check width={14} height={14} />
                    </span>
                  )}
                </Button>
              ))
            )}
          </div>
        </div>
      )}
    </DialogShell>
  );
}
