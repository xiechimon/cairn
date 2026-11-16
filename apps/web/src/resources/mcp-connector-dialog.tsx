import {
  type CreateMcpConnectorBody,
  type McpCatalogEntry,
  type McpConnectorRecord,
  mcpCatalogEntry,
} from '@cairn/shared';
import { cn } from 'cn';
import { type Ref, useRef, useState } from 'react';
import { ApiError } from '../api/client.js';
import { useApiMutations } from '../api/hooks.js';
import { FORM_CONTROL_CLS, FormField, FormStack } from '../components/form-layout.js';
import { Button } from '../components/ui/button.js';
import {
  DIALOG_PRIMARY_BUTTON,
  DIALOG_TEXT_BUTTON,
  DialogShell,
} from '../components/ui/dialog-shell.js';
import { Field } from '../components/ui/field.js';
import { Input } from '../components/ui/input.js';
import { useI18n } from '../i18n/provider.js';
import { Plus, X } from '../icons/index.js';
import { DeleteConfirm } from '../overlay/delete-confirm.js';
import { McpGrantSection, type McpGrants } from './mcp-grants.js';

const PALE_DISABLED = 'disabled:bg-secondary/50 disabled:text-content-dim disabled:opacity-100';

const FIELD_CLS = cn(FORM_CONTROL_CLS, 'placeholder:text-content-tertiary');

const DIALOG_FORM_CLS = 'max-w-none text-balance [word-break:keep-all]';

const VALUE_BOX_CLS =
  'm-0 rounded-(--radius-control) bg-muted px-3 py-2 font-mono text-ui text-foreground break-all';

export type McpDialogTarget =
  | { kind: 'catalog'; entry: McpCatalogEntry }
  | { kind: 'custom' }
  | { kind: 'manage'; connector: McpConnectorRecord };

export interface McpSignIn {
  name: string;
  host: string;
  authorizationUrl: string;
  entry?: McpCatalogEntry;
}

export type McpOAuthRequest =
  | { kind: 'custom'; slug: string; label: string; url: string }
  | { kind: 'reconnect'; connector: McpConnectorRecord };

type Translate = (text: string, vars?: Record<string, string | number>) => string;

export function connectorProblem(t: Translate, record: McpConnectorRecord): string | null {
  if (record.status === 'connected' || record.status === 'unchecked') return null;
  const name = record.label;
  switch (record.statusReason) {
    case 'unauthorized':
      return t('{name} 拒绝了这个令牌。检查令牌是否填对、有没有过期，然后换一个新的。', { name });
    case 'forbidden':
      return t('令牌有效，但权限不够。给令牌加上需要的权限后重新检查。');
    case 'timeout':
      return t('{name} 10 秒内没有响应。稍后重新检查。', { name });
    case 'unreachable':
      return t('连不上这个地址。检查地址是否正确、服务器是否在线。');
    case 'reconnect':
    case 'expired':
      return t('{name} 的授权已失效，重新连接一次。', { name });
    case 'refresh_rejected':
      return t('{name} 收回了这次授权，重新连接一次。', { name });
    case 'refresh_failed':
      return t('刷新 {name} 的授权时出错，稍后重新检查。', { name });
    default:
      return t('{name} 返回了错误。稍后重新检查。', { name });
  }
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

const slugOf = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

function submitError(t: Translate, error: unknown): string {
  if (error instanceof ApiError && error.status === 409)
    return t('这个标识已经被占用了，换一个标识再试。');
  if (error instanceof ApiError && error.status === 400)
    return t('有字段格式不对。地址要以 https:// 开头，标识只能用小写字母、数字和连字符（-）。');
  return t('没能保存，稍后重试。');
}

interface McpConnectorDialogProps {
  target: McpDialogTarget | null;
  live: boolean;
  teamId: string | undefined;
  grants: McpGrants;
  onClose: () => void;
  onConnected: (record: McpConnectorRecord) => void;
  onSignIn: (request: McpOAuthRequest) => void;
}

export function McpConnectorDialog({
  target,
  live,
  teamId,
  grants,
  onClose,
  onConnected,
  onSignIn,
}: McpConnectorDialogProps) {
  if (target === null) return null;
  const key = target.kind === 'manage' ? target.connector.id : target.kind;
  if (target.kind === 'catalog')
    return (
      <CatalogConnectDialog
        key={key}
        entry={target.entry}
        live={live}
        teamId={teamId}
        onClose={onClose}
        onConnected={onConnected}
      />
    );
  if (target.kind === 'custom')
    return (
      <CustomServerDialog
        key={key}
        live={live}
        teamId={teamId}
        onClose={onClose}
        onConnected={onConnected}
        onSignIn={onSignIn}
      />
    );
  return (
    <ManageConnectorDialog
      key={key}
      connector={target.connector}
      live={live}
      teamId={teamId}
      grants={grants}
      onClose={onClose}
      onSignIn={onSignIn}
    />
  );
}

function DialogError({ message }: { message: string | null }) {
  if (message === null) return null;
  return (
    <p role="alert" className="m-0 text-meta text-destructive">
      {message}
    </p>
  );
}

interface FootAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

function DialogFoot({
  primary,
  onCancel,
  danger,
  secondary,
  primaryRef,
  cancelLabel,
}: {
  primary: FootAction;
  primaryRef?: Ref<HTMLButtonElement>;
  onCancel: () => void;
  cancelLabel?: string;
  danger?: FootAction;
  secondary?: FootAction;
}) {
  const { t } = useI18n();
  return (
    <div className="flex w-full items-center gap-2">
      {danger !== undefined && (
        <Button
          variant="ghost"
          className={`${DIALOG_TEXT_BUTTON} text-destructive`}
          onClick={danger.onClick}
          disabled={danger.disabled}
        >
          {danger.label}
        </Button>
      )}
      {secondary !== undefined && (
        <Button
          variant="ghost"
          className={DIALOG_TEXT_BUTTON}
          onClick={secondary.onClick}
          disabled={secondary.disabled}
        >
          {secondary.label}
        </Button>
      )}
      <span className="flex-1" />
      <Button variant="ghost" className={DIALOG_TEXT_BUTTON} onClick={onCancel}>
        {cancelLabel ?? t('取消')}
      </Button>
      <Button
        ref={primaryRef}
        className={cn(DIALOG_PRIMARY_BUTTON, PALE_DISABLED)}
        onClick={primary.onClick}
        disabled={primary.disabled}
      >
        {primary.label}
      </Button>
    </div>
  );
}

function TokenField({
  entry,
  value,
  onChange,
  required,
}: {
  entry: McpCatalogEntry;
  value: string;
  onChange: (next: string) => void;
  required: boolean;
}) {
  const { t } = useI18n();
  return (
    <FormField
      label={
        required
          ? t(entry.tokenLabel ?? '令牌')
          : t('{label}（可选）', { label: t(entry.tokenLabel ?? '令牌') })
      }
      htmlFor="mcp-token"
      help={
        <>
          {entry.tokenHelp !== undefined
            ? t(entry.tokenHelp)
            : required
              ? t('加密保存在本机，保存后看不到原文。')
              : t('不填也能用；填了额度更高。')}{' '}
          {entry.tokenHelpUrl !== undefined && (
            <a
              href={entry.tokenHelpUrl}
              target="_blank"
              rel="noreferrer"
              className="whitespace-nowrap text-foreground underline underline-offset-2"
            >
              {t('去 {name} 创建', { name: entry.name })}
            </a>
          )}
        </>
      }
    >
      <Input
        id="mcp-token"
        type="password"
        autoComplete="off"
        className={FIELD_CLS}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </FormField>
  );
}

function CatalogConnectDialog({
  entry,
  live,
  teamId,
  onClose,
  onConnected,
}: {
  entry: McpCatalogEntry;
  live: boolean;
  teamId: string | undefined;
  onClose: () => void;
  onConnected: (record: McpConnectorRecord) => void;
}) {
  const { t } = useI18n();
  const mutations = useApiMutations(teamId);
  const [token, setToken] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const tokenRequired = !entry.auth.includes('none');
  const pending = mutations.createMcpConnector.isPending;
  const submit = () => {
    if (!live) return onClose();
    const body: CreateMcpConnectorBody = {
      kind: 'catalog',
      catalogId: entry.id,
      slug: entry.id,
      ...(token !== '' ? { token } : {}),
    };
    setProblem(null);
    mutations.createMcpConnector.mutate(body, {
      onSuccess: (record) => {
        const message = connectorProblem(t, record);
        if (message === null) onConnected(record);
        else setProblem(message);
      },
      onError: (error) => setProblem(submitError(t, error)),
    });
  };
  return (
    <DialogShell
      title={t('连接 {name}', { name: entry.name })}
      subtitle={t(entry.description)}
      size="s"
      onClose={onClose}
      footer={
        <DialogFoot
          primary={{
            label: pending ? t('正在连接…') : t('连接'),
            onClick: submit,
            disabled: pending || (tokenRequired && token === ''),
          }}
          onCancel={onClose}
        />
      }
    >
      <FormStack className={DIALOG_FORM_CLS}>
        <TokenField entry={entry} value={token} onChange={setToken} required={tokenRequired} />
        <DialogError message={problem} />
      </FormStack>
    </DialogShell>
  );
}

interface HeaderDraft {
  name: string;
  value: string;
}

function CustomServerDialog({
  live,
  teamId,
  onClose,
  onConnected,
  onSignIn,
}: {
  live: boolean;
  teamId: string | undefined;
  onClose: () => void;
  onConnected: (record: McpConnectorRecord) => void;
  onSignIn: (request: McpOAuthRequest) => void;
}) {
  const { t } = useI18n();
  const mutations = useApiMutations(teamId);
  const [label, setLabel] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [url, setUrl] = useState('');
  const [headers, setHeaders] = useState<HeaderDraft[]>([{ name: 'Authorization', value: '' }]);
  const [problem, setProblem] = useState<string | null>(null);
  const pending = mutations.createMcpConnector.isPending;
  const filled = headers.filter((header) => header.name.trim() !== '' && header.value !== '');
  const valid = label.trim() !== '' && SLUG_RE.test(slug) && url.startsWith('https://');
  const setHeader = (index: number, patch: Partial<HeaderDraft>) =>
    setHeaders((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const submit = () => {
    if (!live) return onClose();
    setProblem(null);
    mutations.createMcpConnector.mutate(
      {
        kind: 'custom',
        slug,
        label: label.trim(),
        url: url.trim(),
        ...(filled.length > 0
          ? { headers: Object.fromEntries(filled.map((h) => [h.name.trim(), h.value])) }
          : {}),
      },
      {
        onSuccess: (record) => {
          const message = connectorProblem(t, record);
          if (message === null) onConnected(record);
          else setProblem(message);
        },
        onError: (error) => setProblem(submitError(t, error)),
      },
    );
  };
  return (
    <DialogShell
      title={t('添加 MCP 服务器')}
      subtitle={t('任何支持远程 MCP 的服务器都可以加进来。')}
      size="m"
      onClose={onClose}
      footer={
        <DialogFoot
          primary={{
            label: pending ? t('正在连接…') : t('添加'),
            onClick: submit,
            disabled: pending || !valid,
          }}
          secondary={{
            label: t('用浏览器登录'),
            onClick: () => onSignIn({ kind: 'custom', slug, label: label.trim(), url: url.trim() }),
            disabled: pending || !valid || filled.length > 0,
          }}
          onCancel={onClose}
        />
      }
    >
      <FormStack className={DIALOG_FORM_CLS}>
        <FormField label={t('名称')} htmlFor="mcp-label">
          <Input
            id="mcp-label"
            className={FIELD_CLS}
            value={label}
            placeholder={t('例如：团队知识库')}
            onChange={(event) => {
              setLabel(event.target.value);
              if (!slugTouched) setSlug(slugOf(event.target.value));
            }}
          />
        </FormField>
        <FormField
          label={t('标识')}
          htmlFor="mcp-slug"
          help={t('Agent 用这个名字调用它。只能用小写字母、数字和连字符（-）。')}
        >
          <Input
            id="mcp-slug"
            className={FIELD_CLS}
            value={slug}
            placeholder={t('例如：team-wiki')}
            onChange={(event) => {
              setSlugTouched(true);
              setSlug(event.target.value);
            }}
          />
        </FormField>
        <FormField
          label={t('地址')}
          htmlFor="mcp-url"
          help={t('必须以 https:// 开头。支持浏览器登录的服务器不用填请求头。')}
        >
          <Input
            id="mcp-url"
            className={FIELD_CLS}
            value={url}
            placeholder={t('例如：https://example.com/mcp')}
            onChange={(event) => setUrl(event.target.value)}
          />
        </FormField>
        <FormField
          label={t('请求头（可选）')}
          htmlFor="mcp-header-name-0"
          help={t('值加密保存在本机，保存后看不到原文。')}
        >
          <div className="flex flex-col gap-2">
            {headers.map((header, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  id={`mcp-header-name-${index}`}
                  aria-label={t('请求头名称')}
                  className={cn(FIELD_CLS, 'w-32 flex-none sm:w-40')}
                  value={header.name}
                  placeholder="Authorization"
                  onChange={(event) => setHeader(index, { name: event.target.value })}
                />
                <Input
                  aria-label={t('请求头的值')}
                  type="password"
                  autoComplete="off"
                  className={cn(FIELD_CLS, 'min-w-0 flex-1')}
                  value={header.value}
                  placeholder="Bearer …"
                  onChange={(event) => setHeader(index, { value: event.target.value })}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('删除这个请求头')}
                  title={t('删除这个请求头')}
                  onClick={() => setHeaders((rows) => rows.filter((_, i) => i !== index))}
                >
                  <X aria-hidden />
                </Button>
              </div>
            ))}
            <Button
              variant="ghost"
              size="sm"
              className={`${DIALOG_TEXT_BUTTON} self-start`}
              onClick={() => setHeaders((rows) => [...rows, { name: '', value: '' }])}
            >
              <Plus aria-hidden />
              {t('添加请求头')}
            </Button>
          </div>
        </FormField>
        <DialogError message={problem} />
      </FormStack>
    </DialogShell>
  );
}

function ManageConnectorDialog({
  connector,
  live,
  teamId,
  grants,
  onClose,
  onSignIn,
}: {
  connector: McpConnectorRecord;
  live: boolean;
  teamId: string | undefined;
  grants: McpGrants;
  onClose: () => void;
  onSignIn: (request: McpOAuthRequest) => void;
}) {
  const { t } = useI18n();
  const mutations = useApiMutations(teamId);
  const entry = connector.catalogId !== null ? mcpCatalogEntry(connector.catalogId) : undefined;
  const [token, setToken] = useState('');
  const [current, setCurrent] = useState(connector);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const primaryRef = useRef<HTMLButtonElement>(null);

  const oauth = current.authKind === 'oauth';
  const needsAuth = oauth && current.status === 'needs_auth';
  const pending =
    mutations.patchMcpConnector.isPending ||
    mutations.checkMcpConnector.isPending ||
    mutations.deleteMcpConnector.isPending;
  const after = {
    onSuccess: (record: McpConnectorRecord) => {
      setCurrent(record);
      setToken('');
    },
    onError: (error: unknown) => setSaveError(submitError(t, error)),
  };
  const recheckOrSave = () => {
    if (!live) return onClose();
    setSaveError(null);
    if (token !== '')
      mutations.patchMcpConnector.mutate({ id: current.id, body: { token } }, after);
    else mutations.checkMcpConnector.mutate(current.id, after);
  };
  const remove = () => {
    setConfirmDelete(false);
    if (!live) return onClose();
    mutations.deleteMcpConnector.mutate(current.id, {
      onSuccess: onClose,
      onError: (error) => setSaveError(submitError(t, error)),
    });
  };
  const recheck = {
    label: token !== '' ? t('保存并检查') : t('重新检查'),
    onClick: recheckOrSave,
    disabled: pending,
  };
  const reconnect = {
    label: t('重新连接'),
    onClick: () => onSignIn({ kind: 'reconnect', connector: current }),
    disabled: pending,
  };
  if (confirmDelete)
    return (
      <DeleteConfirm
        open
        title={t('确定删除这个连接？此操作不可撤销。')}
        summary={t('{name}：删除后 Agent 不能再用它的工具。', { name: current.label })}
        ariaLabel={t('删除连接')}
        onClose={() => setConfirmDelete(false)}
        onConfirm={remove}
      />
    );
  return (
    <DialogShell
      title={current.label}
      subtitle={<ConnectorStatus record={current} />}
      size="s"
      initialFocus={primaryRef}
      onClose={onClose}
      footer={
        <DialogFoot
          primaryRef={primaryRef}
          primary={needsAuth ? reconnect : recheck}
          onCancel={onClose}
          cancelLabel={t('关闭')}
          danger={{ label: t('删除'), onClick: () => setConfirmDelete(true), disabled: pending }}
          {...(oauth ? { secondary: needsAuth ? recheck : reconnect } : {})}
        />
      }
    >
      <FormStack className={DIALOG_FORM_CLS}>
        {!needsAuth && <DialogError message={connectorProblem(t, current)} />}
        <Field>
          <span className="text-ui font-medium text-foreground">{t('地址')}</span>
          <p className={VALUE_BOX_CLS}>{current.url}</p>
        </Field>
        {oauth && (
          <p className="m-0 text-meta text-content-tertiary">
            {t(
              '用浏览器登录连接。删除只移除本机保存的令牌，{name} 那边的授权要在它的设置里撤销。',
              {
                name: current.label,
              },
            )}
          </p>
        )}
        {!oauth && entry?.auth.includes('token') && (
          <TokenField
            entry={
              current.authKind === 'none'
                ? entry
                : {
                    ...entry,
                    tokenLabel: t('换一个{label}', { label: t(entry.tokenLabel ?? '令牌') }),
                  }
            }
            value={token}
            onChange={setToken}
            required={current.authKind !== 'none'}
          />
        )}
        <Field>
          <span className="text-ui font-medium text-foreground">{t('哪些工作可以用')}</span>
          <McpGrantSection slug={current.slug} name={current.label} grants={grants} />
        </Field>
        <DialogError message={saveError} />
      </FormStack>
    </DialogShell>
  );
}

export function ConnectorStatus({ record, grant }: { record: McpConnectorRecord; grant?: string }) {
  const { t } = useI18n();
  if (record.status === 'connected')
    return (
      <span className="inline-flex items-center gap-1.5 text-meta text-content-secondary">
        <span aria-hidden className="size-1.5 flex-none rounded-full bg-running" />
        <span>
          {record.toolCount !== null
            ? t('已连接 · {n} 个工具', { n: record.toolCount })
            : t('已连接')}
          {grant !== undefined && (
            <>
              {' · '}
              <span data-testid="mcp-grant-summary">{grant}</span>
            </>
          )}
        </span>
      </span>
    );
  if (record.status === 'needs_auth')
    return (
      <span className="inline-flex items-center gap-1.5 text-meta text-foreground">
        <span aria-hidden className="size-1.5 flex-none rounded-full bg-(--card-button)" />
        {t('需要重新授权')}
      </span>
    );
  if (record.status === 'error')
    return (
      <span className="inline-flex items-center gap-1.5 text-meta text-destructive">
        <span aria-hidden className="size-1.5 flex-none rounded-full bg-destructive" />
        {t('连不上')}
      </span>
    );
  return <span className="text-meta text-content-tertiary">{t('还没检查')}</span>;
}

export function McpSignInDialog({
  signIn,
  onLeave,
  onClose,
  onUseToken,
}: {
  signIn: McpSignIn;
  onLeave: () => void;
  onClose: () => void;
  onUseToken: (entry: McpCatalogEntry) => void;
}) {
  const { t } = useI18n();
  const { entry } = signIn;
  return (
    <DialogShell
      title={t('前往 {host} 登录', { host: signIn.host })}
      subtitle={t('连接 {name}', { name: signIn.name })}
      size="s"
      onClose={onClose}
      footer={
        <DialogFoot
          primary={{
            label: t('前往登录'),
            onClick: () => {
              onLeave();
              window.location.assign(signIn.authorizationUrl);
            },
          }}
          onCancel={onClose}
          {...(entry?.auth.includes('token')
            ? { secondary: { label: t('改用令牌'), onClick: () => onUseToken(entry) } }
            : {})}
        />
      }
    >
      <FormStack className={DIALOG_FORM_CLS}>
        <p className="m-0 text-ui text-foreground">{t('登录并授权后会自动回到这里。')}</p>
        <p data-testid="mcp-signin-host" className={VALUE_BOX_CLS}>
          {signIn.host}
        </p>
        <p className="m-0 text-meta text-content-tertiary">
          {t('先确认这个网址属于 {name}，不认识就取消。', { name: signIn.name })}
        </p>
      </FormStack>
    </DialogShell>
  );
}

export function McpGrantSheet({
  connector,
  grants,
  onClose,
}: {
  connector: McpConnectorRecord;
  grants: McpGrants;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <DialogShell
      title={t('哪些工作可以用 {name}', { name: connector.label })}
      subtitle={<ConnectorStatus record={connector} />}
      size="s"
      onClose={onClose}
      footer={
        <div className="flex w-full justify-end">
          <Button className={DIALOG_PRIMARY_BUTTON} onClick={onClose}>
            {t('完成')}
          </Button>
        </div>
      }
    >
      <FormStack className={DIALOG_FORM_CLS}>
        <McpGrantSection slug={connector.slug} name={connector.label} grants={grants} grantTasks />
      </FormStack>
    </DialogShell>
  );
}
