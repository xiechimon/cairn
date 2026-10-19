// 添加模型服务 dialog（#355，spec 11 §A6 picker 形态）：搜索框 + 38 行
// preset + 底部「自定义端点」入口。preset 目录 wire 真值仅 {id, auth,
// oauthLabel}（r3 §2 盘点序 = server providerPresets() 原样；目录外字段
// baseUrl/api 未采不发明）→ 显示名以 spec 11 实测 38 名表为文案源（品牌名
// 不译），api_key 行的「密钥表单」= 现有自定义表单（字段权威 = shared
// createProviderBodySchema / r3 §2）+ providerId/label 预填。
// OAuth 链（#231/#243）原样保留：徽标行 = shared PROVIDER_OAUTH_PRESET_IDS
// ∩ OAUTH_FAMILIES（族表已接线成员，现仅 github-copilot），点击 =
// onConnect(preset id)——live 面 POST authorize → 同页签跳授权页；fixture
// 面 accept 律关窗。#385：族表外的 OAuth preset（openai-codex）不再渲染徽标
// 与可点授权——行禁用 + 右端「暂未开通」注记（消「广告了但点不通」的 404
// 误导；authorize 真路径归 #301 触发线后）。失败 inline：connectError 行由
// providers-page 喂入（authorize 400 原文 / callback 落地 reason 三译），
// 本组件只渲染。xai 双通道：picker 行无徽标，oauthLabel 展示在其密钥表单内
//（族表外无后端面，不做钮 #222）。
// Rides DialogShell（#68 family law — X / Esc / backdrop）。#193：字段骑
// .dlg-body，submit 骑 footer 槽；picker 面无必填字段 → 不渲染 footer
// （禁用态死 submit 不出现，#222）。State 重置在 open→false 边（live 失败
// 不关窗、输入保全）；form 视图每次进入 = 干净表单（入口边重置，列表 ↔
// 表单往返不带残值）。
// #944 正典表执行（spec/22 §5.1/§5.3/§5.4）：老 ui/input 六处 →
// components/ui Input（36px→h-8 32px，§2.6-1，getByLabel/placeholder 载体
// 不动）；
// .dlg-form-seg/.dlg-provider-seg-tab → 表单 Select（三个协议名共需约 460px，
// 弹窗栏宽 416，分段放不下，DESIGN.md 表单：取值控件 = SelectTrigger +
// FORM_CONTROL_CLS）；行钮收编 Button（#851 裸控件账）。
// data-preset-id 保留 = 行级二级载体。
// Paper 表单（DESIGN.md 页面模式 · 表单）：密钥表单 = FormStack / FormField，
// footer = FormActions（取消 + 添加模型服务，不是整宽提交条）；
// picker 行钮走 Button outline 默认档、行右 chip 走 Badge 默认档（PICKER_ROW/
// ROW_CHIP 皮肤配方退役）；ghost 文字钮的七通道中和退役（件默认 hover/按下
// 态回归）。

import {
  OAUTH_FAMILIES,
  PROVIDER_OAUTH_PRESET_IDS,
  PROVIDER_PRESET_IDS,
  PROVIDER_XAI_PRESET,
  type ProviderApi,
} from '@pacman/shared';
import { useEffect, useState } from 'react';
import { FORM_CONTROL_CLS, FormActions, FormField, FormStack } from '../components/form-layout.js';
import { Badge } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import { Checkbox } from '../components/ui/checkbox.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import { Field, FieldDescription, FieldError, FieldTitle } from '../components/ui/field.js';
import { Input } from '../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select.js';
import { useI18n } from '../i18n/provider.js';
import { ChevronLeft, PlusSmall } from '../icons/index.js';

const FIELD_TITLE_CLS = 'text-ui font-medium text-foreground';

/** picker 行钮（preset 38 行 + 自定义端点入口）：Button outline 默认档 +
 *  左对齐 layout（#1005：皮肤/状态全走件默认）。 */
const PICKER_ROW_CLS = 'justify-start px-3 text-left';

/** API 协议段（r3 §2 实测文案与顺序；wire 值 = providerApiSchema）。 */
const API_OPTIONS: readonly { value: ProviderApi; label: string }[] = [
  { value: 'openai-completions', label: 'OpenAI Completions' },
  { value: 'openai-responses', label: 'OpenAI Responses' },
  { value: 'anthropic-messages', label: 'Anthropic Messages' },
];

/** 上游 38 项 preset 显示名（spec 11 §A6 实测名表，2026-09-28）。键型 =
 * 目录 id 联合——1:1 完整性由编译器钉（漏名/多名即 typecheck 红）。 */
const PRESET_LABELS: Record<(typeof PROVIDER_PRESET_IDS)[number], string> = {
  'github-copilot': 'GitHub Copilot',
  'openai-codex': 'OpenAI Codex',
  xai: 'xAI',
  'amazon-bedrock': 'Amazon Bedrock',
  'ant-ling': 'Ant Ling',
  anthropic: 'Anthropic',
  baseten: 'Baseten',
  cerebras: 'Cerebras',
  'cloudflare-ai-gateway': 'Cloudflare AI Gateway',
  'cloudflare-workers-ai': 'Cloudflare Workers AI',
  deepseek: 'DeepSeek',
  fireworks: 'Fireworks',
  google: 'Google',
  'google-vertex': 'Google Vertex AI',
  groq: 'Groq',
  huggingface: 'Hugging Face',
  'kimi-coding': 'Kimi For Coding',
  minimax: 'MiniMax',
  'minimax-cn': 'MiniMax CN',
  mistral: 'Mistral',
  moonshotai: 'Moonshot AI',
  'moonshotai-cn': 'Moonshot AI CN',
  nvidia: 'NVIDIA',
  openai: 'OpenAI',
  opencode: 'OpenCode Zen',
  'opencode-go': 'OpenCode Go',
  openrouter: 'OpenRouter',
  'qwen-token-plan': 'Qwen Token Plan',
  'qwen-token-plan-cn': 'Qwen Token Plan CN',
  'qwen-token-plan-individual': 'Qwen Token Plan Individual',
  together: 'Together',
  'vercel-ai-gateway': 'Vercel AI Gateway',
  xiaomi: 'Xiaomi',
  'xiaomi-token-plan-ams': 'Xiaomi Token Plan AMS',
  'xiaomi-token-plan-cn': 'Xiaomi Token Plan CN',
  'xiaomi-token-plan-sgp': 'Xiaomi Token Plan SGP',
  'z-ai': 'Z.AI',
  'z-ai-coding-cn': 'Z.AI Coding CN',
};

/** 族表已接线的 OAuth preset（#385：徽标 + authorize 点击只给这些行；
 *  族表外的 OAuth preset = 上游类型真值留档但本 server 无后端面）。 */
const WIRED_OAUTH_IDS: ReadonlySet<string> = new Set(OAUTH_FAMILIES.map((f) => f.presetId));

/** picker 行（静态投影，目录序 = wire 序）。oauth 位 = 徽标 + 点击分支；
 * 展宽 readonly string[] = .includes 收下 38-id 联合的入参位。 */
const PRESET_ROWS = PROVIDER_PRESET_IDS.map((id) => {
  const oauth = (PROVIDER_OAUTH_PRESET_IDS as readonly string[]).includes(id);
  return {
    id,
    label: PRESET_LABELS[id],
    oauth,
    /** #385：oauth && !wired = 未接线行——禁用 + 「暂未开通」注记，点击零动作。 */
    wired: oauth && WIRED_OAUTH_IDS.has(id),
  };
});

interface CreateProviderDialogProps {
  /** #73 retained-mount open flag. */
  open?: boolean;
  onClose: () => void;
  /** Live 提交进行中（mutation isPending）——禁用 submit 防双击重发。 */
  pending?: boolean;
  /** M5 live 面：添加 = POST providers；缺省 = fixture 律（提交即关）。 */
  onCreate?: (body: {
    providerId: string;
    label: string;
    baseUrl: string;
    api: ProviderApi;
    authHeader?: boolean;
    models?: { id: string; name: string }[];
    apiKey?: string;
  }) => void;
  /** #231 live 面：OAuth 徽标行 = POST authorize → 同页签跳授权页；缺省 =
   *  fixture 律（点连接即关窗，等价 accept）。 */
  onConnect?: (presetId: string) => void;
  /** authorize POST 进行中——禁用徽标行防重发。 */
  connectPending?: boolean;
  /** 连接失败 inline 行（authorize 400 原文 / callback 落地 reason 文案）；
   *  null/缺省 = 无错误。 */
  connectError?: string | null;
}

export function CreateProviderDialog({
  open,
  onClose,
  pending,
  onCreate,
  onConnect,
  connectPending,
  connectError,
}: CreateProviderDialogProps) {
  const { t } = useI18n();
  const [view, setView] = useState<'picker' | 'form'>('picker');
  const [query, setQuery] = useState('');
  /** form 视图入口：null = 自定义端点；否则 = api_key preset（预填身份 +
   * xai oauthLabel note 判定位）。 */
  const [preset, setPreset] = useState<{ id: string; label: string } | null>(null);
  const [providerId, setProviderId] = useState('');
  const [label, setLabel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [api, setApi] = useState<ProviderApi>('openai-completions');
  const [apiKey, setApiKey] = useState('');
  const [authHeader, setAuthHeader] = useState(true);
  const [modelIds, setModelIds] = useState<string[]>([]);

  const ready = providerId.trim() !== '' && label.trim() !== '' && baseUrl.trim() !== '';

  // open→false 边重置：live 失败（不关窗）输入保全；任何关闭路径后重开皆
  // 干净 picker 面。
  useEffect(() => {
    if (open) return;
    setView('picker');
    setQuery('');
    setPreset(null);
    setProviderId('');
    setLabel('');
    setBaseUrl('');
    setApi('openai-completions');
    setApiKey('');
    setAuthHeader(true);
    setModelIds([]);
  }, [open]);

  const rows =
    query.trim() === ''
      ? PRESET_ROWS
      : PRESET_ROWS.filter((row) => {
          const q = query.trim().toLowerCase();
          return row.label.toLowerCase().includes(q) || row.id.includes(q);
        });

  /** form 视图入口边 = 干净表单 + 按入口预填（自定义端点空值；preset 行落
   * 身份两字段，baseUrl/api 目录未采留用户填）。 */
  const enterForm = (entry: { id: string; label: string } | null) => {
    setPreset(entry);
    setProviderId(entry?.id ?? '');
    setLabel(entry?.label ?? '');
    setBaseUrl('');
    setApi('openai-completions');
    setApiKey('');
    setAuthHeader(true);
    setModelIds([]);
    setView('form');
  };

  const submit = () => {
    if (!ready || pending === true) return;
    if (onCreate != null) {
      const models = modelIds
        .map((id) => id.trim())
        .filter((id) => id !== '')
        .map((id) => ({ id, name: id }));
      onCreate({
        providerId: providerId.trim(),
        label: label.trim(),
        baseUrl: baseUrl.trim(),
        api,
        authHeader,
        ...(models.length > 0 ? { models } : {}),
        // 空串 = 无密钥网关（「无密钥网关可留空」），不落 apiKey 字段。
        ...(apiKey !== '' ? { apiKey } : {}),
      });
    } else {
      onClose();
    }
  };

  return (
    <DialogShell
      title={t('添加模型服务')}
      open={open}
      onClose={onClose}
      footer={
        view === 'form' ? (
          <FormActions
            className="pt-0"
            primary={{
              label: t('添加模型服务'),
              onClick: submit,
              disabled: !ready || pending === true,
            }}
            secondary={{ label: t('取消'), onClick: onClose }}
          />
        ) : undefined
      }
    >
      {view === 'picker' ? (
        <div className="flex flex-col gap-3 py-1">
          <Input
            // spec/verify 载体 = aria-label 一级（getByLabel('搜索服务商...')，
            // #910/#944——原 .dlg-provider-search/.dlg-picker-search 类名钩
            // 随 per-face 清零退役，feature map 同步改锚）。
            aria-label={t('搜索服务商...')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('搜索服务商...')}
          />
          {/* #231 错误行：authorize 失败原文 / callback 落地 reason 三译
              （providers-page 喂入）。列表前渲染——着陆重开即可见。
              #1005：FieldError 承载（role=alert 内建 = 错误行一级载体，
              件默认 destructive 墨；原 .dlg-provider-oauth-error 类名钩已随
              #944 退役）。 */}
          {connectError != null && connectError !== '' && <FieldError>{connectError}</FieldError>}
          <div className="flex flex-col gap-1">
            {rows.map((row) => (
              <Button
                key={row.id}
                variant="outline"
                // data-preset-id = 行级二级载体（#910：38 行的计数/定位锚，
                // verify feature map 同锚）。
                data-preset-id={row.id}
                className={PICKER_ROW_CLS}
                // #385：族表外 OAuth 行恒禁用（无后端面，点击零动作——disabled
                // 钮不发 click，onClick 无需防御分支）；已接线行在 authorize
                // 进行中禁用防重发。
                disabled={row.oauth && (!row.wired || connectPending === true)}
                onClick={() =>
                  row.oauth
                    ? onConnect != null
                      ? onConnect(row.id)
                      : onClose()
                    : enterForm({ id: row.id, label: row.label })
                }
              >
                {row.label}
                {/* T0 map：'(OAuth)' 后缀进名称文本（行 textContent 等值
                    断言，JSX 折叠换行空白故显式 {' '}），只骑族表已接线行
                    （#385）；xai 行不带后缀（负向钉）。#1005：chip 走 Badge
                    secondary 默认档，margin-left:auto 行末 layout。 */}
                {row.wired && (
                  <Badge variant="secondary" className="ml-auto">
                    {' (OAuth)'}
                  </Badge>
                )}
                {/* #385 未接线注记：占徽标同槽位（行右 chip，Badge outline
                    默认档 = 描边不上底；行整体 :disabled 已降不透明度）；
                    显式 {' '} 保行 textContent 空格分隔（probe 名称节点等值
                    断言的行文本形）。 */}
                {row.oauth && !row.wired && (
                  <Badge variant="outline" className="ml-auto">
                    {' '}
                    {t('暂未开通')}
                  </Badge>
                )}
              </Button>
            ))}
          </div>
          <Button variant="outline" className={PICKER_ROW_CLS} onClick={() => enterForm(null)}>
            {t('自定义端点')}
          </Button>
        </div>
      ) : (
        <FormStack className="max-w-none py-1">
          {/* 返回钮 = Button ghost 默认档（#1005：七通道中和退役，hover/
              按下态由件承载）；贴左 px-0 与 secondary 墨（token 槽）是
              layout/ink。 */}
          <Button
            variant="ghost"
            className="self-start px-0 text-content-secondary"
            onClick={() => setView('picker')}
          >
            <ChevronLeft />
            {t('返回')}
          </Button>
          {/* xai 双通道（r3 §2）：oauthLabel 在密钥表单内展示；族表外无
              后端面 → note 不做钮（#222）。 */}
          {preset?.id === PROVIDER_XAI_PRESET.id && (
            <FieldDescription>{PROVIDER_XAI_PRESET.oauthLabel}</FieldDescription>
          )}
          <FormField label={t('服务商 ID')} htmlFor="dlg-provider-id">
            <Input
              id="dlg-provider-id"
              className={FORM_CONTROL_CLS}
              value={providerId}
              onChange={(event) => setProviderId(event.target.value)}
              placeholder={t('例如 my-relay')}
            />
          </FormField>
          <FormField label={t('名称')} htmlFor="dlg-provider-label">
            <Input
              id="dlg-provider-label"
              className={FORM_CONTROL_CLS}
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </FormField>
          <FormField label="Base URL" htmlFor="dlg-provider-baseurl">
            <Input
              id="dlg-provider-baseurl"
              className={FORM_CONTROL_CLS}
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://api.example.com/v1"
            />
          </FormField>
          <FormField label={t('API 协议')} htmlFor="dlg-provider-api">
            <Select
              value={api}
              onValueChange={(next) => {
                if (next !== null) setApi(next as ProviderApi);
              }}
            >
              <SelectTrigger id="dlg-provider-api" className={FORM_CONTROL_CLS}>
                <SelectValue>
                  {API_OPTIONS.find((option) => option.value === api)?.label}
                </SelectValue>
              </SelectTrigger>
              <SelectContent
                aria-label={t('API 协议')}
                className="rounded-(--radius-popover) shadow-(--shadow-popover)"
              >
                {API_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label={t('API 密钥')} htmlFor="dlg-provider-apikey">
            <Input
              id="dlg-provider-apikey"
              className={FORM_CONTROL_CLS}
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={t('无密钥网关可留空')}
            />
            {/* XMON-72：收口 components/ui/checkbox 原语（#1003 起 = registry
                同源件，行盒由消费点 label 承载）。id 保留：Base UI 契约 id 落
                隐藏原生 input，provider-add-dialog.spec 的 pin 骑它。 */}
            {/* Field 竖排的 *:w-full 会拉满直接子件——行盒包一层 div，
                label 本体保持内容宽。 */}
            <div>
              {/* biome-ignore lint/a11y/noLabelWithoutControl: Base UI Checkbox.Root renders its hidden native input inside this label at runtime; the static check cannot see through the component. */}
              <label className="inline-flex w-fit cursor-pointer items-center gap-2">
                <Checkbox
                  id="dlg-provider-authheader"
                  checked={authHeader}
                  onCheckedChange={setAuthHeader}
                  aria-label={t('以 Authorization: Bearer 请求头发送 API 密钥')}
                />
                <span className="text-ui text-foreground">
                  {t('以 Authorization: Bearer 请求头发送 API 密钥')}
                </span>
              </label>
            </div>
            <FieldDescription className="text-meta text-content-tertiary">
              {t('密钥将加密存储，保存后无法再次查看。')}
            </FieldDescription>
          </FormField>
          <Field>
            <FieldTitle className={FIELD_TITLE_CLS}>{t('模型（可选）')}</FieldTitle>
            {modelIds.map((id, i) => (
              <Input
                key={i}
                className={FORM_CONTROL_CLS}
                aria-label={t('模型 ID')}
                value={id}
                placeholder="claude-sonnet-5"
                onChange={(event) =>
                  setModelIds((rows) => rows.map((r, j) => (i === j ? event.target.value : r)))
                }
              />
            ))}
            <div>
              <Button
                variant="ghost"
                className="px-0 text-content-secondary"
                onClick={() => setModelIds((rows) => [...rows, ''])}
              >
                <PlusSmall />
                {t('添加模型')}
              </Button>
            </div>
          </Field>
        </FormStack>
      )}
    </DialogShell>
  );
}
