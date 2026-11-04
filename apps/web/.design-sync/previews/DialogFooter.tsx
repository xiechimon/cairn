import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@cairn/web';

export const Actions = () => (
  <Dialog open>
    <DialogContent showCloseButton={false}>
      <DialogHeader>
        <DialogTitle>Retry build #318?</DialogTitle>
        <DialogDescription>The failed typecheck step reruns on the same worktree.</DialogDescription>
      </DialogHeader>
      <DialogFooter showCloseButton>
        <Button>Retry build</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
