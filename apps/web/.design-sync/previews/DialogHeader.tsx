import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@cairn/web';

export const TitleAndDescription = () => (
  <Dialog open>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Merge PR #2156?</DialogTitle>
        <DialogDescription>
          Review passed and CI is green. The branch is squashed into main and task #104 moves to Merged.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="ghost">Not yet</Button>
        <Button>Merge</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
