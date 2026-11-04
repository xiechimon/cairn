import { Marker, MarkerContent, MarkerIcon } from '@cairn/web';
import { BotIcon } from 'lucide-react';

export const WithLink = () => (
  <div style={{ width: 420 }}>
    <Marker>
      <MarkerIcon><BotIcon /></MarkerIcon>
      <MarkerContent>
        Reviewer approved <a href="#pr-2156">PR #2156</a> after re-running the e2e suite on omarchy
      </MarkerContent>
    </Marker>
  </div>
);

export const SeparatorLabel = () => (
  <div style={{ width: 420 }}>
    <Marker variant="separator">
      <MarkerContent>Yesterday</MarkerContent>
    </Marker>
  </div>
);
