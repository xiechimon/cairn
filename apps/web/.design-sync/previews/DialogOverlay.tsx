import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@cairn/web';

export const Backdrop = () => (
  <div style={{ padding: 16 }}>
    <p style={{ margin: 0 }}>Task #104 · Add dark mode toggle · Implementer is running e2e</p>
    <Dialog open>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Stop task #104?</DialogTitle>
          <DialogDescription>The page behind is dimmed and blurred by the overlay.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost">Keep running</Button>
          <Button variant="destructive">Stop task</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
);
