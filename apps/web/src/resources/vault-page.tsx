import type { BrowserPasswordGrant, SecretListEntry } from '@cairn/shared';
import { cn } from 'cn';
import { Ellipsis, Lock, Plus, UserKey } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useApiMutations, useBrowserPasswordGrants, useSecrets } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { TOPBAR_PRIMARY_BUTTON, TOPBAR_TEXT_BUTTON } from '../board/filter-panel.js';
import { relativeTime } from '../board/rel-time.js';
import { EmptyState } from '../components/empty-state.js';
import { IconTooltip } from '../components/icon-tooltip.js';
import { InfoTip } from '../components/info-tip.js';
import { KeyedMenuContent, KeyedMenuItem } from '../components/menu-keys.js';
import { QueryBoundary } from '../components/query-state.js';
import { SETTINGS_ROW_CLS } from '../components/settings-list.js';
import { Button } from '../components/ui/button.js';
import { DropdownMenu, DropdownMenuTrigger } from '../components/ui/dropdown-menu.js';
import { toastError } from '../components/ui/toaster.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { DeleteConfirm } from '../overlay/delete-confirm.js';
import { PageShell } from '../pages/shell.js';
import { settingsHref } from '../settings/settings-href.js';
import { ResourceList, ResourceRow } from './parts.js';
import { type PairDraft, VaultPairDialog } from './vault-pair-dialog.js';

const PAIR_COLUMNS_CLS =
  'grid w-full grid-cols-[minmax(0,2fr)_minmax(0,3fr)_minmax(0,1fr)_2rem] items-center gap-4 max-sm:grid-cols-[minmax(0,1fr)_2.75rem] max-sm:gap-x-2 max-sm:gap-y-0.5';

const GRANT_COLUMNS_CLS =
  'grid w-full grid-cols-[minmax(0,3fr)_minmax(0,2fr)_minmax(0,1fr)_5rem] items-center gap-4 max-sm:grid-cols-[minmax(0,1fr)_5rem] max-sm:gap-x-2 max-sm:gap-y-0.5';

function grantHost(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

export function VaultPage() {
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const fixture = resolveScenario(searchParams);
  const { live, teamId } = useLiveData();
  const secretsQ = useSecrets(teamId, live);
  const grantsQ = useBrowserPasswordGrants(teamId, live);
  const secrets = live ? (secretsQ.data ?? []) : (fixture.resources?.secrets ?? []);
  const grants = live
    ? (grantsQ.data?.grants ?? [])
    : (fixture.resources?.browserPasswordGrants ?? []);
  const pairs = secrets.filter((row) => row.kind === 'pair');
  const mutations = useApiMutations(teamId);
  const [dialog, setDialog] = useState<{ editing: SecretListEntry | null; opened: number } | null>(
    null,
  );
  const [deleting, setDeleting] = useState<SecretListEntry | null>(null);
  const now = Date.now();
  const empty = (!live || secretsQ.isSuccess) && pairs.length === 0;

  const save = (draft: PairDraft) => {
    const editing = dialog?.editing ?? null;
    if (!live) {
      setDialog(null);
      return;
    }
    const done = { onSuccess: () => setDialog(null) };
    if (editing === null) {
      mutations.createSecret.mutate(
        {
          name: draft.name,
          description: draft.site,
          value: draft.password,
          username: draft.username,
          kind: 'pair',
        },
        { ...done, onError: (error) => toastError(t('未能添加，请重试。'), error) },
      );
      return;
    }
    mutations.updateSecret.mutate(
      {
        id: editing.id,
        body: {
          ...(draft.name !== editing.name ? { name: draft.name } : {}),
          ...(draft.site !== (editing.description ?? '') ? { description: draft.site } : {}),
          ...(draft.username !== '' ? { username: draft.username } : {}),
          ...(draft.password !== '' ? { value: draft.password } : {}),
        },
      },
      { ...done, onError: (error) => toastError(t('未能保存，请重试。'), error) },
    );
  };

  const remove = () => {
    if (deleting === null) return;
    const id = deleting.id;
    setDeleting(null);
    if (!live) return;
    mutations.deleteSecret.mutate(id, {
      onError: (error) => toastError(t('未能删除，请重试。'), error),
    });
  };

  const grantEntry = (grant: BrowserPasswordGrant) => grant.secretName ?? t('已删除的登录');

  return (
    <PageShell
      route={settingsHref('vault')}
      title={t('保险库')}
      selected="none"
      actions={
        !empty ? (
          <Button
            className={TOPBAR_PRIMARY_BUTTON}
            onClick={() => setDialog({ editing: null, opened: Date.now() })}
            data-testid="vault-new"
          >
            <Plus aria-hidden strokeWidth={1.75} className="size-5" />
            {t('添加登录')}
          </Button>
        ) : null
      }
      fixture={fixture}
    >
      <div className="flex min-w-0 flex-col gap-8 pb-16">
        <section className="flex min-w-0 flex-col">
          <div className="mt-4 flex items-center gap-1.5">
            <h3 className="m-0 text-ui font-semibold text-foreground">{t('网站登录')}</h3>
            <InfoTip
              info={t(
                '浏览器代填用的网站登录保存在这里。Coordinator 只在你批准的网站上填入用户名和密码，这两个值不会出现在页面或对话里。',
              )}
            />
          </div>
          <QueryBoundary
            query={live ? secretsQ : undefined}
            isEmpty={pairs.length === 0}
            loadingLabel={t('正在加载网站登录')}
            errorTitle={t('网站登录未能加载')}
            className="mt-3"
            empty={
              <EmptyState
                testId="vault-empty"
                className="mt-3"
                icon={UserKey}
                title={t('暂无保存的网站登录')}
                description={t('保存网站的用户名和密码后，Coordinator 可以在浏览器里代填。')}
                action={{
                  label: t('添加登录'),
                  onClick: () => setDialog({ editing: null, opened: Date.now() }),
                }}
              />
            }
          >
            <ResourceList className="mt-3">
              <div
                aria-hidden
                className={cn(
                  SETTINGS_ROW_CLS,
                  'min-h-10 text-meta text-content-tertiary max-sm:hidden',
                )}
              >
                <span className={PAIR_COLUMNS_CLS}>
                  <span>{t('名称')}</span>
                  <span>{t('登录')}</span>
                  <span>{t('最后更新')}</span>
                </span>
              </div>
              {pairs.map((entry) => (
                <ResourceRow key={entry.id}>
                  <span className={PAIR_COLUMNS_CLS}>
                    <span className="flex min-w-0 flex-col">
                      <span
                        title={entry.name}
                        className="truncate font-mono text-ui text-foreground"
                      >
                        {entry.name}
                      </span>
                      {entry.description != null && entry.description !== '' && (
                        <span
                          title={entry.description}
                          className="truncate text-meta text-content-tertiary"
                        >
                          {entry.description}
                        </span>
                      )}
                    </span>
                    <span className="min-w-0 max-sm:col-start-1 max-sm:row-start-2">
                      <span className="inline-flex items-center gap-1.5 text-ui text-content-tertiary">
                        <Lock aria-hidden strokeWidth={1.75} className="size-4 flex-none" />
                        {t('用户名和密码')}
                      </span>
                    </span>
                    <span className="truncate text-meta text-content-tertiary max-sm:col-start-1 max-sm:row-start-3">
                      {entry.updatedAt == null ? t('较早') : relativeTime(entry.updatedAt, now, t)}
                    </span>
                    <span className="flex justify-end max-sm:col-start-2 max-sm:row-span-3 max-sm:row-start-1">
                      <DropdownMenu>
                        <IconTooltip
                          label={t('{name} 的菜单', { name: entry.name })}
                          trigger={
                            <DropdownMenuTrigger
                              render={
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  data-testid="vault-entry-menu"
                                  className="text-content-tertiary hover:bg-transparent hover:text-foreground aria-expanded:bg-menu-hover aria-expanded:text-foreground pointer-coarse:size-11 dark:hover:bg-transparent dark:aria-expanded:bg-menu-hover"
                                />
                              }
                            />
                          }
                        >
                          <Ellipsis aria-hidden strokeWidth={1.75} />
                        </IconTooltip>
                        <KeyedMenuContent
                          side="bottom"
                          align="end"
                          sideOffset={4}
                          className="w-auto min-w-40"
                        >
                          <KeyedMenuItem
                            shortcut="E"
                            data-testid="vault-entry-edit"
                            onClick={() => setDialog({ editing: entry, opened: Date.now() })}
                          >
                            {t('编辑')}
                          </KeyedMenuItem>
                          <KeyedMenuItem
                            shortcut="D"
                            confirms
                            data-testid="vault-entry-delete"
                            onClick={() => setDeleting(entry)}
                          >
                            {t('删除')}
                          </KeyedMenuItem>
                        </KeyedMenuContent>
                      </DropdownMenu>
                    </span>
                  </span>
                </ResourceRow>
              ))}
            </ResourceList>
          </QueryBoundary>
        </section>
        <section className="flex min-w-0 flex-col">
          <h3 className="m-0 text-ui font-semibold text-foreground">{t('网站授权')}</h3>
          <p className="m-0 mt-1 text-meta text-pretty text-content-tertiary">
            {t('批准过的网站在这台执行机上直接代填')}{' '}
            <InfoTip info={t('Coordinator 第一次在某个网站代填时会请求批准；撤销后重新请求。')} />
          </p>
          <QueryBoundary
            query={live ? grantsQ : undefined}
            isEmpty={grants.length === 0}
            loadingLabel={t('正在加载网站授权')}
            errorTitle={t('网站授权未能加载')}
            className="mt-3"
            empty={
              <div
                className={cn(
                  SETTINGS_ROW_CLS,
                  'mt-3 rounded-(--radius-card) bg-card ring-1 ring-border text-ui text-content-tertiary',
                )}
              >
                <span className="min-w-0 truncate">{t('暂无已批准的网站')}</span>
              </div>
            }
          >
            <ResourceList className="mt-3">
              <div
                aria-hidden
                className={cn(
                  SETTINGS_ROW_CLS,
                  'min-h-10 text-meta text-content-tertiary max-sm:hidden',
                )}
              >
                <span className={GRANT_COLUMNS_CLS}>
                  <span>{t('网站')}</span>
                  <span>{t('执行机')}</span>
                  <span>{t('授权时间')}</span>
                </span>
              </div>
              {grants.map((grant) => (
                <ResourceRow key={grant.grantId} data-state={grant.state}>
                  <span className={GRANT_COLUMNS_CLS}>
                    <span className="flex min-w-0 flex-col">
                      <span
                        title={grant.origin}
                        className="truncate font-mono text-ui text-foreground"
                      >
                        {grantHost(grant.origin)}
                      </span>
                      <span
                        title={grantEntry(grant)}
                        className="truncate font-mono text-meta text-content-tertiary"
                      >
                        {grantEntry(grant)}
                      </span>
                    </span>
                    <span className="truncate text-ui text-content-secondary max-sm:col-start-1 max-sm:row-start-2">
                      {grant.machineName ?? t('已删除的执行机')}
                    </span>
                    <span className="truncate text-meta text-content-tertiary max-sm:col-start-1 max-sm:row-start-3">
                      {grant.grantedAt == null
                        ? relativeTime(grant.createdAt, now, t)
                        : relativeTime(grant.grantedAt, now, t)}
                    </span>
                    <span className="flex justify-end max-sm:col-start-2 max-sm:row-span-3 max-sm:row-start-1">
                      {grant.state === 'active' ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className={cn(TOPBAR_TEXT_BUTTON, 'pointer-coarse:h-11')}
                          data-testid="vault-grant-revoke"
                          disabled={mutations.revokeBrowserPasswordGrant.isPending}
                          onClick={() => {
                            if (!live) return;
                            mutations.revokeBrowserPasswordGrant.mutate(grant.grantId, {
                              onError: (error) => toastError(t('未能撤销授权，请重试。'), error),
                            });
                          }}
                        >
                          {t('撤销授权')}
                        </Button>
                      ) : (
                        <span className="text-meta text-content-tertiary">
                          {grant.state === 'revoked' ? t('已撤销') : t('已失效')}
                        </span>
                      )}
                    </span>
                  </span>
                </ResourceRow>
              ))}
            </ResourceList>
          </QueryBoundary>
        </section>
      </div>
      <VaultPairDialog
        key={dialog?.opened ?? 0}
        open={dialog !== null}
        editing={dialog?.editing ?? null}
        onClose={() => setDialog(null)}
        onSave={save}
      />
      <DeleteConfirm
        open={deleting !== null}
        title={t('删除后，使用它的任务和网站代填将无法获取这条登录')}
        summary={deleting?.name ?? ''}
        ariaLabel={t('删除 {name}', { name: deleting?.name ?? '' })}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
      />
    </PageShell>
  );
}
