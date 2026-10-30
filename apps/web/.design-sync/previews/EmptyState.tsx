import { EmptyState } from '@cairn/web';
import { InboxIcon, KeyRoundIcon, ServerIcon } from 'lucide-react';

export const WithAction = () => (
  <div style={{ width: 480 }}>
    <EmptyState
      icon={InboxIcon}
      title="No tasks yet"
      description="Create a task and cairn assigns it to an agent, runs the build and opens a PR."
      action={{ label: 'New task' }}
    />
  </div>
);

export const WithHint = () => (
  <div style={{ width: 480 }}>
    <EmptyState
      icon={ServerIcon}
      title="No machines connected"
      description="Enroll a machine to run agents on it."
      hint={{ icon: KeyRoundIcon, text: 'Run cairn daemon enroll on the machine' }}
    />
  </div>
);

export const TitleOnly = () => (
  <div style={{ width: 480 }}>
    <EmptyState icon={InboxIcon} title="Nothing needs your review" />
  </div>
);
