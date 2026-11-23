import { describe, expect, it } from 'vitest';
import { SLACK_APP_CREATE_URL, SLACK_APP_MANIFEST } from '../src/lib/slack-app-manifest.js';

describe('slack app manifest', () => {
  it('grants exactly the bot scopes the adapter needs, with writable DMs over socket mode', () => {
    expect(SLACK_APP_MANIFEST).toEqual({
      display_information: { name: 'Cairn' },
      features: {
        bot_user: { display_name: 'Cairn', always_online: true },
        app_home: { messages_tab_enabled: true, messages_tab_read_only_enabled: false },
      },
      oauth_config: {
        scopes: { bot: ['chat:write', 'files:read', 'im:history', 'users:read'] },
      },
      settings: {
        event_subscriptions: { bot_events: ['message.im'] },
        interactivity: { is_enabled: true },
        socket_mode_enabled: true,
      },
    });
    const params = new URLSearchParams(SLACK_APP_CREATE_URL.split('?')[1] ?? '');
    expect(params.get('new_app')).toBe('1');
    expect(JSON.parse(params.get('manifest_json') ?? '')).toEqual(SLACK_APP_MANIFEST);
  });
});
