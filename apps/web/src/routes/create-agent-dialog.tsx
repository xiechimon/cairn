// 创建 Agent dialog (issue #170, r2 §8.1 capture 20): rides DialogShell
// (#68 family law — X / Esc / backdrop close, no self-built overlay). The
// form is name-first: avatar row / 名称 input / model slot / 创建 primary.
// Live submit = mutations.createAgent (POST /api/teams/:id/agents → 201
// {id}, r5 §1); fixture follows the accept-dialog precedent (#148: close on
// submit, no backend). The 更换 ink beside the avatar is removed (#307
// wontfix, spec 08 档 4): the avatar is the static robot asset and no upload
// face exists — this item's #148 capture-verbatim-chrome verdict is
// re-adjudicated 移除 (the account-swap twin stays with 档 3, out of this
// ticket).
//
// B2 · secondary 面（XMON-20）：弹窗内两件控件（提交钮、名称输入）全走
// components/ui 件。#952（正典表 §5.3/§5.4，ui/dialog.css 退役）：.dlg-form*
// 族类 → utility 等值迁移（单源同 #944 的 LABEL_CLS 律）、.dlg-form-input 摘类
// （几何即件正典 h-8，36px 不存续）、.dlg-agent-create → Button default + w-full
// （§2.6-3 迁移位；散写形差额并项——字重 400、无按下位移——原样承接）。
//
// #485 模型槽两态（原版两处实测：r2 §8.1 capture 20 = 尚未配置服务商时的
// 告警行 + `配置服务商` 外链；r3 §2 = 服务商配好后同一弹窗的「模型」下拉）：
// 候选非空 → 弹窗内两级选（t-0024：先运行时/服务商、再它名下的模型；POST
// body 的 provider/modelId 两字段带上，全程不跳页）；候选空 → 保留告警行与
// 外链（不存在的服务商没法"在弹窗内选"，外链是唯一出路）。改前的单平铺下拉
// 把 provider 与模型混在一列（用户原话「全部混杂在一起」），两级化后行标签
// 只出模型名——原版的 `· 128k` 是原版内置模型目录的上下文窗口，pacman 是本
// 地 BYOK，没有这个数据源。

import { useState } from 'react';
import { Link, useLocation } from 'react-router';
import { Button } from '../components/ui/button.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import { Input } from '../components/ui/input.js';
import { Label } from '../components/ui/label.js';
import { SeededAvatar } from '../components/ui/seeded-avatar.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select.js';
import type { MachineRow, ModelOption } from '../fixtures/records.js';
import { useI18n } from '../i18n/provider.js';
import { MACHINES_HREF } from '../resources/machines-page.js';
import { PROVIDERS_HREF } from '../resources/providers-page.js';
import { AgentModelSelect, AgentRuntimeSelect } from './agent-model-select.js';

/** 槽位标签（运行时/模型 span，无控件配对不走 label 元素）：registry Label
 *  同款排印（text-sm leading-none font-medium）；12px/0.01em 手写档退役。 */
const SLOT_LABEL_CLS = 'text-sm leading-none font-medium';

/** POST agents body 的创建面字段（reason = 词表最小形 + #485 的模型槽）。 */
export interface CreateAgentInput {
  displayName: string;
  provider?: string | null;
  modelId?: string | null;
  /** #1259 归属机：创建必填（server 契约同）。 */
  machineId: string;
}

interface CreateAgentDialogProps {
  /** #73 retained-mount open flag. */
  open?: boolean;
  onClose: () => void;
  /** M5 live 面：创建 = POST agents（displayName + #485 选定的模型槽）；
   *  缺省 = fixture 律（创建即关，#148 accept-dialog 先例）。 */
  onCreate?: (input: CreateAgentInput) => void;
  /** #485: 模型候选（model-sources 非 pi 段，#770 起 providers 段已除；
   *  投影单源 = api/mappers.ts toModelOptions）。非空 = 出模型选择器；
   *  空 = 出「尚未配置模型服务商」告警行 + 配置外链（原版 r2 §8.1 capture
   *  20 与 r3 §2 两态：服务商配好后同一弹窗出「模型」下拉）。 */
  modelOptions?: ModelOption[];
  /** #1259 归属机候选（团队机器行）；空 = 出「还没有接入机器」告警行。 */
  machines?: MachineRow[];
  /** 机器详情页的预选归属机（「在这台机器新建 agent」入口）。 */
  defaultMachineId?: string;
}

export function CreateAgentDialog({
  open,
  onClose,
  onCreate,
  modelOptions = [],
  machines = [],
  defaultMachineId,
}: CreateAgentDialogProps) {
  const { t } = useI18n();
  // the link carries the scenario string along so dev/fixture
  // selection survives the hop (#121)
  const { search } = useLocation();
  const [name, setName] = useState('');
  // t-0024 两级：一级 provider 位与二级 modelId 分开持（POST body 本就是两
  // 字段）。换一级清二级——modelId 只在 provider 内有意义，跨 provider 带过去
  // 是脏值（概览 tab 同律）。#1259 起三级：运行时 → 归属机 → 该机模型，
  // 换上游清下游。
  const [provider, setProvider] = useState<string | null>(null);
  const [machineId, setMachineId] = useState<string | null>(defaultMachineId ?? null);
  const [modelId, setModelId] = useState<string | null>(null);
  // 归属机候选 = 开了该 runtime 的机器（server 创建校验同律，选择器先拦
  // 一轮）。provider null = 内置 (pi)。
  const runtime = provider === 'claude-code' ? 'claude-code' : 'pi';
  const machineCandidates = machines.filter((m) => (m.enabledRuntimes ?? []).includes(runtime));
  // 模型候选按归属机过滤（claude-code 段带 machineId；pi 无模型候选，
  // 二级本就 disabled）。
  // claude-code 未选归属机时候选放空——别把他机模型漏进菜单（选了也
  // 过不了 server 校验）。
  const machineModelOptions =
    provider === 'claude-code'
      ? machineId === null
        ? []
        : modelOptions.filter((o) => o.machineId === machineId)
      : modelOptions;
  const submit = () => {
    const displayName = name.trim();
    if (displayName === '' || machineId === null) return;
    if (onCreate != null) {
      onCreate({ displayName, provider, modelId, machineId });
    } else {
      onClose();
    }
    setName('');
    setProvider(null);
    setMachineId(defaultMachineId ?? null);
    setModelId(null);
  };
  return (
    <DialogShell
      title={t('创建 agent')}
      open={open}
      onClose={onClose}
      // 裸内容进 DialogFooter（壳组合 registry dialog 件后 band 自带 p-4，
      // 自携 padding 包装会双垫）；Button default 档 + w-full 钉底独占。
      // （#1006 段 2 与 #1007 各自独立修到同一形态，merge 取 L4 全清理版：
      // 旧包装 div 会把 w-full 钮塌成内容宽，drive-952-finale B3 实测 30px。）
      footer={
        <Button
          className="w-full"
          disabled={name.trim() === '' || machineId === null}
          onClick={submit}
        >
          {t('创建')}
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        {/* #951（detail/overlays.css 清零）：.dlg-agent-avatar 律等值迁
            utility——行 12 gap；img 40×40 圆（per-face 容器是 img 几何正本，
            SeededAvatar 契约）。testid = 二级载体（img 在 loaded 前被 registry
            keepMounted 置 aria-hidden，role 钉不到；dead-buttons /
            avatar-dicebear 的定位面，#910 裁定 1）。 */}
        <div className="flex items-center gap-3" data-testid="agent-avatar">
          {/* #387: 头像行 = 名称种子的 dicebear 预览——随输入即所得（创建后
              同名恒同像）；空名退回静态机器人资产。「更换」钮全除（#307
              wontfix）：栈内无上传面。 */}
          <SeededAvatar name={name.trim()} fallback="/avatar-robot-1.svg" className="size-10" />
        </div>
        {/* CJK 墨盒满 em 见方：registry Label 默认 leading-none 让标签贴行底、
            被邻位 Input focus 环压住（本行实踩）——leading-tight（1.25）就地
            修正，件保持 pristine（#980 S5 棘轮：偏差只进 adapter/调用位）。 */}
        <Label htmlFor="dlg-agent-name" className="leading-tight">
          {t('名称')}
        </Label>
        <Input
          id="dlg-agent-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t('输入 Agent 名称')}
        />
        {/* #485 两态：有服务商 → 弹窗内两级选（运行时/服务商 → 它名下的模型，
            不跳页）；无服务商 → 告警行 + 配置外链（capture 20 原样）。 */}
        {machines.length === 0 ? (
          // #1259：无机器 = 创建不可能（归属机必填），机器告警行优先于
          // 服务商告警行。
          <div className="flex items-center gap-2 rounded-lg border border-input bg-card px-3 py-2 text-sm leading-4 text-muted-foreground">
            <span>{t('还没有接入机器')}</span>
            <Link className="ml-auto text-primary" to={{ pathname: MACHINES_HREF, search }}>
              {t('接入机器')}
            </Link>
          </div>
        ) : (
          <>
            {/* #951：.dlg-agent-slot-row 律等值迁 utility（标签与选择器纵向
                排布，6 gap）。#1010：选择器皮肤/几何归 registry select 默认
                （DLG_AGENT_SELECT_* 常量退役，ADR 0012 D1）；本面只留 w-full
                布局位（撑满行宽，#983 宽度归消费点判例）。菜单锚位/封顶归
                Base UI Positioner（碰撞翻转 + --available-height），旧
                bottom 锚 + max-h-192 覆写随 absolute 壳退役。 */}
            <div className="flex flex-col gap-1.5">
              <span className={SLOT_LABEL_CLS}>{t('运行时')}</span>
              <AgentRuntimeSelect
                value={provider}
                options={modelOptions}
                onPick={(next) => {
                  if (next !== provider) {
                    setModelId(null);
                    if (defaultMachineId === undefined) setMachineId(null);
                  }
                  setProvider(next);
                }}
                prefix="dlg-agent-runtime"
                triggerClassName="w-full"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className={SLOT_LABEL_CLS}>{t('归属机')}</span>
              <Select
                value={machineId}
                onValueChange={(next) => {
                  if (next !== machineId) setModelId(null);
                  setMachineId(next as string | null);
                }}
              >
                <SelectTrigger className="dlg-agent-machine-select w-full">
                  <SelectValue>
                    {machineCandidates.find((m) => m.id === machineId)?.name ?? t('选择机器')}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent aria-label={t('归属机')}>
                  {machineCandidates.map((m) => (
                    <SelectItem key={m.id} className="dlg-agent-machine-row" value={m.id ?? ''}>
                      {m.name}
                      {m.online === false ? `（${t('离线')}）` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {modelOptions.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                <span className={SLOT_LABEL_CLS}>{t('模型')}</span>
                <AgentModelSelect
                  provider={provider}
                  modelId={modelId}
                  options={machineModelOptions}
                  disabled={provider === 'claude-code' && machineId === null}
                  onPick={setModelId}
                  prefix="dlg-agent-model"
                  triggerClassName="w-full"
                />
              </div>
            ) : (
              // modelOptions 空 = 没有任何 claude-code 候选（pi 创建不受阻——
              // 运行时/归属机两槽已够）；告警行退成信息性，不再顶掉整个表单。
              <div className="flex items-center gap-2 rounded-lg border border-input bg-card px-3 py-2 text-sm leading-4 text-muted-foreground">
                <span>{t('尚未配置模型服务商')}</span>
                <Link className="ml-auto text-primary" to={{ pathname: PROVIDERS_HREF, search }}>
                  {t('配置服务商')}
                </Link>
              </div>
            )}
          </>
        )}
      </div>
    </DialogShell>
  );
}
