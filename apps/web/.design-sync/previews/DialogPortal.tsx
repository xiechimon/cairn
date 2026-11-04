import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@cairn/web';

export const Portaled = () => (
  <Dialog open>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Archive project cairn?</DialogTitle>
        <DialogDescription>Schedules pause and open tasks stay readable.</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="ghost">Cancel</Button>
        <Button>Archive</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
