import { Button, DialogFootRow } from '@cairn/web';

export const WithHint = () => (
  <div style={{ width: 480 }}>
    <DialogFootRow hint={<span>Press Enter to create</span>}>
      <Button variant="ghost">Cancel</Button>
      <Button>Create task</Button>
    </DialogFootRow>
  </div>
);

export const ActionsOnly = () => (
  <div style={{ width: 480 }}>
    <DialogFootRow>
      <Button variant="ghost">Keep running</Button>
      <Button variant="destructive">Stop task</Button>
    </DialogFootRow>
  </div>
);
