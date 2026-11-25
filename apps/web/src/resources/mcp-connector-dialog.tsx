import {
  type CreateMcpConnectorBody,
  isLocalCatalogEntry,
  type McpCatalogEntry,
  type McpConnectorRecord,
  mcpCatalogEntry,
} from '@cairn/shared';
import { cn } from 'cn';
import { Plus, X } from 'lucide-react';
import { type MouseEvent, type Ref, useRef, useState } from 'react';
import { ApiError } from '../api/client.js';
import { useApiMutations } from '../api/hooks.js';
import { relativeTime } from '../board/rel-time.js';
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
import { DeleteConfirm } from '../overlay/delete-confirm.js';
import { CheckResultPopover } from './provider-editors.js';

export const PALE_DISABLED =
  'disabled:bg-secondary/50 disabled:text-content-dim disabled:opacity-100';

const FIELD_CLS = cn(FORM_CONTROL_CLS, 'placeholder:text-content-tertiary');

export const DIALOG_FORM_CLS = 'max-w-none text-balance [word-break:keep-all]';

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
  if (record.status === 'connected' || record.status === 'unchecked' || record.status === 'local')
    return null;
  const name = record.label;
  switch (record.statusReason) {
    case 'unauthorized':
      return t('{name} 拒绝了这个令牌。检查令牌是否填对、有没有过期，然后换一个新的。', { name });
    case 'forbidden':
      return record.authKind === 'github-app'
        ? t('GitHub 拒绝了访问。组织可能要求先做 SSO 授权，或等管理员批准 Cairn 应用。')
        : t('令牌有效，但权限不够。给令牌加上需要的权限后重新连接。');
    case 'timeout':
      return t('{name} 10 秒内没有响应。稍后重新连接。', { name });
    case 'unreachable':
      return t('无法连接这个地址。请检查地址是否正确、服务器是否在线。');
    case 'reconnect':
    case 'expired':
      return t('{name} 的授权已失效，重新连接一次。', { name });
    case 'refresh_rejected':
      return t('{name} 收回了这次授权，重新连接一次。', { name });
    case 'refresh_failed':
      return t('刷新 {name} 的授权时出错，稍后重新连接。', { name });
    default:
      return t('{name} 返回了错误。稍后重新连接。', { name });
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
    return t('有字段格式有误。地址需以 https:// 开头，标识只能使用小写字母、数字和连字符（-）。');
  return t('未能保存，请稍后重试。');
}

interface McpConnectorDialogProps {
  target: McpDialogTarget | null;
  live: boolean;
  teamId: string | undefined;
  onClose: () => void;
  onSignIn: (request: McpOAuthRequest) => void;
}

export function McpConnectorDialog({
  target,
  live,
  teamId,
  onClose,
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
      />
    );
  if (target.kind === 'custom')
    return (
      <CustomServerDialog
        key={key}
        live={live}
        teamId={teamId}
        onClose={onClose}
        onSignIn={onSignIn}
      />
    );
  return (
    <ManageConnectorDialog
      key={key}
      connector={target.connector}
      live={live}
      teamId={teamId}
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
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
}

function DialogFoot({
  primary,
  onCancel,
  danger,
  secondary,
  primaryRef,
  hideCancel,
}: {
  primary: FootAction;
  primaryRef?: Ref<HTMLButtonElement>;
  onCancel: () => void;
  danger?: FootAction;
  secondary?: FootAction;
  hideCancel?: boolean;
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
      {hideCancel !== true && (
        <Button variant="ghost" className={DIALOG_TEXT_BUTTON} onClick={onCancel}>
          {t('取消')}
        </Button>
      )}
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

function SetupSteps({ entry }: { entry: McpCatalogEntry }) {
  const { t } = useI18n();
  if (entry.setup === undefined) return null;
  return (
    <>
      <Field>
        <a
          href={entry.setup.installUrl}
          target="_blank"
          rel="noreferrer"
          className="self-start text-ui text-foreground underline underline-offset-2"
        >
          {t(entry.setup.installLabel)}
        </a>
      </Field>
      <Field>
        <span className="text-ui font-medium text-foreground">{t('两步用起来')}</span>
        <ol className="m-0 flex list-decimal flex-col gap-2 pl-5 text-meta text-content-secondary">
          {entry.setup.steps.map((step) => (
            <li key={step}>{t(step)}</li>
          ))}
        </ol>
      </Field>
    </>
  );
}

function CatalogConnectDialog({
  entry,
  live,
  teamId,
  onClose,
}: {
  entry: McpCatalogEntry;
  live: boolean;
  teamId: string | undefined;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const mutations = useApiMutations(teamId);
  const [token, setToken] = useState('');
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const local = isLocalCatalogEntry(entry);
  const tokenRequired = !entry.auth.includes('none');
  const pending =
    mutations.createMcpConnector.isPending ||
    mutations.patchMcpConnector.isPending ||
    mutations.checkMcpConnector.isPending;
  const submit = () => {
    if (!live) return onClose();
    const callbacks = {
      onSuccess: (record: McpConnectorRecord) => {
        setCreatedId(record.id);
        const message = connectorProblem(t, record);
        if (message === null) onClose();
        else setProblem(message);
      },
      onError: (error: unknown) => setProblem(submitError(t, error)),
    };
    setProblem(null);
    if (createdId !== null) {
      if (token !== '') {
        mutations.patchMcpConnector.mutate({ id: createdId, body: { token } }, callbacks);
      } else {
        mutations.checkMcpConnector.mutate(createdId, callbacks);
      }
      return;
    }
    const body: CreateMcpConnectorBody = {
      kind: 'catalog',
      catalogId: entry.id,
      slug: entry.id,
      ...(token !== '' ? { token } : {}),
    };
    mutations.createMcpConnector.mutate(body, callbacks);
  };
  if (local)
    return (
      <DialogShell
        title={t('连接 {name}', { name: entry.name })}
        subtitle={t(entry.description)}
        info={t(
          'Chrome 未打开、扩展未连接或被暂停时，Coordinator 会改用其他可用浏览器，并在结果里说明原因。',
        )}
        size="s"
        onClose={onClose}
        footer={
          <DialogFoot
            primary={{
              label: pending ? t('正在启用…') : t('启用'),
              onClick: submit,
              disabled: pending,
            }}
            onCancel={onClose}
          />
        }
      >
        <FormStack className={DIALOG_FORM_CLS}>
          <SetupSteps entry={entry} />
          <DialogError message={problem} />
        </FormStack>
      </DialogShell>
    );
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
  onSignIn,
}: {
  live: boolean;
  teamId: string | undefined;
  onClose: () => void;
  onSignIn: (request: McpOAuthRequest) => void;
}) {
  const { t } = useI18n();
  const mutations = useApiMutations(teamId);
  const [label, setLabel] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [url, setUrl] = useState('');
  const [headers, setHeaders] = useState<HeaderDraft[]>([{ name: 'Authorization', value: '' }]);
  const [created, setCreated] = useState<McpConnectorRecord | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const pending = mutations.createMcpConnector.isPending || mutations.patchMcpConnector.isPending;
  const filled = headers.filter((header) => header.name.trim() !== '' && header.value !== '');
  const valid = label.trim() !== '' && SLUG_RE.test(slug) && url.startsWith('https://');
  const setHeader = (index: number, patch: Partial<HeaderDraft>) =>
    setHeaders((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const submit = () => {
    if (!live) return onClose();
    const callbacks = {
      onSuccess: (record: McpConnectorRecord) => {
        setCreated(record);
        const message = connectorProblem(t, record);
        if (message === null) onClose();
        else setProblem(message);
      },
      onError: (error: unknown) => setProblem(submitError(t, error)),
    };
    const headerPayload =
      filled.length > 0
        ? { headers: Object.fromEntries(filled.map((h) => [h.name.trim(), h.value])) }
        : {};
    setProblem(null);
    if (created !== null) {
      mutations.patchMcpConnector.mutate(
        {
          id: created.id,
          body: {
            label: label.trim(),
            url: url.trim(),
            ...headerPayload,
          },
        },
        callbacks,
      );
      return;
    }
    mutations.createMcpConnector.mutate(
      {
        kind: 'custom',
        slug,
        label: label.trim(),
        url: url.trim(),
        ...headerPayload,
      },
      callbacks,
    );
  };
  return (
    <DialogShell
      title={t('添加 MCP 服务器')}
      info={t('任何支持远程 MCP 的服务器都可以加进来。')}
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
            onClick: () =>
              onSignIn(
                created !== null
                  ? { kind: 'reconnect', connector: created }
                  : { kind: 'custom', slug, label: label.trim(), url: url.trim() },
              ),
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
              if (!slugTouched && created === null) setSlug(slugOf(event.target.value));
            }}
          />
        </FormField>
        <FormField
          label={t('标识')}
          htmlFor="mcp-slug"
          help={t('执行任务时用这个名字调用它。只能用小写字母、数字和连字符（-）。')}
        >
          <Input
            id="mcp-slug"
            className={FIELD_CLS}
            value={slug}
            disabled={created !== null}
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
  onClose,
  onSignIn,
}: {
  connector: McpConnectorRecord;
  live: boolean;
  teamId: string | undefined;
  onClose: () => void;
  onSignIn: (request: McpOAuthRequest) => void;
}) {
  const { t } = useI18n();
  const mutations = useApiMutations(teamId);
  const entry = connector.catalogId !== null ? mcpCatalogEntry(connector.catalogId) : undefined;
  const [token, setToken] = useState('');
  const [current, setCurrent] = useState(connector);
  const [url, setUrl] = useState(connector.url ?? '');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [report, setReport] = useState<RecheckReport | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const github = current.authKind === 'github-app';
  const oauth = current.authKind === 'oauth' || github;
  const local = current.transport === 'stdio';
  const needsAuth = oauth && current.status === 'needs_auth';
  const signInAgain = needsAuth || (oauth && SIGN_IN_REASONS.has(current.statusReason ?? ''));
  const healthy = current.status === 'connected' && connectorProblem(t, current) === null;
  const urlEditable = !local && !oauth && current.catalogId === null;
  const edit = {
    ...(token !== '' ? { token } : {}),
    ...(urlEditable && url.trim() !== (current.url ?? '') ? { url: url.trim() } : {}),
  };
  const dirty = Object.keys(edit).length > 0;
  const pending =
    mutations.patchMcpConnector.isPending ||
    mutations.checkMcpConnector.isPending ||
    mutations.deleteMcpConnector.isPending;
  const settle = (anchor: Element, failure: (error: unknown) => string | null) => ({
    onSuccess: (record: McpConnectorRecord) => {
      setCurrent(record);
      setToken('');
      setUrl(record.url ?? '');
      setReport({ phase: 'done', record, anchor, open: true });
    },
    onError: (error: unknown) =>
      setReport({ phase: 'unfinished', message: failure(error), anchor, open: true }),
  });
  const save = (event: MouseEvent<HTMLButtonElement>) => {
    if (!live) return onClose();
    const anchor = event.currentTarget;
    setSaveError(null);
    setReport({ phase: 'checking', anchor, open: true });
    mutations.patchMcpConnector.mutate(
      { id: current.id, body: edit },
      settle(anchor, (error) => submitError(t, error)),
    );
  };
  const reconnectNow = (event: MouseEvent<HTMLButtonElement>) => {
    if (!live) return onClose();
    const anchor = event.currentTarget;
    setSaveError(null);
    setReport({ phase: 'checking', anchor, open: true });
    mutations.checkMcpConnector.mutate(
      current.id,
      settle(anchor, () => null),
    );
  };
  const closeReport = () => setReport((prev) => (prev === null ? null : { ...prev, open: false }));
  const showProblem = () =>
    setReport({ phase: 'done', record: current, anchor: primaryRef.current, open: true });
  const remove = () => {
    setConfirmDelete(false);
    if (!live) return onClose();
    mutations.deleteMcpConnector.mutate(current.id, {
      onSuccess: onClose,
      onError: (error) => setSaveError(submitError(t, error)),
    });
  };
  const signIn = {
    label: t('重新连接'),
    onClick: () => onSignIn({ kind: 'reconnect', connector: current }),
    disabled: pending,
  };
  const done = { label: t('完成'), onClick: onClose };
  const primary: FootAction = local
    ? { label: t('关闭'), onClick: onClose }
    : dirty
      ? { label: t('保存'), onClick: save, disabled: pending }
      : signInAgain
        ? signIn
        : !healthy
          ? { label: t('重新连接'), onClick: reconnectNow, disabled: pending }
          : done;
  const nothingToSave = local || (!dirty && healthy);
  if (confirmDelete)
    return (
      <DeleteConfirm
        open
        title={t('确定删除这个连接？此操作不可撤销。')}
        summary={t('{name}：删除后任务不能再用它的工具。', { name: current.label })}
        ariaLabel={t('删除连接')}
        onClose={() => setConfirmDelete(false)}
        onConfirm={remove}
      />
    );
  return (
    <DialogShell
      title={current.label}
      subtitle={
        current.status === 'error' && !local ? (
          <Button
            variant="ghost"
            aria-haspopup="dialog"
            aria-expanded={report?.open === true}
            onClick={showProblem}
            className="relative h-auto min-h-0 rounded-sm border-0 p-0 text-meta font-normal after:absolute aria-expanded:bg-transparent after:-inset-1 hover:bg-transparent focus-visible:ring-2 focus-visible:ring-(--focus-ring) dark:hover:bg-transparent pointer-coarse:after:-inset-3"
          >
            <ConnectorStatus record={current} />
          </Button>
        ) : (
          <ConnectorStatus record={current} />
        )
      }
      size="s"
      initialFocus={primaryRef}
      onClose={onClose}
      {...(report?.open === true
        ? {
            onEscapeWhileNested: () => {
              closeReport();
              if (report.anchor instanceof HTMLElement) report.anchor.focus();
            },
          }
        : {})}
      footer={
        <DialogFoot
          primaryRef={primaryRef}
          primary={primary}
          onCancel={onClose}
          hideCancel={nothingToSave}
          danger={{ label: t('删除'), onClick: () => setConfirmDelete(true), disabled: pending }}
          {...(oauth && healthy && !dirty ? { secondary: signIn } : {})}
        />
      }
    >
      <FormStack className={DIALOG_FORM_CLS}>
        {local && entry !== undefined ? (
          <>
            <SetupSteps entry={entry} />
            <p className="m-0 text-meta text-content-tertiary">
              {t('这个连接在你的电脑上启动，不用填地址，也不用令牌。')}
            </p>
          </>
        ) : urlEditable ? (
          <FormField label={t('地址')} htmlFor="mcp-manage-url">
            <Input
              id="mcp-manage-url"
              className={FIELD_CLS}
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
          </FormField>
        ) : (
          <Field>
            <span className="text-ui font-medium text-foreground">{t('地址')}</span>
            <p className={VALUE_BOX_CLS}>{current.url}</p>
          </Field>
        )}
        {github && (
          <p data-testid="mcp-github-delete-note" className="m-0 text-meta text-content-tertiary">
            <span className="block">{t('删除只移除 Cairn 里的连接。')}</span>
            <span className="block">{t('Cairn 发 PR 也靠这份授权，别去 GitHub 撤销。')}</span>
          </p>
        )}
        {oauth && !github && (
          <p className="m-0 text-meta text-content-tertiary">
            {t(
              '用浏览器登录连接。删除只移除本机保存的令牌，{name} 中的授权需要在它的设置里撤销。',
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
        <DialogError message={saveError} />
      </FormStack>
      {report !== null && (
        <RecheckResult name={current.label} report={report} onClose={closeReport} />
      )}
    </DialogShell>
  );
}

const SIGN_IN_REASONS = new Set(['reconnect', 'expired', 'refresh_rejected']);

type RecheckReport = { anchor: Element | null; open: boolean } & (
  | { phase: 'checking' }
  | { phase: 'done'; record: McpConnectorRecord }
  | { phase: 'unfinished'; message: string | null }
);

function RecheckResult({
  name,
  report,
  onClose,
}: {
  name: string;
  report: RecheckReport;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const record = report.phase === 'done' ? report.record : null;
  const problem = record === null ? null : connectorProblem(t, record);
  const ok = record?.status === 'connected' && problem === null;
  const sentence =
    report.phase === 'checking'
      ? t('正在检查 {name} 能不能连上…', { name })
      : ok
        ? t('{name} 回应了，能用。', { name })
        : (problem ??
          (report.phase === 'unfinished' ? report.message : null) ??
          t('未能完成检查，请稍后重试。'));
  const detail =
    record === null || (!ok && problem === null)
      ? null
      : [
          { label: t('检查内容'), value: 'tools/list', code: true },
          { label: t('时间'), value: relativeTime(record.checkedAt, Date.now(), t) },
        ];
  return (
    <CheckResultPopover
      anchor={report.anchor}
      open={report.open}
      onClose={onClose}
      tone={report.phase === 'checking' ? 'checking' : ok ? 'ok' : 'fail'}
      sentence={sentence}
      detail={detail}
      testId="mcp-recheck-result"
    />
  );
}

export function ConnectorStatus({ record }: { record: McpConnectorRecord }) {
  const { t } = useI18n();
  if (record.status === 'local')
    return (
      <span className="inline-flex items-center gap-1.5 text-meta text-content-secondary">
        <span aria-hidden className="size-1.5 flex-none rounded-full bg-running" />
        {t('在你的 Chrome 里')}
      </span>
    );
  if (record.status === 'connected')
    return (
      <span className="inline-flex items-center gap-1.5 text-meta text-content-secondary">
        <span aria-hidden className="size-1.5 flex-none rounded-full bg-running" />
        {record.account !== null && record.toolCount !== null
          ? t('已连接 · @{login} · {n} 个工具', { login: record.account, n: record.toolCount })
          : record.toolCount !== null
            ? t('已连接 · {n} 个工具', { n: record.toolCount })
            : t('已连接')}
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
        {t('无法连接')}
      </span>
    );
  return <span className="text-meta text-content-tertiary">{t('未检查')}</span>;
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
