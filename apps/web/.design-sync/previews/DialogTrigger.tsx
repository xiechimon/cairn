import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@cairn/web';

export const Trigger = () => (
  <Dialog>
    <DialogTrigger render={<Button variant="outline" />}>Stop task</DialogTrigger>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Stop task #104?</DialogTitle>
        <DialogDescription>The running step is cancelled.</DialogDescription>
      </DialogHeader>
    </DialogContent>
  </Dialog>
);

export const DestructiveTrigger = () => (
  <Dialog>
    <DialogTrigger render={<Button variant="destructive" />}>Delete project</DialogTrigger>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Delete project cairn?</DialogTitle>
      </DialogHeader>
    </DialogContent>
  </Dialog>
);
