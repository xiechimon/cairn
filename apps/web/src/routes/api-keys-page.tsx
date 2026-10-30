import { cn } from 'cn';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useApiKeys, useApiMutations, useTodos } from '../api/hooks.js';
import { mapApiKeys, toDisplayTodo } from '../api/mappers.js';
import { useLiveData } from '../api/provider.js';
import { EmptyState } from '../components/empty-state.js';
import { CARD_RADIUS_CLS, SETTINGS_ROW_CLS, SettingsCard } from '../components/settings-list.js';
import { Button } from '../components/ui/button.js';
import { Card } from '../components/ui/card.js';
import { DIALOG_PRIMARY_BUTTON } from '../components/ui/dialog-shell.js';
import { toastError } from '../components/ui/toaster.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { Key } from '../icons/index.js';
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
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const keys = live
    ? [
        ...mapApiKeys(keysQ.data ?? []),
        ...(plaintext !== null
          ? [
              {
                id: 'once',
                name: null,
                masked: '',
                gitAccess: false,
                mcpAccess: false,
                machineAccess: true,
                plaintext,
              },
            ]
          : []),
      ]
    : (fixture.apiKeys?.keys ?? []);
  const listed = keys.filter((key) => key.name != null || key.masked !== '');
  return (
    <PageShell
      route="api-keys"
      fixture={live ? { ...fixture, todos: (todosQ.data ?? []).map(toDisplayTodo) } : fixture}
      selected="none"
      title={t('API 密钥')}
    >
      {keys.length === 0 ? (
        <EmptyState
          testId="keys-empty"
          className="mt-6"
          icon={Key}
          title={t('尚无 API 密钥。')}
          description={t('API 密钥用于从命令行接入机器，也让 MCP 客户端能访问你的工作台。')}
          action={{ label: t('新建密钥'), onClick: live ? () => setCreateOpen(true) : undefined }}
        />
      ) : (
        <>
          {live && (
            <div className="mt-6 flex justify-end">
              <Button className={DIALOG_PRIMARY_BUTTON} onClick={() => setCreateOpen(true)}>
                {t('新建密钥')}
              </Button>
            </div>
          )}
          {keys
            .filter((key) => key.plaintext != null)
            .map((key) => (
              <Card
                key={`once-${key.id}`}
                className={cn('mt-6 gap-2 px-4 py-3 shadow-none ring-border', CARD_RADIUS_CLS)}
              >
                <div className="flex items-center gap-3">
                  <code className="min-w-0 flex-1 font-mono text-ui break-all text-foreground">
                    {key.plaintext}
                  </code>
                  <Button
                    variant="outline"
                    className={DIALOG_PRIMARY_BUTTON}
                    onClick={
                      live
                        ? () => void navigator.clipboard?.writeText(key.plaintext ?? '')
                        : undefined
                    }
                  >
                    {t('复制')}
                  </Button>
                </div>
                <p className="m-0 text-meta text-content-tertiary">
                  {t('请立即复制密钥，它仅显示一次。')}
                </p>
              </Card>
            ))}
          {listed.length > 0 && (
            <SettingsCard className="mt-4">
              {listed.map((key) => (
                <div key={key.id} className={SETTINGS_ROW_CLS}>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-ui text-foreground">
                      {key.name ?? key.masked}
                    </span>
                    {key.name != null && (
                      <span className="truncate font-mono text-meta text-content-tertiary">
                        {key.masked}
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </SettingsCard>
          )}
        </>
      )}
      <ApiKeyCreateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={(body) =>
          mutations.createApiKey.mutate(body, {
            onSuccess: (res) => {
              if (typeof res.plaintext === 'string') setPlaintext(res.plaintext);
            },
            onError: (error) => toastError(t('新建 API 密钥失败，请重试。'), error),
          })
        }
      />
    </PageShell>
  );
}
