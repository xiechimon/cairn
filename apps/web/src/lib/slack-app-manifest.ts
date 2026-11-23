export const SLACK_APP_MANIFEST = {
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
} as const;

export const SLACK_APP_CREATE_URL = `https://api.slack.com/apps?new_app=1&manifest_json=${encodeURIComponent(JSON.stringify(SLACK_APP_MANIFEST))}`;
