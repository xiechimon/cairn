import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@cairn/web';

export const Open = () => (
  <Dialog open>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Stop task #104?</DialogTitle>
        <DialogDescription>
          The running step is cancelled. Uncommitted changes in the worktree are kept so you can resume later.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="ghost">Keep running</Button>
        <Button variant="destructive">Stop task</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
