import type { SecretBox } from '@cairn/shared';
import type { BuildDeps } from './builds.js';
import {
  applyFeishuCardAction,
  parseFeishuCardAction,
  readFeishuCredentials,
  setFeishuSender,
} from './feishu.js';
import { type FeishuSocket, openFeishuSocket } from './feishu-socket.js';

function toast(type: 'success' | 'error', content: string) {
  return { toast: { type, content: content.slice(0, 180) } };
}

export function startFeishuRuntime(
  deps: BuildDeps & { box: SecretBox },
  teamId: string,
): { reload(): void; stop(): void } {
  let socket: FeishuSocket | null = null;
  setFeishuSender({
    sendCard(openId, card) {
      if (socket === null) return Promise.resolve();
      return socket.sendCard(openId, card);
    },
  });
  const reload = () => {
    socket?.close();
    socket = null;
    const creds = readFeishuCredentials({ db: deps.db, box: deps.box }, teamId);
    if (creds === null) return;
    socket = openFeishuSocket(creds, async (payload) => {
      const action = parseFeishuCardAction(payload);
      if (action === null) return toast('error', '无法识别的卡片操作');
      const result = await applyFeishuCardAction(deps, action);
      if (result.accepted) {
        return toast('success', action.action === 'approve' ? '已批准' : '已驳回');
      }
      if (result.reason === 'unbound')
        return toast('error', '这个飞书账号未绑定，或无权处理这项审批');
      return toast('error', result.message);
    });
  };
  reload();
  return {
    reload,
    stop() {
      socket?.close();
      socket = null;
      setFeishuSender(null);
    },
  };
}
