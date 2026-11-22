import type { SecretListEntry } from '@cairn/shared';
import { cn } from 'cn';
import { Ellipsis, Lock, ShieldEllipsis } from 'lucide-react';
import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useApiMutations, useProjects, useSecrets } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { TOPBAR_TEXT_BUTTON } from '../board/filter-panel.js';
import { relativeTime } from '../board/rel-time.js';
import { EmptyState } from '../components/empty-state.js';
import { IconTooltip } from '../components/icon-tooltip.js';
import { InfoTip } from '../components/info-tip.js';
import { KeyedMenuContent, KeyedMenuItem } from '../components/menu-keys.js';
import { QueryBoundary } from '../components/query-state.js';
import { SETTINGS_ROW_CLS } from '../components/settings-list.js';
import { AlertDialogShell } from '../components/ui/alert-dialog-shell.js';
import { Button } from '../components/ui/button.js';
import { DIALOG_PRIMARY_BUTTON, DIALOG_TEXT_BUTTON } from '../components/ui/dialog-shell.js';
import { DropdownMenu, DropdownMenuTrigger } from '../components/ui/dropdown-menu.js';
import { InputGroup, InputGroupAddon, InputGroupInput } from '../components/ui/input-group.js';
import { toastError } from '../components/ui/toaster.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { Search } from '../icons/index.js';
import { DeleteConfirm } from '../overlay/delete-confirm.js';
import { PageShell } from '../pages/shell.js';
import { BulkSecretDialog } from './bulk-secret-dialog.js';
import { SECRETS_HREF } from './hrefs.js';
import { ResourceList, ResourceNewButton, ResourceRow } from './parts.js';
import { SecretDialog, type SecretDraft } from './secret-dialog.js';

const COLUMNS_CLS =
  'grid w-full grid-cols-[minmax(0,2fr)_minmax(0,3fr)_minmax(0,1fr)_2rem] items-center gap-4 max-sm:grid-cols-[minmax(0,1fr)_2.75rem] max-sm:gap-x-2 max-sm:gap-y-0.5';

interface DialogState {
  editing: SecretListEntry | null;
  startSecret: boolean;
  opened: number;
}

export function SecretsPage() {
  const { t } = useI18n();
  const [searchParams] = useSearchParams();
  const fixture = resolveScenario(searchParams);
  const { live, teamId } = useLiveData();
  const secretsQ = useSecrets(teamId, live);
  const secrets = (live ? (secretsQ.data ?? []) : (fixture.resources?.secrets ?? [])).filter(
    (row) => row.kind !== 'pair',
  );
  const mutations = useApiMutations(teamId);
  const projectsQ = useProjects(teamId, live);
  const projects = (projectsQ.data ?? []).map((project) => ({
    id: project.id,
    name: project.name,
  }));
  const projectName = (id: string | null | undefined) =>
    id == null ? null : (projects.find((project) => project.id === id)?.name ?? null);
  const [query, setQuery] = useState('');
  const filterRef = useRef<HTMLInputElement>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [converting, setConverting] = useState<SecretListEntry | null>(null);
  const [deleting, setDeleting] = useState<SecretListEntry | null>(null);
  const openDialog = (editing: SecretListEntry | null, startSecret = false) =>
    setDialog({ editing, startSecret, opened: Date.now() });
  const needle = query.trim().toLowerCase();
  const shown =
    needle === '' ? secrets : secrets.filter((row) => row.name.toLowerCase().includes(needle));
  const now = Date.now();
  const empty = (!live || secretsQ.isSuccess) && secrets.length === 0;

  const save = (draft: SecretDraft) => {
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
          value: draft.value,
          kind: draft.secret ? 'secret' : 'env',
          ...(draft.projectId !== undefined ? { projectId: draft.projectId } : {}),
        },
        { ...done, onError: (error) => toastError(t('未能添加，请重试。'), error) },
      );
      return;
    }
    const keepsSecretValue = editing.kind !== 'env' && draft.value === '';
    mutations.updateSecret.mutate(
      {
        id: editing.id,
        body: {
          ...(draft.name !== editing.name ? { name: draft.name } : {}),
          ...(keepsSecretValue ? {} : { value: draft.value }),
          ...(draft.secret && editing.kind === 'env' ? { kind: 'secret' as const } : {}),
        },
      },
      { ...done, onError: (error) => toastError(t('未能保存，请重试。'), error) },
    );
  };

  const convert = () => {
    if (converting === null) return;
    const id = converting.id;
    setConverting(null);
    if (!live) return;
    mutations.updateSecret.mutate(
      { id, body: { kind: 'secret' } },
      { onError: (error) => toastError(t('未能转为机密，请重试。'), error) },
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

  return (
    <PageShell
      route={SECRETS_HREF}
      title={t('密钥与环境变量')}
      selected={SECRETS_HREF}
      actions={
        <>
          <Button
            variant="ghost"
            size="sm"
            className={TOPBAR_TEXT_BUTTON}
            onClick={() => setBulkOpen(true)}
            data-testid="secret-bulk"
          >
            {t('批量添加')}
          </Button>
          {!empty && <ResourceNewButton onClick={() => openDialog(null)} />}
        </>
      }
      fixture={fixture}
    >
      <p className="m-0 mt-2 text-ui text-content-secondary">
        {t('项目里的同名条目优先于团队条目')}{' '}
        <InfoTip
          info={t(
            '任务在执行机上运行时按需取用被授予的条目——取用走 get_secret 工具，每次都有记录，值不预置进 shell 环境。遥测导出这类进程级设置不走这里，放在执行机或服务器的环境变量。',
          )}
        />
      </p>
      <QueryBoundary
        query={live ? secretsQ : undefined}
        isEmpty={secrets.length === 0}
        loadingLabel={t('正在加载密钥')}
        errorTitle={t('密钥未能加载')}
        className="mt-6"
        empty={
          <EmptyState
            testId="resource-empty"
            className="mt-6"
            icon={ShieldEllipsis}
            title={t('暂无密钥或环境变量')}
            description={t('执行机运行任务时会获取它们。')}
            action={{ label: t('添加'), onClick: () => openDialog(null) }}
          />
        }
      >
        <div className="mt-6">
          <InputGroup className="pointer-coarse:h-11 sm:max-w-80">
            <InputGroupAddon>
              <Search className="size-5" />
            </InputGroupAddon>
            <InputGroupInput
              ref={filterRef}
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('按名称筛选')}
              aria-label={t('按名称筛选')}
            />
          </InputGroup>
        </div>
        <ResourceList>
          {shown.length > 0 ? (
            <div
              aria-hidden
              className={cn(
                SETTINGS_ROW_CLS,
                'min-h-10 text-meta text-content-tertiary max-sm:hidden',
              )}
            >
              <span className={COLUMNS_CLS}>
                <span>{t('名称')}</span>
                <span>{t('值')}</span>
                <span>{t('最后更新')}</span>
              </span>
            </div>
          ) : (
            <div className={cn(SETTINGS_ROW_CLS, 'text-ui text-content-tertiary')}>
              <span className="min-w-0 truncate">
                {t('没有名称包含「{q}」的条目', { q: query.trim() })}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className={cn(TOPBAR_TEXT_BUTTON, 'flex-none pointer-coarse:h-11')}
                onClick={() => {
                  setQuery('');
                  filterRef.current?.focus();
                }}
              >
                {t('清除筛选')}
              </Button>
            </div>
          )}
          {shown.map((secret) => {
            const scope = projectName(secret.projectId);
            const isEnv = secret.kind === 'env';
            const envValue = secret.value ?? '';
            const detail = [
              ...(scope !== null ? [t('仅 {name}', { name: scope })] : []),
              ...(secret.description != null ? [secret.description] : []),
            ].join(' · ');
            return (
              <ResourceRow key={secret.id} data-kind={isEnv ? 'env' : 'secret'}>
                <span className={COLUMNS_CLS}>
                  <span className="flex min-w-0 flex-col">
                    <span
                      title={secret.name}
                      className="truncate font-mono text-ui text-foreground"
                    >
                      {secret.name}
                    </span>
                    {detail !== '' && (
                      <span title={detail} className="truncate text-meta text-content-tertiary">
                        {detail}
                      </span>
                    )}
                  </span>
                  <span className="min-w-0 max-sm:col-start-1 max-sm:row-start-2">
                    {isEnv && envValue !== '' ? (
                      <span
                        data-testid="secret-value"
                        title={envValue}
                        className="block truncate font-mono text-ui text-content-secondary"
                      >
                        {envValue}
                      </span>
                    ) : isEnv ? (
                      <span data-testid="secret-value" className="text-ui text-content-tertiary">
                        {t('空值')}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-ui text-content-tertiary">
                        <Lock aria-hidden strokeWidth={1.75} className="size-4 flex-none" />
                        {t('机密')}
                      </span>
                    )}
                  </span>
                  <span className="truncate text-meta text-content-tertiary max-sm:col-start-1 max-sm:row-start-3">
                    {secret.updatedAt == null ? t('较早') : relativeTime(secret.updatedAt, now, t)}
                  </span>
                  <span className="flex justify-end max-sm:col-start-2 max-sm:row-span-3 max-sm:row-start-1">
                    <DropdownMenu>
                      <IconTooltip
                        label={t('{name} 的菜单', { name: secret.name })}
                        trigger={
                          <DropdownMenuTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                data-testid="secret-menu"
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
                        {isEnv && (
                          <KeyedMenuItem
                            shortcut="S"
                            data-testid="secret-menu-convert"
                            onClick={() =>
                              envValue === '' ? openDialog(secret, true) : setConverting(secret)
                            }
                          >
                            {t('转为机密')}
                          </KeyedMenuItem>
                        )}
                        <KeyedMenuItem
                          shortcut="E"
                          data-testid="secret-menu-edit"
                          onClick={() => openDialog(secret)}
                        >
                          {t('编辑')}
                        </KeyedMenuItem>
                        <KeyedMenuItem
                          shortcut="D"
                          confirms
                          data-testid="secret-menu-delete"
                          onClick={() => setDeleting(secret)}
                        >
                          {t('删除')}
                        </KeyedMenuItem>
                      </KeyedMenuContent>
                    </DropdownMenu>
                  </span>
                </span>
              </ResourceRow>
            );
          })}
        </ResourceList>
      </QueryBoundary>
      <SecretDialog
        key={`${dialog?.opened ?? 0}:${searchParams.get('project') ?? ''}`}
        open={dialog !== null}
        editing={dialog?.editing ?? null}
        startSecret={dialog?.startSecret ?? false}
        projects={projects}
        defaultProjectId={searchParams.get('project')}
        onClose={() => setDialog(null)}
        onSave={save}
      />
      <BulkSecretDialog
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        onCreate={
          live
            ? (body) => mutations.createSecret.mutateAsync(body).then(() => undefined)
            : undefined
        }
      />
      <AlertDialogShell
        title={t('把 {name} 转为机密？', { name: converting?.name ?? '' })}
        ariaLabel={t('转为机密')}
        open={converting !== null}
        onClose={() => setConverting(null)}
        footer={
          <>
            <Button
              variant="ghost"
              className={cn(DIALOG_TEXT_BUTTON, 'pointer-coarse:h-11')}
              onClick={() => setConverting(null)}
            >
              {t('取消')}
            </Button>
            <Button
              variant="outline"
              className={cn(DIALOG_PRIMARY_BUTTON, 'pointer-coarse:h-11')}
              onClick={convert}
              data-testid="secret-convert-confirm"
            >
              {t('转为机密')}
            </Button>
          </>
        }
      >
        <p className="m-0 text-ui text-content-secondary">
          {t(
            '转为机密后，这里不再显示它的值，也不能再转回环境变量。已经出现在浏览器、对话或其他系统里的值不会被收回。',
          )}
        </p>
      </AlertDialogShell>
      <DeleteConfirm
        open={deleting !== null}
        title={t('删除后，使用它的任务将无法获取这个值')}
        summary={deleting?.name ?? ''}
        ariaLabel={t('删除 {name}', { name: deleting?.name ?? '' })}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
      />
    </PageShell>
  );
}
