import {
  OAUTH_FAMILIES,
  PROVIDER_CODEX_PRESET,
  PROVIDER_OAUTH_PRESET_IDS,
  PROVIDER_PRESET_DEFAULTS,
  PROVIDER_PRESET_IDS,
  PROVIDER_XAI_PRESET,
  type ProviderApi,
  type ProviderModel,
} from '@cairn/shared';
import { type ReactNode, useEffect, useState } from 'react';
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
import { useI18n } from '../i18n/provider.js';
import { ChevronLeft, PlusSmall, Search } from '../icons/index.js';
import { LOBEHUB_MONO } from '../icons/lobehub-mono.js';
import { ProviderConnectionDisclosure } from './provider-connection-disclosure.js';
import { ProviderModelChips, pickedModels } from './provider-model-list.js';
import { ProviderPresetIcon } from './provider-preset-icon.js';

const FIELD_TITLE_CLS = 'text-ui font-medium text-foreground';

const PICKER_ROW_CLS =
  'h-10 pointer-coarse:h-11 w-full justify-start gap-2.5 rounded-md px-2.5 text-left text-ui font-normal text-foreground hover:bg-(--menu-hover) dark:hover:bg-(--menu-hover) disabled:text-content-tertiary disabled:opacity-100';

const PICKER_TILE_CLS =
  'flex size-5.5 flex-none items-center justify-center rounded-(--radius-control) bg-card text-caption font-semibold text-content-secondary ring-1 ring-border';

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

const matchesQuery = (label: string, query: string) =>
  query.trim() === '' || label.includes(query.trim().toLowerCase());

const BASE_URL_PLACEHOLDER = /\{[A-Za-z_]+\}/;

function MonoMark({ mark }: { mark: { viewBox: string; paths: readonly string[] } }) {
  return (
    <svg
      aria-hidden
      viewBox={mark.viewBox}
      fill="currentColor"
      fillRule="evenodd"
      clipRule="evenodd"
      width={14}
      height={14}
    >
      {mark.paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

function connectionSummary(
  connection: { baseUrl: string; api: ProviderApi; authHeader: boolean },
  t: (source: string) => string,
): string {
  let host = '';
  try {
    host = new URL(connection.baseUrl).host;
  } catch {
    return t('填写 Base URL 和协议');
  }
  const protocol = API_OPTIONS.find((option) => option.value === connection.api)?.label ?? '';
  return [host, protocol, connection.authHeader ? 'Bearer' : t('原生鉴权')].join(' · ');
}

const WIRED_OAUTH_IDS: ReadonlySet<string> = new Set([
  ...OAUTH_FAMILIES.map((f) => f.presetId),
  PROVIDER_CODEX_PRESET.id,
]);

const PRESET_ROWS = PROVIDER_PRESET_IDS.map((id) => ({
  id,
  label: PRESET_LABELS[id],
  group: PRESET_GROUP[id],
  oauth: (PROVIDER_OAUTH_PRESET_IDS as readonly string[]).includes(id),
}))
  .filter((row) => !row.oauth || WIRED_OAUTH_IDS.has(row.id))
  .sort((a, b) => a.label.localeCompare(b.label, 'en'));

interface CreateProviderDialogProps {
  open?: boolean;
  inline?: boolean;
  testId?: string;
  lead?: ReactNode;
  onClose: () => void;
  pending?: boolean;
  onCreate?: (body: {
    providerId: string;
    label: string;
    baseUrl: string;
    api: ProviderApi;
    authHeader?: boolean;
    models?: ProviderModel[];
    apiKey?: string;
  }) => void;
  onConnect?: (presetId: string) => void;
  oauthSignIn: boolean;
  connectPending?: boolean;
  connectError?: string | null;
  onPickClaudeSubscription?: () => void;
  onPickDevinSubscription?: () => void;
  onXaiSignIn?: () => void;
  xaiSignInPending?: boolean;
  xaiDevice?: { userCode: string; verificationUri: string } | null;
  xaiDeviceError?: string | null;
  onCodexSignIn?: () => void;
  codexSignInPending?: boolean;
  codexDevice?: { userCode: string; verificationUri: string } | null;
  codexDeviceError?: string | null;
}

export function CreateProviderDialog({
  open,
  inline = false,
  testId,
  lead,
  onClose,
  pending,
  onCreate,
  onConnect,
  oauthSignIn,
  connectPending,
  connectError,
  onPickClaudeSubscription,
  onPickDevinSubscription,
  onXaiSignIn,
  xaiSignInPending,
  xaiDevice,
  xaiDeviceError,
  onCodexSignIn,
  codexSignInPending,
  codexDevice,
  codexDeviceError,
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
  const [catalog, setCatalog] = useState<ProviderModel[]>([]);
  const [modelIds, setModelIds] = useState<string[]>([]);
  const [connectionOpen, setConnectionOpen] = useState(true);

  const baseUrlHasPlaceholder = BASE_URL_PLACEHOLDER.test(baseUrl);
  const ready =
    providerId.trim() !== '' &&
    label.trim() !== '' &&
    baseUrl.trim() !== '' &&
    !baseUrlHasPlaceholder &&
    modelIds.length > 0;

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
    setCatalog([]);
    setModelIds([]);
  }, [open]);

  const q = query.trim().toLowerCase();
  const rows = PRESET_ROWS.filter(
    (row) =>
      (oauthSignIn || row.id === PROVIDER_CODEX_PRESET.id || !row.oauth) &&
      (q === '' || row.label.toLowerCase().includes(q) || row.id.includes(q)),
  );

  const enterForm = (entry: { id: string; label: string } | null) => {
    const defaults = entry === null ? undefined : PROVIDER_PRESET_DEFAULTS[entry.id];
    setPreset(entry);
    setProviderId(entry?.id ?? '');
    setLabel(entry?.label ?? '');
    setBaseUrl(defaults?.baseUrl ?? '');
    setApi(defaults?.api ?? 'openai-completions');
    setApiKey('');
    setAuthHeader(defaults?.authHeader ?? true);
    setCatalog(defaults?.models ?? []);
    setModelIds(defaults?.picks ?? []);
    setConnectionOpen(defaults === undefined || BASE_URL_PLACEHOLDER.test(defaults.baseUrl));
    setView('form');
  };

  const submit = () => {
    if (!ready || pending === true) return;
    if (onCreate != null) {
      const named = pickedModels(catalog, modelIds);
      onCreate({
        providerId: providerId.trim(),
        label: label.trim(),
        baseUrl: baseUrl.trim(),
        api,
        authHeader,
        ...(named.length > 0 ? { models: named } : {}),
        ...(apiKey !== '' ? { apiKey } : {}),
      });
    } else {
      onClose();
    }
  };

  const footer =
    view === 'form' ? (
      <FormActions
        className="pt-0"
        primary={{
          label: t('添加模型服务'),
          onClick: submit,
          disabled: !ready || pending === true,
        }}
        secondary={{ label: t('取消'), onClick: inline ? () => setView('picker') : onClose }}
      />
    ) : undefined;
  const body =
    view === 'picker' ? (
      <div className="flex flex-col gap-3">
        {lead}
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
        {codexDevice != null && (
          <FieldDescription data-testid="codex-device-login">
            {t('在浏览器打开这个链接，输入验证码。')}{' '}
            <a href={codexDevice.verificationUri} target="_blank" rel="noreferrer">
              {codexDevice.verificationUri}
            </a>{' '}
            <span className="font-mono">{codexDevice.userCode}</span>
          </FieldDescription>
        )}
        {codexDeviceError != null && codexDeviceError !== '' && (
          <FieldError>{codexDeviceError}</FieldError>
        )}
        <div className="flex flex-col">
          {PRESET_GROUPS.map((group) => {
            const groupRows = rows.filter((row) => row.group === group);
            const claudeRow =
              group === '订阅登录' &&
              onPickClaudeSubscription !== undefined &&
              matchesQuery(t('Claude 订阅').toLowerCase(), query);
            const devinRow =
              group === '订阅登录' &&
              onPickDevinSubscription !== undefined &&
              matchesQuery(t('Devin 订阅').toLowerCase(), query);
            if (groupRows.length === 0 && !claudeRow && !devinRow) return null;
            return (
              <fieldset key={group} className={PICKER_GROUP_CLS}>
                <legend className={inline ? 'sr-only' : PICKER_GROUP_HEAD_CLS}>{t(group)}</legend>
                {claudeRow && (
                  <Button
                    variant="ghost"
                    data-preset-id="claude-subscription"
                    className={PICKER_ROW_CLS}
                    onClick={onPickClaudeSubscription}
                  >
                    <span aria-hidden className={PICKER_TILE_CLS}>
                      <MonoMark mark={LOBEHUB_MONO.claude} />
                    </span>
                    <span className="min-w-0 truncate">{t('Claude 订阅')}</span>
                  </Button>
                )}
                {devinRow && (
                  <Button
                    variant="ghost"
                    data-preset-id="devin-subscription"
                    className={PICKER_ROW_CLS}
                    onClick={onPickDevinSubscription}
                  >
                    <span aria-hidden className={PICKER_TILE_CLS}>
                      <MonoMark mark={LOBEHUB_MONO.devin} />
                    </span>
                    <span className="min-w-0 truncate">{t('Devin 订阅')}</span>
                  </Button>
                )}
                {groupRows.map((row) => (
                  <Button
                    key={row.id}
                    variant="ghost"
                    data-preset-id={row.id}
                    className={PICKER_ROW_CLS}
                    disabled={row.oauth && (connectPending === true || codexSignInPending === true)}
                    onClick={() => {
                      if (!row.oauth) enterForm({ id: row.id, label: row.label });
                      else if (row.id === PROVIDER_CODEX_PRESET.id)
                        onCodexSignIn != null ? onCodexSignIn() : onClose();
                      else onConnect != null ? onConnect(row.id) : onClose();
                    }}
                  >
                    <span aria-hidden className={PICKER_TILE_CLS}>
                      <ProviderPresetIcon id={row.id} />
                    </span>
                    <span className="min-w-0 truncate">{row.label}</span>
                  </Button>
                ))}
              </fieldset>
            );
          })}
          <fieldset className={PICKER_GROUP_CLS}>
            <legend className={inline ? 'sr-only' : PICKER_GROUP_HEAD_CLS}>{t('其他')}</legend>
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
          className="-ml-2 self-start px-2 text-content-secondary"
          onClick={() => setView('picker')}
        >
          <ChevronLeft />
          {t('返回')}
        </Button>
        {preset?.id === PROVIDER_XAI_PRESET.id && (
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={xaiSignInPending === true || onXaiSignIn == null}
              onClick={onXaiSignIn}
            >
              {PROVIDER_XAI_PRESET.oauthLabel}
            </Button>
            {xaiDevice != null && (
              <FieldDescription>
                {t('在浏览器打开这个链接，输入验证码。')}{' '}
                <a href={xaiDevice.verificationUri} target="_blank" rel="noreferrer">
                  {xaiDevice.verificationUri}
                </a>{' '}
                <span className="font-mono">{xaiDevice.userCode}</span>
              </FieldDescription>
            )}
            {xaiDeviceError != null && xaiDeviceError !== '' && (
              <FieldError>{xaiDeviceError}</FieldError>
            )}
          </div>
        )}
        <FormField label={t('名称')} htmlFor="dlg-provider-label">
          <Input
            id="dlg-provider-label"
            className={FORM_CONTROL_CLS}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
        </FormField>
        <FormField
          label={t('API 密钥')}
          htmlFor="dlg-provider-apikey"
          help={t('密钥将加密存储，保存后无法再次查看。')}
        >
          <Input
            id="dlg-provider-apikey"
            className={FORM_CONTROL_CLS}
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={t('无密钥网关可留空')}
          />
        </FormField>
        <ProviderConnectionDisclosure
          open={connectionOpen}
          onOpenChange={setConnectionOpen}
          summary={connectionSummary({ baseUrl, api, authHeader }, t)}
        >
          <FormField label={t('服务商 ID')} htmlFor="dlg-provider-id">
            <Input
              id="dlg-provider-id"
              className={FORM_CONTROL_CLS}
              value={providerId}
              onChange={(event) => setProviderId(event.target.value)}
              placeholder={t('例如 my-relay')}
            />
          </FormField>
          <FormField
            label="Base URL"
            htmlFor="dlg-provider-baseurl"
            help={baseUrlHasPlaceholder ? t('把 Base URL 中的占位符换成你的账户值') : undefined}
          >
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
        </ProviderConnectionDisclosure>
        <Field>
          <FieldTitle className={FIELD_TITLE_CLS}>{t('模型（至少一个）')}</FieldTitle>
          <ProviderModelChips
            catalog={catalog}
            selected={modelIds}
            onSelectedChange={setModelIds}
          />
          {modelIds.length === 0 && (
            <FieldDescription className="text-meta text-content-tertiary">
              {t('至少添加一个模型：点「添加模型」，输入端点支持的模型 ID，比如 gpt-4o-mini。')}
            </FieldDescription>
          )}
        </Field>
      </FormStack>
    );
  if (inline) {
    return (
      <section data-testid={testId} aria-label={t('添加模型服务')} className="flex flex-col gap-4">
        {body}
        {footer}
      </section>
    );
  }
  return (
    <DialogShell title={t('添加模型服务')} open={open} onClose={onClose} size="l" footer={footer}>
      {body}
    </DialogShell>
  );
}
