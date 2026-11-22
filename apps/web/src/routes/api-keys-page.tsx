import { cn } from 'cn';
import { KeyRound, Plus } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useApiKeys, useApiMutations, useTodos } from '../api/hooks.js';
import { mapApiKeys, toDisplayTodo } from '../api/mappers.js';
import { useLiveData } from '../api/provider.js';
import { TOPBAR_PRIMARY_BUTTON, TOPBAR_TEXT_BUTTON } from '../board/filter-panel.js';
import { CopyIconButton } from '../components/copy-icon-button.js';
import { EmptyState } from '../components/empty-state.js';
import { QueryBoundary } from '../components/query-state.js';
import { SETTINGS_ROW_CLS, SettingsCard } from '../components/settings-list.js';
import { Button } from '../components/ui/button.js';
import { toastError } from '../components/ui/toaster.js';
import { blockDemoWrite } from '../demo/demo-gate.js';
import type { ApiKeyRecord } from '../fixtures/records.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { DeleteConfirm } from '../overlay/delete-confirm.js';
import { PageShell } from '../pages/shell.js';
import { ApiKeyCreateDialog } from './api-key-create-dialog.js';

export function ApiKeysPage() {
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const fixture = resolveScenario(searchParams);
  const { live, teamId } = useLiveData();
  const keysQ = useApiKeys(teamId, live);
  const todosQ = useTodos(teamId, live);
  const mutations = useApiMutations(teamId);
  const [created, setCreated] = useState<ApiKeyRecord | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);
  const [removedIds, setRemovedIds] = useState<ReadonlySet<string>>(new Set());
  const keys = live
    ? withCreated(mapApiKeys(keysQ.data ?? []), created)
    : (fixture.apiKeys?.keys ?? []);
  const listed = keys.filter((key) => !removedIds.has(key.id));
  const remove = () => {
    if (deleting === null) return;
    const { id } = deleting;
    setDeleting(null);
    if (!live) {
      blockDemoWrite();
      return;
    }
    setRemovedIds((ids) => new Set(ids).add(id));
    if (created?.id === id) setCreated(null);
    mutations.deleteApiKey.mutate(id, {
      onError: (error) => {
        setRemovedIds((ids) => {
          const next = new Set(ids);
          next.delete(id);
          return next;
        });
        toastError(t('没能删除，请重试。'), error);
      },
    });
  };
  return (
    <PageShell
      route="api-keys"
      fixture={live ? { ...fixture, todos: (todosQ.data ?? []).map(toDisplayTodo) } : fixture}
      selected="none"
      title={t('API 密钥')}
      actions={
        live && keys.length > 0 ? (
          <Button className={TOPBAR_PRIMARY_BUTTON} onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden strokeWidth={1.75} className="size-5" />
            {t('新建 API 密钥')}
          </Button>
        ) : null
      }
    >
      <QueryBoundary
        query={live ? keysQ : undefined}
        isEmpty={keys.length === 0}
        loadingLabel={t('正在加载 API 密钥')}
        errorTitle={t('API 密钥没能加载')}
        className="mt-6"
        empty={
          <EmptyState
            testId="keys-empty"
            className="mt-6"
            icon={KeyRound}
            title={t('尚无 API 密钥')}
            description={t('API 密钥用于从命令行接入执行机，也让 MCP 客户端能访问你的工作台。')}
            action={{ label: t('新建 API 密钥'), onClick: () => setCreateOpen(true) }}
          />
        }
      >
        {listed.length > 0 && (
          <SettingsCard className="mt-6">
            {listed.map((key) => (
              <ApiKeyRow
                key={key.id}
                apiKey={key}
                onDelete={() => setDeleting({ id: key.id, name: key.name ?? key.masked })}
              />
            ))}
          </SettingsCard>
        )}
      </QueryBoundary>
      <ApiKeyCreateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={(body) => {
          if (!live) {
            blockDemoWrite();
            return;
          }
          mutations.createApiKey.mutate(body, {
            onSuccess: (res) => {
              const [row] = mapApiKeys([res]);
              if (row?.id !== undefined && typeof res.plaintext === 'string')
                setCreated({ ...row, plaintext: res.plaintext });
            },
            onError: (error) => toastError(t('新建 API 密钥失败，请重试。'), error),
          });
        }}
      />
      <DeleteConfirm
        open={deleting !== null}
        title={t('删除后，用这个 API 密钥的 MCP 客户端、脚本和 Git 访问会立即失效，无法恢复')}
        summary={<span className="truncate font-mono">{deleting?.name ?? ''}</span>}
        ariaLabel={t('删除 {name}', { name: deleting?.name ?? '' })}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
      />
    </PageShell>
  );
}

function withCreated(keys: ApiKeyRecord[], created: ApiKeyRecord | null): ApiKeyRecord[] {
  if (created === null) return keys;
  if (!keys.some((key) => key.id === created.id)) return [...keys, created];
  return keys.map((key) =>
    key.id === created.id ? { ...key, plaintext: created.plaintext } : key,
  );
}

function ApiKeyRow({ apiKey, onDelete }: { apiKey: ApiKeyRecord; onDelete: () => void }) {
  const { t } = useI18n();
  const label = apiKey.name ?? apiKey.masked;
  return (
    <div data-testid="api-key-row" className={SETTINGS_ROW_CLS}>
      <span className="flex min-w-0 flex-1 flex-col">
        {apiKey.name !== null && (
          <span className="truncate font-mono text-ui text-foreground">{apiKey.name}</span>
        )}
        {apiKey.plaintext !== undefined ? (
          <>
            <code className="font-mono text-meta break-all text-foreground">
              {apiKey.plaintext}
            </code>
            <span className="text-meta text-content-tertiary">
              {t('请立即复制 API 密钥，它仅显示一次。')}
            </span>
          </>
        ) : (
          <span
            className={cn(
              'truncate font-mono',
              apiKey.name === null ? 'text-ui text-foreground' : 'text-meta text-content-tertiary',
            )}
          >
            {apiKey.masked}
          </span>
        )}
      </span>
      <span className="flex flex-none items-center gap-1">
        {apiKey.plaintext !== undefined && (
          <CopyIconButton
            text={apiKey.plaintext}
            testId="api-key-copy"
            className="pointer-coarse:size-11"
          />
        )}
        <Button
          variant="ghost"
          size="sm"
          className={cn(TOPBAR_TEXT_BUTTON, 'pointer-coarse:h-11')}
          data-testid="api-key-delete"
          aria-label={t('删除 {name}', { name: label })}
          onClick={onDelete}
        >
          {t('删除')}
        </Button>
      </span>
    </div>
  );
}
