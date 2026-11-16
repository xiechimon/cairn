import type { LocalProvider, LocalProviderImport } from '@cairn/shared';
import { cn } from 'cn';
import { useEffect, useState } from 'react';
import { useApiMutations, useProviders } from '../api/hooks.js';
import { Button } from '../components/ui/button.js';
import { Card } from '../components/ui/card.js';
import { Checkbox } from '../components/ui/checkbox.js';
import { Spinner } from '../components/ui/spinner.js';
import { toastError, toastSuccess } from '../components/ui/toaster.js';
import { useI18n } from '../i18n/provider.js';
import type { TFunc } from '../i18n/translate.js';

interface LocalProviderBridge {
  scan: () => Promise<LocalProvider[]>;
  read: (providerIds: string[]) => Promise<LocalProviderImport[]>;
}

function localProviderBridge(): LocalProviderBridge | null {
  const desktop = (window as Window & { cairnDesktop?: { localProviders?: LocalProviderBridge } })
    .cairnDesktop;
  return desktop?.localProviders ?? null;
}

type Row = Omit<LocalProvider, 'state'> & { state: LocalProvider['state'] | 'exists' };

function useLocalProviders(teamId: string | undefined, live: boolean): Row[] {
  const providersQ = useProviders(teamId, live);
  const [found, setFound] = useState<LocalProvider[]>([]);
  useEffect(() => {
    const bridge = localProviderBridge();
    if (bridge === null) return;
    let mounted = true;
    void bridge.scan().then(
      (rows) => {
        if (mounted) setFound(rows);
      },
      () => {},
    );
    return () => {
      mounted = false;
    };
  }, []);
  const existing = new Set((providersQ.data?.providers ?? []).map((p) => p.providerId));
  return found.map((row) => (existing.has(row.providerId) ? { ...row, state: 'exists' } : row));
}

function reasonOf(state: Row['state'], t: TFunc): string | null {
  return state === 'needs-login'
    ? t('要在 Cairn 里登录')
    : state === 'needs-key'
      ? t('密钥不在配置文件里')
      : state === 'unsupported'
        ? t('Cairn 还不支持')
        : state === 'exists'
          ? t('已添加')
          : null;
}

export function LocalProviderImportCard({
  teamId,
  live,
}: {
  teamId: string | undefined;
  live: boolean;
}) {
  const { t } = useI18n();
  const rows = useLocalProviders(teamId, live);
  const { createProvider, deleteProvider } = useApiMutations(teamId);
  const [choosing, setChoosing] = useState(false);
  const [unchecked, setUnchecked] = useState<ReadonlySet<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const ready = rows.filter((row) => row.state === 'ready');
  if (ready.length === 0) return null;
  const chosen = choosing ? ready.filter((row) => !unchecked.has(row.providerId)) : ready;

  const importChosen = async () => {
    const bridge = localProviderBridge();
    if (bridge === null || chosen.length === 0) return;
    setImporting(true);
    try {
      const imports = await bridge.read(chosen.map((row) => row.providerId));
      const missing = chosen.length - imports.length;
      if (missing > 0) toastError(t('有 {n} 个服务商已不在这台 Mac 上', { n: missing }), null);
      const added: string[] = [];
      for (const row of imports) {
        if (row.api === null) continue;
        try {
          const created = await createProvider.mutateAsync({
            providerId: row.providerId,
            label: row.label,
            baseUrl: row.baseUrl,
            api: row.api,
            authHeader: row.authHeader,
            models: row.models,
            apiKey: row.apiKey,
          });
          added.push(created.id);
        } catch (error) {
          toastError(t('导入 {name} 失败', { name: row.label }), error);
        }
      }
      if (added.length > 0) {
        toastSuccess(t('已导入 {n} 个服务商', { n: added.length }), {
          label: t('撤销'),
          onClick: () => void undoImport(added),
        });
      }
    } catch (error) {
      toastError(t('读取本机配置失败'), error);
    } finally {
      setImporting(false);
    }
  };

  const undoImport = async (ids: readonly string[]) => {
    for (const id of ids) {
      try {
        await deleteProvider.mutateAsync(id);
      } catch (error) {
        toastError(t('撤销导入失败，可以在设置的服务商里删除。'), error);
        return;
      }
    }
  };

  const importLabel = importing
    ? t('导入中…')
    : choosing
      ? t('导入 {n} 个', { n: chosen.length })
      : t('全部导入');

  return (
    <Card
      data-testid="local-provider-import"
      className={cn('gap-3 rounded-lg px-4 py-3', !choosing && 'flex-row flex-wrap items-center')}
    >
      {choosing ? (
        <ul className="m-0 flex list-none flex-col p-0">
          {rows.map((row) => {
            const reason = reasonOf(row.state, t);
            const selectable = row.state === 'ready';
            const id = `local-provider-${row.providerId}`;
            return (
              <li key={row.providerId} className="flex min-h-9 items-center gap-3">
                <Checkbox
                  id={id}
                  aria-label={row.label}
                  disabled={!selectable || importing}
                  checked={selectable && !unchecked.has(row.providerId)}
                  onCheckedChange={(checked) =>
                    setUnchecked((prev) => {
                      const next = new Set(prev);
                      if (checked) next.delete(row.providerId);
                      else next.add(row.providerId);
                      return next;
                    })
                  }
                />
                <label
                  htmlFor={id}
                  className={cn('min-w-0 flex-1 truncate', !selectable && 'text-content-tertiary')}
                >
                  {row.label}
                </label>
                {reason !== null && (
                  <span className="flex-none text-meta text-content-tertiary">{reason}</span>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="min-w-0 flex-1 text-pretty break-keep">
          {t('在这台 Mac 上找到 {n} 个服务商', { n: ready.length })}
          <span className="ml-2 text-meta text-content-tertiary">{t('来自 Pi')}</span>
        </div>
      )}
      <div className="ml-auto flex items-center gap-2">
        <Button
          variant="outline"
          data-testid="local-provider-import-choose"
          disabled={importing}
          onClick={() => {
            setUnchecked(new Set());
            setChoosing(!choosing);
          }}
        >
          {choosing ? t('取消') : t('选择')}
        </Button>
        <Button
          data-testid="local-provider-import-go"
          disabled={importing || chosen.length === 0}
          onClick={() => void importChosen()}
        >
          {importing && <Spinner className="size-4" />}
          {importLabel}
        </Button>
      </div>
    </Card>
  );
}
