import { LiveSignal } from '@cairn/web';

export const Recent = () => (
  <LiveSignal at={Date.now() - 12000} className="text-meta text-content-tertiary" />
);
