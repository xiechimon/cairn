import { cn } from 'cn';
import { KeyRound, Plus } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useApiKeys, useApiMutations, useTodos } from '../api/hooks.js';
import { mapApiKeys, toDisplayTodo } from '../api/mappers.js';
import { useLiveData } from '../api/provider.js';
import { TOPBAR_PRIMARY_BUTTON, TOPBAR_TEXT_BUTTON } from '../board/filter-panel.js';
import { EmptyState } from '../components/empty-state.js';
import { QueryBoundary } from '../components/query-state.js';
import { CARD_RADIUS_CLS, SETTINGS_ROW_CLS, SettingsCard } from '../components/settings-list.js';
import { Button } from '../components/ui/button.js';
import { Card } from '../components/ui/card.js';
import { DIALOG_PRIMARY_BUTTON } from '../components/ui/dialog-shell.js';
import { toastError, toastSuccess } from '../components/ui/toaster.js';
import { blockDemoWrite } from '../demo/demo-gate.js';
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
  const [created, setCreated] = useState<{ id: string; name: string; plaintext: string } | null>(
    null,
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);
  const [removedIds, setRemovedIds] = useState<ReadonlySet<string>>(new Set());
  const keys = live
    ? [
        ...mapApiKeys(keysQ.data ?? []),
        ...(created !== null
          ? [
              {
                id: 'once',
                name: null,
                masked: '',
                gitAccess: false,
                mcpAccess: false,
                machineAccess: true,
                plaintext: created.plaintext,
              },
            ]
          : []),
      ]
    : (fixture.apiKeys?.keys ?? []);
  const listed = keys.filter(
    (key) => (key.name != null || key.masked !== '') && !removedIds.has(key.id),
  );
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
  const copyKey = (text: string) => {
    const failed = (error: unknown) => toastError(t('没能复制，请手动选中 API 密钥复制。'), error);
    const clip = navigator.clipboard;
    if (!clip) {
      failed(null);
      return;
    }
    void clip.writeText(text).then(() => toastSuccess(t('已复制')), failed);
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
        {keys
          .filter((key) => key.plaintext != null)
          .map((key) => (
            <Card
              key={`once-${key.id}`}
              className={cn('mt-6 gap-2 px-4 py-3 shadow-none ring-border', CARD_RADIUS_CLS)}
            >
              {key.id === 'once' && created !== null && (
                <span className="font-mono text-ui text-foreground">{created.name}</span>
              )}
              <div className="flex items-center gap-3">
                <code className="min-w-0 flex-1 font-mono text-ui break-all text-foreground">
                  {key.plaintext}
                </code>
                <Button
                  variant="outline"
                  className={cn(DIALOG_PRIMARY_BUTTON, 'pointer-coarse:h-11')}
                  onClick={live ? () => copyKey(key.plaintext ?? '') : undefined}
                >
                  {t('复制')}
                </Button>
              </div>
              <p className="m-0 text-meta text-content-tertiary">
                {t('请立即复制 API 密钥，它仅显示一次。')}
              </p>
            </Card>
          ))}
        {listed.length > 0 && (
          <SettingsCard className="mt-4">
            {listed.map((key) => (
              <div key={key.id} className={SETTINGS_ROW_CLS}>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-mono text-ui text-foreground">
                    {key.name ?? key.masked}
                  </span>
                  {key.name != null && (
                    <span className="truncate font-mono text-meta text-content-tertiary">
                      {key.masked}
                    </span>
                  )}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(TOPBAR_TEXT_BUTTON, 'pointer-coarse:h-11')}
                  data-testid="api-key-delete"
                  aria-label={t('删除 {name}', { name: key.name ?? key.masked })}
                  onClick={() => setDeleting({ id: key.id, name: key.name ?? key.masked })}
                >
                  {t('删除')}
                </Button>
              </div>
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
              if (typeof res.plaintext === 'string')
                setCreated({ id: res.id, name: body.name, plaintext: res.plaintext });
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
