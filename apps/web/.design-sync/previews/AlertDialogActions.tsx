import { AlertDialogActions, AlertDialogShell } from '@cairn/web';

const noop = () => {};

export const Actions = () => (
  <AlertDialogShell
    open
    onClose={noop}
    title="Revoke API key ci-runner?"
    ariaLabel="Revoke API key"
    footer={<AlertDialogActions cancelLabel="Keep key" confirmLabel="Revoke key" onCancel={noop} onConfirm={noop} />}
  >
    <p style={{ fontSize: 14 }}>Machines using this key lose access immediately.</p>
  </AlertDialogShell>
);
