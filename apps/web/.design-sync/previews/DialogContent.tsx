import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@cairn/web';

export const WithCloseButton = () => (
  <Dialog open>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Rename project</DialogTitle>
        <DialogDescription>The project slug stays cairn; only the display name changes.</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="ghost">Cancel</Button>
        <Button>Save</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
