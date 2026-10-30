import { LiveRow } from '@cairn/web';

export const Detail = () => (
  <div style={{ width: 420 }}>
    <LiveRow variant="detail" label="Implementer is editing settings-page.tsx" seconds={42} />
  </div>
);

export const Chief = () => (
  <div style={{ width: 420 }}>
    <LiveRow variant="chief" label="Checking Task #104 status" seconds={7} disclosure={{ expand: 'Show live steps', collapse: 'Hide live steps' }} />
  </div>
);
