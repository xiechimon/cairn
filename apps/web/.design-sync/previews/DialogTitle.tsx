import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@cairn/web';

export const Title = () => (
  <Dialog open>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Delete agent Implementer?</DialogTitle>
        <DialogDescription>Its 3 queued steps return to the backlog.</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="ghost">Cancel</Button>
        <Button variant="destructive">Delete agent</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
