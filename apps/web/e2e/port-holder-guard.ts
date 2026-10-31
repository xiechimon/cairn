import type { FullConfig } from '@playwright/test';
import { foreignPortHolderReport, gitToplevel } from '../../../scripts/heavy-slots.mjs';

export default function portHolderGuard(config: FullConfig) {
  const url = config.webServer?.url;
  if (url === undefined) return;
  const report = foreignPortHolderReport({
    port: Number(new URL(url).port),
    toplevel: gitToplevel(import.meta.dirname),
  });
  if (report !== null) throw new Error(report);
}
