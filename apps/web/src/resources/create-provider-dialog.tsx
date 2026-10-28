import {
  OAUTH_FAMILIES,
  PROVIDER_OAUTH_PRESET_IDS,
  PROVIDER_PRESET_IDS,
  PROVIDER_XAI_PRESET,
  type ProviderApi,
} from '@cairn/shared';
import { useEffect, useState } from 'react';
import { FORM_CONTROL_CLS, FormActions, FormField, FormStack } from '../components/form-layout.js';
import { Button } from '../components/ui/button.js';
import { Checkbox } from '../components/ui/checkbox.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import { Field, FieldDescription, FieldError, FieldTitle } from '../components/ui/field.js';
import { Input } from '../components/ui/input.js';
import { InputGroup, InputGroupAddon, InputGroupInput } from '../components/ui/input-group.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select.js';
import { blockDemoWrite } from '../demo/demo-gate.js';
import { useI18n } from '../i18n/provider.js';
import { ChevronLeft, PlusSmall, Search } from '../icons/index.js';

const FIELD_TITLE_CLS = 'text-ui font-medium text-foreground';

const PICKER_ROW_CLS =
  'h-10 w-full justify-start gap-2.5 rounded-md px-2.5 text-left text-ui font-normal text-foreground hover:bg-card hover:shadow-xs hover:ring-1 hover:ring-border focus-visible:bg-card dark:hover:bg-card disabled:text-content-tertiary disabled:opacity-100';

const PICKER_TILE_CLS =
  'flex size-5.5 flex-none items-center justify-center rounded-(--radius-control) bg-card text-caption font-semibold text-content-secondary ring-1 ring-border';

const PICKER_TAG_CLS = 'ml-auto text-caption font-normal text-content-tertiary';

const PICKER_GROUP_CLS = 'm-0 flex min-w-0 flex-col border-0 p-0';

const PICKER_GROUP_HEAD_CLS = 'px-2.5 pt-3 pb-1 text-caption font-medium text-content-tertiary';

const PRESET_GROUPS = ['订阅登录', '模型厂商', '云平台', '推理平台', '网关与聚合'] as const;

const PRESET_GROUP: Record<(typeof PROVIDER_PRESET_IDS)[number], (typeof PRESET_GROUPS)[number]> = {
  'github-copilot': '订阅登录',
  'openai-codex': '订阅登录',
  anthropic: '模型厂商',
  openai: '模型厂商',
  google: '模型厂商',
  xai: '模型厂商',
  deepseek: '模型厂商',
  mistral: '模型厂商',
  moonshotai: '模型厂商',
  'moonshotai-cn': '模型厂商',
  'kimi-coding': '模型厂商',
  minimax: '模型厂商',
  'minimax-cn': '模型厂商',
  'ant-ling': '模型厂商',
  'qwen-token-plan': '模型厂商',
  'qwen-token-plan-cn': '模型厂商',
  'qwen-token-plan-individual': '模型厂商',
  xiaomi: '模型厂商',
  'xiaomi-token-plan-ams': '模型厂商',
  'xiaomi-token-plan-cn': '模型厂商',
  'xiaomi-token-plan-sgp': '模型厂商',
  'z-ai': '模型厂商',
  'z-ai-coding-cn': '模型厂商',
  'amazon-bedrock': '云平台',
  'google-vertex': '云平台',
  'cloudflare-workers-ai': '云平台',
  groq: '推理平台',
  cerebras: '推理平台',
  fireworks: '推理平台',
  baseten: '推理平台',
  huggingface: '推理平台',
  nvidia: '推理平台',
  together: '推理平台',
  'cloudflare-ai-gateway': '网关与聚合',
  'vercel-ai-gateway': '网关与聚合',
  openrouter: '网关与聚合',
  opencode: '网关与聚合',
  'opencode-go': '网关与聚合',
};

const API_OPTIONS: readonly { value: ProviderApi; label: string }[] = [
  { value: 'openai-completions', label: 'OpenAI Completions' },
  { value: 'openai-responses', label: 'OpenAI Responses' },
  { value: 'anthropic-messages', label: 'Anthropic Messages' },
];

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

const WIRED_OAUTH_IDS: ReadonlySet<string> = new Set(OAUTH_FAMILIES.map((f) => f.presetId));

const PRESET_ROWS = PROVIDER_PRESET_IDS.map((id) => {
  const oauth = (PROVIDER_OAUTH_PRESET_IDS as readonly string[]).includes(id);
  return {
    id,
    label: PRESET_LABELS[id],
    group: PRESET_GROUP[id],
    oauth,
    wired: oauth && WIRED_OAUTH_IDS.has(id),
  };
}).sort((a, b) => a.label.localeCompare(b.label, 'en'));

interface CreateProviderDialogProps {
  open?: boolean;
  onClose: () => void;
  pending?: boolean;
  onCreate?: (body: {
    providerId: string;
    label: string;
    baseUrl: string;
    api: ProviderApi;
    authHeader?: boolean;
    models?: { id: string; name: string }[];
    apiKey?: string;
  }) => void;
  onConnect?: (presetId: string) => void;
  connectPending?: boolean;
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
  const [preset, setPreset] = useState<{ id: string; label: string } | null>(null);
  const [providerId, setProviderId] = useState('');
  const [label, setLabel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [api, setApi] = useState<ProviderApi>('openai-completions');
  const [apiKey, setApiKey] = useState('');
  const [authHeader, setAuthHeader] = useState(true);
  const [modelIds, setModelIds] = useState<string[]>([]);

  const ready = providerId.trim() !== '' && label.trim() !== '' && baseUrl.trim() !== '';

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
        ...(apiKey !== '' ? { apiKey } : {}),
      });
    } else {
      blockDemoWrite();
      onClose();
    }
  };

  return (
    <DialogShell
      title={t('添加模型服务')}
      open={open}
      onClose={onClose}
      size="l"
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
        <div className="flex flex-col gap-3">
          <InputGroup className="h-8.5 rounded-md border-border bg-card shadow-xs dark:bg-input/30">
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              aria-label={t('搜索服务商...')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('搜索服务商...')}
              className="text-ui md:text-ui"
            />
          </InputGroup>
          {connectError != null && connectError !== '' && <FieldError>{connectError}</FieldError>}
          <div className="flex flex-col">
            {PRESET_GROUPS.map((group) => {
              const groupRows = rows.filter((row) => row.group === group);
              if (groupRows.length === 0) return null;
              return (
                <fieldset key={group} className={PICKER_GROUP_CLS}>
                  <legend className={PICKER_GROUP_HEAD_CLS}>{t(group)}</legend>
                  {groupRows.map((row) => (
                    <Button
                      key={row.id}
                      variant="ghost"
                      data-preset-id={row.id}
                      className={PICKER_ROW_CLS}
                      disabled={row.oauth && (!row.wired || connectPending === true)}
                      onClick={() => {
                        if (!row.oauth) {
                          enterForm({ id: row.id, label: row.label });
                          return;
                        }
                        if (onConnect != null) onConnect(row.id);
                        else {
                          blockDemoWrite();
                          onClose();
                        }
                      }}
                    >
                      <span aria-hidden className={PICKER_TILE_CLS}>
                        {row.label.charAt(0)}
                      </span>
                      <span className="min-w-0 truncate">{row.label}</span>
                      {row.wired && <span className={PICKER_TAG_CLS}>OAuth</span>}
                      {row.oauth && !row.wired && (
                        <span className={PICKER_TAG_CLS}>{t('暂未开通')}</span>
                      )}
                    </Button>
                  ))}
                </fieldset>
              );
            })}
            <fieldset className={PICKER_GROUP_CLS}>
              <legend className={PICKER_GROUP_HEAD_CLS}>{t('其他')}</legend>
              <Button variant="ghost" className={PICKER_ROW_CLS} onClick={() => enterForm(null)}>
                <span aria-hidden className={PICKER_TILE_CLS}>
                  <PlusSmall />
                </span>
                {t('自定义端点')}
              </Button>
            </fieldset>
          </div>
        </div>
      ) : (
        <FormStack className="max-w-none">
          <Button
            variant="ghost"
            className="self-start px-0 text-content-secondary"
            onClick={() => setView('picker')}
          >
            <ChevronLeft />
            {t('返回')}
          </Button>
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
              <SelectContent aria-label={t('API 协议')}>
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
