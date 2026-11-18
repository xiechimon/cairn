export type ScreenGatewayId = 'computer' | 'engine';
export type ScreenUpgradeSide = 'viewer' | 'machine';

export interface ScreenUpgradePath {
  gateway: ScreenGatewayId;
  side: ScreenUpgradeSide;
  channelId: string;
}

const SCREEN_UPGRADES: readonly {
  gateway: ScreenGatewayId;
  side: ScreenUpgradeSide;
  pattern: RegExp;
}[] = [
  { gateway: 'computer', side: 'viewer', pattern: /^\/api\/computer-screen\/([a-f0-9]{64})$/ },
  {
    gateway: 'computer',
    side: 'machine',
    pattern: /^\/api\/machine\/computer-screen\/([a-f0-9]{64})$/,
  },
  { gateway: 'engine', side: 'viewer', pattern: /^\/api\/engine-screen\/([a-f0-9]{64})$/ },
  {
    gateway: 'engine',
    side: 'machine',
    pattern: /^\/api\/machine\/engine-screen\/([a-f0-9]{64})$/,
  },
];

export function screenUpgradePath(pathname: string): ScreenUpgradePath | null {
  for (const entry of SCREEN_UPGRADES) {
    const match = entry.pattern.exec(pathname);
    if (match) return { gateway: entry.gateway, side: entry.side, channelId: match[1] ?? '' };
  }
  return null;
}
