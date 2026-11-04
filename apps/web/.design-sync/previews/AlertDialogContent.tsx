import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@cairn/web';

export const SmallSize = () => (
  <AlertDialog open>
    <AlertDialogContent size="sm">
      <AlertDialogHeader>
        <AlertDialogTitle>Archive task #104?</AlertDialogTitle>
        <AlertDialogDescription>Archived tasks leave the board but keep their transcript.</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction>Archive</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);
