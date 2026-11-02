import type { CreateClaudeSubscription } from '@cairn/shared';
import { useState } from 'react';
import { FORM_CONTROL_CLS, FormActions, FormField, FormStack } from '../components/form-layout.js';
import { DialogShell } from '../components/ui/dialog-shell.js';
import { Input } from '../components/ui/input.js';

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
