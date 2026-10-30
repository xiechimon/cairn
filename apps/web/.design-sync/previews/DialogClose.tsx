import { Button, Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@cairn/web';

export const CloseAction = () => (
  <Dialog open>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>API key created</DialogTitle>
        <DialogDescription>Copy the key for the cairn daemon now; it is shown only once.</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>Done</DialogClose>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
