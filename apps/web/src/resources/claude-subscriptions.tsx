import type { ClaudeSubscription, CreateClaudeSubscription } from '@cairn/shared';
import { useState } from 'react';
import { useDeleteClaudeSubscription } from '../api/claude-subscriptions.js';
import { api } from '../api/client.js';
import { FORM_CONTROL_CLS, FormActions, FormField, FormStack } from '../components/form-layout.js';
import { AlertDialogActions, AlertDialogShell } from '../components/ui/alert-dialog-shell.js';
import { Button } from '../components/ui/button.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import { Input } from '../components/ui/input.js';
import { useI18n } from '../i18n/provider.js';
import { ResourceList, ResourceRow, RowText, RowTitle } from './parts.js';

export function ClaudeSubscriptionRow({
  connection,
  teamId,
}: {
  connection: ClaudeSubscription;
  teamId: string | undefined;
}) {
  const { t } = useI18n();
  const deletion = useDeleteClaudeSubscription(teamId);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [status, setStatus] = useState('');
  const [pending, setPending] = useState(false);
  const verify = async () => {
    setPending(true);
    setStatus('');
    try {
      const result = await api.post<{ ok: boolean }>(
        `/api/teams/${teamId}/claude-subscriptions/${connection.id}/verify`,
      );
      setStatus(result.ok ? 'Verified' : 'Verification failed');
    } catch {
      setStatus('Verification failed');
    } finally {
      setPending(false);
    }
  };
  return (
    <ResourceList className="mt-3">
      <ResourceRow data-connection-kind="claude-subscription">
        <RowText>
          <RowTitle>{connection.label}</RowTitle>
          {connection.expiresAt !== null && (
            <span className="text-meta text-content-tertiary">
              {new Date(connection.expiresAt).toLocaleDateString()}
            </span>
          )}
        </RowText>
        <span role="status">{status}</span>
        <Button
          data-testid="verify-claude-subscription"
          variant="ghost"
          disabled={pending || deletion.isPending}
          onClick={() => void verify()}
        >
          Verify
        </Button>
        <Button
          data-testid="delete-claude-subscription"
          variant="ghost"
          disabled={pending || deletion.isPending}
          onClick={() => {
            deletion.reset();
            setDeleteOpen(true);
          }}
        >
          {t('删除 Claude 订阅连接')}
        </Button>
        {deletion.isError && <p role="alert">{t('删除 Claude 订阅连接失败，请重试。')}</p>}
        <AlertDialogShell
          title={t('删除 Claude 订阅连接？')}
          ariaLabel={t('删除 Claude 订阅连接')}
          open={deleteOpen}
          onClose={() => setDeleteOpen(false)}
          footer={
            <AlertDialogActions
              cancelLabel={t('取消')}
              confirmLabel={t('删除')}
              confirmDisabled={deletion.isPending}
              onCancel={() => setDeleteOpen(false)}
              onConfirm={() => {
                setDeleteOpen(false);
                deletion.mutate(connection.id);
              }}
            />
          }
        >
          <p>{t('删除「{name}」后，后续步骤将无法使用此连接。', { name: connection.label })}</p>
        </AlertDialogShell>
      </ResourceRow>
    </ResourceList>
  );
}

export function AddClaudeSubscriptionDialog({
  onClose,
  onCreate,
  pending,
  error,
}: {
  onClose: () => void;
  onCreate: (body: CreateClaudeSubscription) => void;
  pending: boolean;
  error: boolean;
}) {
  const [label, setLabel] = useState('Claude subscription');
  const [token, setToken] = useState('');
  const [expiry, setExpiry] = useState('');
  const expiresAt = expiry === '' ? null : new Date(expiry).getTime();
  return (
    <DialogShell
      title="Add Claude subscription"
      open
      onClose={onClose}
      size="s"
      footer={
        <FormActions
          className="pt-0"
          primary={{
            label: 'Save',
            disabled:
              pending ||
              !label.trim() ||
              !token.trim() ||
              (expiresAt !== null && !Number.isFinite(expiresAt)),
            onClick: () => onCreate({ label: label.trim(), token: token.trim(), expiresAt }),
          }}
          secondary={{ label: 'Cancel', onClick: onClose }}
        />
      }
    >
      <FormStack className="max-w-none">
        <p>
          Run <code>claude setup-token</code> on your machine, then paste the token below.
        </p>
        <p>
          Claude Code steps use the most recently added unexpired connection. Tokens are encrypted
          and cannot be viewed after saving.
        </p>
        <FormField label="Name" htmlFor="subscription-label">
          <Input
            className={FORM_CONTROL_CLS}
            id="subscription-label"
            data-testid="subscription-label"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
        </FormField>
        <FormField label="Token" htmlFor="subscription-token">
          <Input
            className={FORM_CONTROL_CLS}
            id="subscription-token"
            data-testid="subscription-token"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
        </FormField>
        <FormField label="Expires on (optional)" htmlFor="subscription-expiry">
          <Input
            className={FORM_CONTROL_CLS}
            id="subscription-expiry"
            type="date"
            value={expiry}
            onChange={(event) => setExpiry(event.target.value)}
          />
        </FormField>
        {error && (
          <p role="alert">Could not save the connection. Check the fields and try again.</p>
        )}
      </FormStack>
    </DialogShell>
  );
}
