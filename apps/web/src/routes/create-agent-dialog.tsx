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
// Paper form (DESIGN.md「页面模式 · 表单」): FormStack of label-above
// fields, boxed 32px controls, and a FormActions row in the dialog footer
// (取消 text button, 创建 ink primary on the right).
//
// #485 模型槽两态（原版两处实测：r2 §8.1 capture 20 = 尚未配置服务商时的
// 告警行 + `配置服务商` 外链；r3 §2 = 服务商配好后同一弹窗的「模型」下拉）：
// 候选非空 → 弹窗内两级选（t-0024：先运行时/服务商、再它名下的模型；POST
// body 的 provider/modelId 两字段带上，全程不跳页）；候选空 → 保留告警行与
// 外链（不存在的服务商没法"在弹窗内选"，外链是唯一出路）。改前的单平铺下拉
// 把 provider 与模型混在一列（用户原话「全部混杂在一起」），两级化后行标签
// 只出模型名——原版的 `· 128k` 是原版内置模型目录的上下文窗口，cairn 是本
// 地 BYOK，没有这个数据源。

import { cn } from 'cn';
import { useState } from 'react';
import { Link, useLocation } from 'react-router';
import { FORM_CONTROL_CLS, FormActions, FormField, FormStack } from '../components/form-layout.js';
import { CARD_RADIUS_CLS } from '../components/settings-list.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import { Input } from '../components/ui/input.js';
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

/** Paper form control stretched to the dialog column. */
const CONTROL_CLS = cn('w-full', FORM_CONTROL_CLS);

/** One-off notice card (no machine / no model source) with its fix-it link. */
const NOTICE_CLS = cn(
  'flex items-center gap-2 bg-card px-3 py-2 text-ui text-content-secondary ring-1 ring-border',
  CARD_RADIUS_CLS,
);
const NOTICE_LINK_CLS = 'ml-auto text-(--card-button) no-underline hover:underline';

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
      size="m"
      footer={
        <FormActions
          className="pt-0"
          secondary={{ label: t('取消'), onClick: onClose }}
          primary={{
            label: t('创建'),
            disabled: name.trim() === '' || machineId === null,
            onClick: submit,
          }}
        />
      }
    >
      <FormStack>
        {/* testid = 二级载体（img 在 loaded 前被 registry keepMounted 置
            aria-hidden，role 钉不到；dead-buttons / avatar-dicebear 的定位面）。
            #387: 头像 = 名称种子的 dicebear 预览，空名退回静态机器人资产。 */}
        <div className="flex items-center" data-testid="agent-avatar">
          <SeededAvatar name={name.trim()} fallback="/avatar-robot-1.svg" className="size-10" />
        </div>
        <FormField label={t('名称')} htmlFor="dlg-agent-name">
          <Input
            id="dlg-agent-name"
            className={FORM_CONTROL_CLS}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('输入 Agent 名称')}
          />
        </FormField>
        {machines.length === 0 ? (
          // #1259：无机器 = 创建不可能（归属机必填），机器告警行优先于
          // 服务商告警行。
          <div className={NOTICE_CLS}>
            <span>{t('还没有接入机器')}</span>
            <Link className={NOTICE_LINK_CLS} to={{ pathname: MACHINES_HREF, search }}>
              {t('接入机器')}
            </Link>
          </div>
        ) : (
          <>
            <FormField label={t('运行时')} htmlFor="dlg-agent-runtime">
              <AgentRuntimeSelect
                id="dlg-agent-runtime"
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
                triggerClassName={CONTROL_CLS}
              />
            </FormField>
            <FormField label={t('归属机')} htmlFor="dlg-agent-machine">
              <Select
                value={machineId}
                onValueChange={(next) => {
                  if (next !== machineId) setModelId(null);
                  setMachineId(next as string | null);
                }}
              >
                <SelectTrigger
                  id="dlg-agent-machine"
                  className={cn('dlg-agent-machine-select', CONTROL_CLS)}
                >
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
            </FormField>
            {modelOptions.length > 0 ? (
              <FormField label={t('模型')} htmlFor="dlg-agent-model">
                <AgentModelSelect
                  id="dlg-agent-model"
                  provider={provider}
                  modelId={modelId}
                  options={machineModelOptions}
                  disabled={provider === 'claude-code' && machineId === null}
                  onPick={setModelId}
                  prefix="dlg-agent-model"
                  triggerClassName={CONTROL_CLS}
                />
              </FormField>
            ) : (
              // modelOptions 空 = 没有任何 claude-code 候选（pi 创建不受阻——
              // 运行时/归属机两槽已够）；告警行退成信息性，不再顶掉整个表单。
              <div className={NOTICE_CLS}>
                <span>{t('尚未配置模型服务商')}</span>
                <Link className={NOTICE_LINK_CLS} to={{ pathname: PROVIDERS_HREF, search }}>
                  {t('配置服务商')}
                </Link>
              </div>
            )}
          </>
        )}
      </FormStack>
    </DialogShell>
  );
}
