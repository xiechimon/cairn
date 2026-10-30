import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@cairn/web';

export const WithMedia = () => (
  <AlertDialog open>
    <AlertDialogContent size="sm">
      <AlertDialogHeader>
        <AlertDialogMedia>!</AlertDialogMedia>
        <AlertDialogTitle>Remove agent Reviewer?</AlertDialogTitle>
        <AlertDialogDescription>Tasks assigned to Reviewer fall back to the default agent.</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction variant="destructive">Remove</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);
