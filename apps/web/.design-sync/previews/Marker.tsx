import { Marker, MarkerContent, MarkerIcon } from '@cairn/web';
import { GitMergeIcon, GitPullRequestIcon } from 'lucide-react';

export const Default = () => (
  <div style={{ width: 420 }}>
    <Marker>
      <MarkerIcon><GitPullRequestIcon /></MarkerIcon>
      <MarkerContent>Implementer opened PR #2156</MarkerContent>
    </Marker>
  </div>
);

export const Separator = () => (
  <div style={{ width: 420 }}>
    <Marker variant="separator">
      <MarkerContent>Today</MarkerContent>
    </Marker>
  </div>
);

export const Border = () => (
  <div style={{ width: 420 }}>
    <Marker variant="border">
      <MarkerIcon><GitMergeIcon /></MarkerIcon>
      <MarkerContent>Task #104 merged into main</MarkerContent>
    </Marker>
  </div>
);
