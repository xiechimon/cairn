import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  StatusChip,
} from '@cairn/web';

const TaskCard = ({ size }: { size?: 'default' | 'sm' }) => (
  <div style={{ width: 320 }}>
    <Card size={size}>
      <CardHeader>
        <CardTitle>Task #104 · Gate machine enroll</CardTitle>
        <CardDescription>cairn · Implementer on omarchy</CardDescription>
        <CardAction>
          <StatusChip tone="confirm">Needs review</StatusChip>
        </CardAction>
      </CardHeader>
      <CardContent>
        PR #2153 is open with 4 files changed. Verifier passed 12 of 12 checks; one reviewer note is waiting for a reply.
      </CardContent>
      <CardFooter style={{ justifyContent: 'flex-end', gap: 8 }}>
        <Button variant="ghost" size="sm">Open PR</Button>
        <Button size="sm">Merge</Button>
      </CardFooter>
    </Card>
  </div>
);

export const Default = () => <TaskCard />;

export const Small = () => <TaskCard size="sm" />;
