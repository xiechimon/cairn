import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@cairn/web';

export const Description = () => (
  <Dialog open>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Evacuate machine omarchy</DialogTitle>
        <DialogDescription>
          Agents on omarchy move to xmonsMac. Running builds finish first; new steps are dispatched to the target machine.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="ghost">Cancel</Button>
        <Button>Evacuate</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
