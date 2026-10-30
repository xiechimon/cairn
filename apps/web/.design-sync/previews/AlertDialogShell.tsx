import { AlertDialogActions, AlertDialogShell } from '@cairn/web';

const noop = () => {};

export const DeleteProject = () => (
  <AlertDialogShell
    open
    onClose={noop}
    title="Delete project cairn-docs?"
    ariaLabel="Delete project"
    subtitle="12 tasks and 41 builds are removed."
    footer={<AlertDialogActions cancelLabel="Cancel" confirmLabel="Delete project" onCancel={noop} onConfirm={noop} />}
  >
    <p style={{ fontSize: 14 }}>Linked GitHub PRs stay open; the worktrees on omarchy are cleaned up.</p>
  </AlertDialogShell>
);
