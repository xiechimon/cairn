export interface QuitSteps {
  stopHelpers(): Promise<unknown>;
  stopOwnServer: (() => Promise<void>) | null;
  rollingBack(): boolean;
  applyUpdate(): Promise<void>;
}

export async function finishQuit(steps: QuitSteps): Promise<void> {
  await steps.stopHelpers();
  if (steps.stopOwnServer !== null) await steps.stopOwnServer();
  if (!steps.rollingBack()) await steps.applyUpdate();
}
