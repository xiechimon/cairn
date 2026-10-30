import { Marker, MarkerContent, MarkerIcon } from '@cairn/web';
import { CircleCheckIcon, CircleXIcon } from 'lucide-react';

export const Icons = () => (
  <div style={{ width: 420, display: 'flex', flexDirection: 'column', gap: 8 }}>
    <Marker>
      <MarkerIcon><CircleCheckIcon /></MarkerIcon>
      <MarkerContent>Build #318 passed</MarkerContent>
    </Marker>
    <Marker>
      <MarkerIcon><CircleXIcon /></MarkerIcon>
      <MarkerContent>Build #317 failed at typecheck</MarkerContent>
    </Marker>
  </div>
);
