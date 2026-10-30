import { ThinkingRow } from '@cairn/web';

export const Collapsed = () => (
  <div style={{ width: 360 }}>
    <ThinkingRow text={'The merge gate reads headSha from the verdict, so a force-push after review should invalidate it. Check planGateStatusWrite before touching the route.\nThen run the TLC model.'} />
  </div>
);

export const Short = () => (
  <div style={{ width: 360 }}>
    <ThinkingRow text="Need the failing spec name from build #312 first." />
  </div>
);
