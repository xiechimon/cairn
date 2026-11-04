import { Button, Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@cairn/web';
import { FolderGit2, Inbox } from 'lucide-react';

const NoTasks = () => (
  <div style={{ width: 420 }}>
    <Empty style={{ border: '1px dashed var(--border)' }}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Inbox />
        </EmptyMedia>
        <EmptyTitle>No tasks yet</EmptyTitle>
        <EmptyDescription>
          Describe what you want built in cairn and the implementer picks it up on the next free machine.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button>New task</Button>
      </EmptyContent>
    </Empty>
  </div>
);

const NoProjects = () => (
  <div style={{ width: 420 }}>
    <Empty>
      <EmptyHeader>
        <EmptyMedia>
          <FolderGit2 size={32} />
        </EmptyMedia>
        <EmptyTitle>No projects connected</EmptyTitle>
        <EmptyDescription>
          Link a GitHub repository so agents can open branches and pull requests.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="outline">Read the guide</Button>
          <Button>Connect repository</Button>
        </div>
      </EmptyContent>
    </Empty>
  </div>
);

export { NoTasks };
