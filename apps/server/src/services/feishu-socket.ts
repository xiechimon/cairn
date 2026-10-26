import * as lark from '@larksuiteoapi/node-sdk';

const SELF_BUILT_APP_ID = /^cli_[0-9a-fA-F]{16}$/;

export interface FeishuSocket {
  sendCard(openId: string, card: unknown): Promise<void>;
  close(): void;
}

export function openFeishuSocket(
  creds: { appId: string; appSecret: string },
  onAction: (payload: unknown) => Promise<unknown>,
): FeishuSocket {
  if (!SELF_BUILT_APP_ID.test(creds.appId)) {
    process.stderr.write('feishu app id is not a self-built app id; long connection not started\n');
    return {
      async sendCard() {},
      close() {},
    };
  }
  const base = {
    appId: creds.appId,
    appSecret: creds.appSecret,
    domain: lark.Domain.Feishu,
    loggerLevel: lark.LoggerLevel.warn,
  };
  const client = new lark.Client(base);
  const ws = new lark.WSClient(base);
  void ws.start({
    eventDispatcher: new lark.EventDispatcher({}).register({
      'card.action.trigger': (data: unknown) => onAction(data),
    }),
  });
  return {
    async sendCard(openId, card) {
      await client.im.message.create({
        params: { receive_id_type: 'open_id' },
        data: {
          receive_id: openId,
          msg_type: 'interactive',
          content: JSON.stringify(card),
        },
      });
    },
    close() {
      ws.close({ force: true });
    },
  };
}
