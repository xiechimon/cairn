import {
  type ModelSource,
  PROVIDER_OAUTH_PRESET_IDS,
  PROVIDER_PRESET_IDS,
  type ProviderApi,
  type ProviderRecord,
  type ProviderTestResult,
} from '@cairn/shared';
import { cn } from 'cn';
import { Server } from 'lucide-react';
import { useState } from 'react';
import { ClaudeMark, GeminiMark, GrokMark, OpenAIMark, PiMark } from '../components/brand-marks.js';
import { FORM_CONTROL_CLS } from '../components/form-layout.js';
import {
  ProviderEditorHead,
  type ProviderMark,
  ProviderModelRow,
  ProviderSection,
} from '../components/providers/provider-panel.js';
import {
  SETTINGS_HINT_CLS,
  SettingsCard,
  SettingsDangerZone,
  SettingsRow,
  SettingsSection,
} from '../components/settings-list.js';
import { AlertDialogActions, AlertDialogShell } from '../components/ui/alert-dialog-shell.js';
import { Button } from '../components/ui/button.js';
import { Input } from '../components/ui/input.js';
import { useI18n } from '../i18n/provider.js';

const PROTOCOL_LABELS: Record<ProviderApi, string> = {
  'anthropic-messages': 'Anthropic Messages',
  'openai-completions': 'OpenAI Chat Completions',
  'openai-responses': 'OpenAI Responses',
};

const SUBSCRIPTION_PRESET_IDS: readonly string[] = ['openai-codex'];

const isOAuthPreset = (providerId: string) =>
  (PROVIDER_OAUTH_PRESET_IDS as readonly string[]).includes(providerId);

export function providerKind(record: ProviderRecord): string {
  if (SUBSCRIPTION_PRESET_IDS.includes(record.providerId)) return '订阅';
  if (isOAuthPreset(record.providerId)) return 'OAuth';
  if ((PROVIDER_PRESET_IDS as readonly string[]).includes(record.providerId)) return 'API key';
  return '自定义端点';
}

export function providerMark(record: ProviderRecord): ProviderMark {
  if (record.api === 'anthropic-messages' || record.providerId === 'anthropic') return ClaudeMark;
  if (record.providerId.startsWith('openai')) return OpenAIMark;
  if (record.providerId === 'xai') return GrokMark;
  if (record.providerId === 'google' || record.providerId.startsWith('gemini')) return GeminiMark;
  return Server;
}

export function CommitInput({
  label,
  value,
  onCommit,
  className,
}: {
  label: string;
  value: string;
  onCommit?: (next: string) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    const next = draft?.trim() ?? '';
    if (draft !== null && next !== '' && next !== value) onCommit?.(next);
    setDraft(null);
  };
  return (
    <Input
      aria-label={label}
      className={cn(FORM_CONTROL_CLS, 'w-full sm:w-64', className)}
      value={draft ?? value}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
        if (event.key === 'Escape') setDraft(null);
      }}
    />
  );
}

function KeyRow({ onReplace }: { onReplace?: (key: string) => void }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <SettingsRow
      label="API key"
      hint={t('加密保存，保存后不能再查看')}
      className="flex-wrap gap-y-2 py-2.5"
    >
      {draft === null ? (
        <Button variant="outline" size="sm" onClick={() => setDraft('')}>
          {t('更换 API key')}
        </Button>
      ) : (
        <span className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
          <Input
            aria-label={t('新的 API key')}
            type="password"
            autoComplete="off"
            autoFocus
            className={cn(FORM_CONTROL_CLS, 'w-full sm:w-48')}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>
            {t('取消')}
          </Button>
          <Button
            size="sm"
            disabled={draft.trim() === ''}
            onClick={() => {
              onReplace?.(draft.trim());
              setDraft(null);
            }}
          >
            {t('保存')}
          </Button>
        </span>
      )}
    </SettingsRow>
  );
}

export interface ProviderEditActions {
  patch?: (
    body: Partial<Pick<ProviderRecord, 'label' | 'baseUrl' | 'models'>> & {
      apiKey?: string;
    },
  ) => Promise<unknown>;
  test?: () => Promise<ProviderTestResult>;
  remove?: () => void;
}

function TestRow({ onTest }: { onTest: () => Promise<ProviderTestResult> }) {
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<ProviderTestResult | 'unavailable' | null>(null);
  const run = async () => {
    setPending(true);
    setOutcome(null);
    try {
      setOutcome(await onTest());
    } catch {
      setOutcome('unavailable');
    } finally {
      setPending(false);
    }
  };
  return (
    <SettingsRow
      label={t('测试连接')}
      hint={t('发一个最小请求，不会显示密钥')}
      className="flex-wrap gap-y-2 py-3"
    >
      <div className="flex w-full min-w-0 flex-wrap items-center justify-end gap-2 sm:w-auto">
        {outcome !== null && (
          <div className="min-w-0 max-w-full text-meta text-content-secondary">
            <span role="status" data-testid="provider-test-result">
              {outcome === 'unavailable'
                ? t('测试没能跑完，请重试。')
                : outcome.status === 'ok'
                  ? t('连接正常')
                  : t('连接失败，请检查连接设置后重试。')}
            </span>
            {outcome !== 'unavailable' && outcome.reason !== null && (
              <details className="mt-1">
                <summary className="cursor-pointer">{t('详情')}</summary>
                <p data-testid="provider-test-reason" className="m-0 max-w-80 break-words">
                  {outcome.reason}
                </p>
              </details>
            )}
          </div>
        )}
        <Button variant="outline" size="sm" disabled={pending} onClick={() => void run()}>
          {pending ? t('测试中…') : t('测试')}
        </Button>
      </div>
    </SettingsRow>
  );
}

export function TeamProviderEditor({
  record,
  deadModels,
  actions,
}: {
  record: ProviderRecord;
  deadModels: ReadonlySet<string>;
  actions: ProviderEditActions;
}) {
  const { t } = useI18n();
  const [adding, setAdding] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [models, setModels] = useState(record.models);
  const [savedModels, setSavedModels] = useState(record.models);
  const [savingModels, setSavingModels] = useState(false);
  if (savedModels !== record.models && !savingModels) {
    setSavedModels(record.models);
    setModels(record.models);
  }
  const oauth = isOAuthPreset(record.providerId);
  const fire = (body: Parameters<NonNullable<ProviderEditActions['patch']>>[0]) => {
    void actions.patch?.(body).catch(() => undefined);
  };
  const saveModels = (next: ProviderRecord['models']) => {
    if (actions.patch === undefined) return;
    setModels(next);
    setSavingModels(true);
    actions
      .patch({ models: next })
      .catch(() => setModels(record.models))
      .finally(() => setSavingModels(false));
  };
  const addModel = () => {
    const id = adding.trim();
    if (id === '' || savingModels) return;
    setAdding('');
    if (models.some((m) => m.id === id)) return;
    saveModels([...models, { id, name: id }]);
  };
  return (
    <>
      <ProviderEditorHead
        Mark={providerMark(record)}
        name={record.label}
        kind={t(providerKind(record))}
      />
      <SettingsCard>
        <SettingsRow label={t('名称')} className="flex-wrap gap-y-2 py-2.5">
          <CommitInput
            key={`label:${record.label}`}
            label={t('名称')}
            value={record.label}
            onCommit={(label) => fire({ label })}
          />
        </SettingsRow>
        <SettingsRow label={t('协议')}>{PROTOCOL_LABELS[record.api]}</SettingsRow>
        <SettingsRow label={t('地址')} className="flex-wrap gap-y-2 py-2.5">
          <CommitInput
            key={`base:${record.baseUrl}`}
            label={t('地址')}
            value={record.baseUrl}
            onCommit={(baseUrl) => fire({ baseUrl })}
          />
        </SettingsRow>
        {!oauth && <KeyRow onReplace={(apiKey) => fire({ apiKey })} />}
        {!oauth && actions.test !== undefined && (
          <TestRow key={JSON.stringify(record)} onTest={actions.test} />
        )}
      </SettingsCard>
      <ProviderSection title={t('模型列表')} hint={t('这里的模型会出现在模型选择器里')}>
        <SettingsCard>
          {models.map((model) => (
            <ProviderModelRow
              key={model.id}
              id={model.id}
              name={model.name !== '' ? model.name : model.id}
              dead={deadModels.has(model.id)}
              busy={savingModels}
              onRemove={() => saveModels(models.filter((m) => m.id !== model.id))}
            />
          ))}
          <div className="settings-flat-block flex min-h-11 items-center gap-2 px-4 py-1.5">
            <Input
              aria-label={t('添加模型')}
              placeholder={t('添加模型 ID，回车保存')}
              className={cn(FORM_CONTROL_CLS, 'w-full')}
              value={adding}
              aria-busy={savingModels}
              readOnly={savingModels}
              onChange={(event) => setAdding(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') addModel();
              }}
            />
          </div>
        </SettingsCard>
      </ProviderSection>
      <SettingsSection title={t('管理')}>
        <SettingsDangerZone
          label={t('移除服务商')}
          description={t('移除后，使用它的模型不再可选。')}
          actionLabel={t('移除')}
          onAction={() => setConfirming(true)}
        />
      </SettingsSection>
      <AlertDialogShell
        title={t('移除「{name}」？', { name: record.label })}
        ariaLabel={t('移除服务商')}
        open={confirming}
        onClose={() => setConfirming(false)}
        footer={
          <AlertDialogActions
            cancelLabel={t('取消')}
            confirmLabel={t('移除')}
            onCancel={() => setConfirming(false)}
            onConfirm={() => {
              setConfirming(false);
              actions.remove?.();
            }}
          />
        }
      >
        <p className="m-0">{t('移除后，用到它的模型和路由不再可用。')}</p>
      </AlertDialogShell>
    </>
  );
}

export function claudeCodeStatus(
  source: ModelSource | undefined,
  online: boolean,
): { status: string; tone: 'ok' | 'warn' | 'off' } {
  if (source === undefined) return { status: '还没上报', tone: 'off' };
  if (!online) return { status: '离线 · 显示最后一次上报', tone: 'warn' };
  if (source.bin === null) return { status: '未安装', tone: 'warn' };
  if (source.auth?.state === 'not-logged-in') return { status: '未登录', tone: 'warn' };
  if (source.models.length === 0) return { status: '已安装，未配置模型槽', tone: 'warn' };
  if (source.auth?.state === 'logged-in') return { status: '已登录', tone: 'ok' };
  if (source.auth?.state === 'unknown') return { status: '已安装，登录状态未知', tone: 'warn' };
  return { status: '已安装', tone: 'ok' };
}

export function ClaudeCodeEditor({
  source,
  machineName,
  status,
}: {
  source: ModelSource | undefined;
  machineName: string;
  status: string;
}) {
  const { t } = useI18n();
  const bin = typeof source?.bin === 'object' && source.bin !== null ? source.bin : null;
  return (
    <>
      <ProviderEditorHead
        Mark={ClaudeMark}
        name="Claude Code"
        kind={t('{machine} 上的 CLI', { machine: machineName })}
        version={bin?.version}
      />
      <SettingsCard>
        <SettingsRow label={t('状态')}>{t(status)}</SettingsRow>
        <SettingsRow label={t('程序')} valueClassName="min-w-0">
          <code className="truncate text-meta text-content-secondary">
            {bin?.path ?? t('未找到')}
          </code>
        </SettingsRow>
        <SettingsRow label={t('配置')} hint={t('模型槽来自这台 Runner 的这个文件')}>
          <code className="text-meta text-content-secondary">~/.claude/settings.json</code>
        </SettingsRow>
      </SettingsCard>
      <ProviderSection title={t('模型槽')}>
        {source === undefined || source.models.length === 0 ? (
          <p className={cn(SETTINGS_HINT_CLS, 'm-0 px-1')}>
            {source === undefined
              ? t('这台 Runner 还没上报 Claude Code 信息。')
              : t(
                  '在该 Runner 上写 ~/.claude/settings.json 的 env.ANTHROPIC_*_MODEL 槽后，此处自动展示其模型槽。',
                )}
          </p>
        ) : (
          <SettingsCard>
            {source.models.map((model) => (
              <ProviderModelRow
                key={`${model.slot ?? ''}:${model.id}`}
                name={model.slot ?? model.name}
                id={model.id}
              />
            ))}
          </SettingsCard>
        )}
      </ProviderSection>
    </>
  );
}

export function PiEditor({
  machineName,
  providerCount,
  onShowTeam,
}: {
  machineName: string;
  providerCount: number;
  onShowTeam: () => void;
}) {
  const { t } = useI18n();
  return (
    <>
      <ProviderEditorHead
        Mark={PiMark}
        name="pi"
        kind={t('{machine} 上的运行时', { machine: machineName })}
      />
      <SettingsCard>
        <SettingsRow
          label={t('服务商')}
          hint={t('pi 步骤用所有 Runner 的服务商，不读这台 Runner 的配置')}
          className="flex-wrap gap-y-2 py-2.5"
        >
          <Button variant="outline" size="sm" onClick={onShowTeam}>
            {t('所有 Runner 的 {n} 个服务商', { n: providerCount })}
          </Button>
        </SettingsRow>
      </SettingsCard>
    </>
  );
}

export function GeminiEditor({ machineName }: { machineName: string }) {
  const { t } = useI18n();
  return (
    <>
      <ProviderEditorHead
        Mark={GeminiMark}
        name="Gemini CLI"
        kind={t('{machine} 上的 CLI', { machine: machineName })}
      />
      <p className={cn(SETTINGS_HINT_CLS, 'm-0 px-1')}>
        {t('Gemini CLI 还不上报版本和模型；打开后，这台 Runner 会接 Gemini 步骤。')}
      </p>
    </>
  );
}
