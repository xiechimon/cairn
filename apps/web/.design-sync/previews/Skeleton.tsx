import { Skeleton } from '@cairn/web';

export const TaskRow = () => (
  <div style={{ width: 360, display: 'flex', gap: 12, alignItems: 'center' }}>
    <Skeleton style={{ width: 32, height: 32, borderRadius: 9999 }} />
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <Skeleton style={{ height: 14, width: '70%' }} />
      <Skeleton style={{ height: 12, width: '45%' }} />
    </div>
  </div>
);

export const Card = () => (
  <div style={{ width: 360, display: 'flex', flexDirection: 'column', gap: 8 }}>
    <Skeleton style={{ height: 96 }} />
    <Skeleton style={{ height: 14, width: '80%' }} />
    <Skeleton style={{ height: 14, width: '60%' }} />
  </div>
);
