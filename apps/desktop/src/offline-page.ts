import type { DesktopLocale } from './locale.js';

export interface OfflineConnectionOption {
  id: string;
  name: string;
  kind: 'local' | 'remote';
}

export interface OfflinePageInput {
  locale: DesktopLocale;
  hostName: string;
  hostUrl: string;
  connections: readonly OfflineConnectionOption[];
  activeId: string;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function offlinePageHtml(input: OfflinePageInput): string {
  const zh = input.locale === 'zh';
  const title = zh ? `无法连接到 ${input.hostName}` : `Cannot reach ${input.hostName}`;
  const subtitle = zh
    ? '远程服务器暂时离线或网络中断。你的数据仍安全保存在服务器上，可以稍后重试，或切换回其他主机继续使用。'
    : 'The remote server is temporarily unreachable. Your data remains safe on the server. Retry or switch to another host.';
  const retryLabel = zh ? '立即重试' : 'Retry now';
  const autoRetryPrefix = zh ? '秒后自动重试' : 's until automatic retry';
  const switchHeading = zh ? '切换主机' : 'Switch host';
  const localLabel = zh ? '本机' : 'This computer';

  const alternatives = input.connections.filter((conn) => conn.id !== input.activeId);
  const switchButtons = alternatives
    .map((conn) => {
      const label = conn.kind === 'local' ? localLabel : conn.name;
      return `<button type="button" class="btn-secondary" data-switch-id="${escapeHtml(conn.id)}">${escapeHtml(zh ? `切换到 ${label}` : `Switch to ${label}`)}</button>`;
    })
    .join('');

  return `<!doctype html>
<html lang="${zh ? 'zh-CN' : 'en'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root {
    --canvas: #e7e6e1;
    --card: #e5e4df;
    --ink: #1c1d1b;
    --ink-2: #343633;
    --ink-3: #4b4d4a;
    --line: rgb(0 0 0 / 0.1);
    --hover: rgb(0 0 0 / 0.06);
    --primary: #1c1d1b;
    --on-primary: #ecebe6;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --canvas: #1b1c1b;
      --card: #1f201f;
      --ink: #ecebe6;
      --ink-2: #bbbab7;
      --ink-3: #9c9b98;
      --line: rgb(255 255 255 / 0.1);
      --hover: rgb(255 255 255 / 0.075);
      --primary: #ecebe6;
      --on-primary: #151615;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 24px;
    background: var(--canvas);
    color: var(--ink);
    font: 14px/1.5 "Instrument Sans", -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
    -webkit-app-region: drag;
  }
  .card {
    width: 100%;
    max-width: 400px;
    padding: 24px;
    border-radius: 12px;
    background: var(--card);
    border: 1px solid var(--line);
    display: flex;
    flex-direction: column;
    gap: 12px;
    -webkit-app-region: no-drag;
  }
  h1 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    line-height: 1.4;
  }
  p {
    margin: 0;
    font-size: 13px;
    color: var(--ink-2);
    line-height: 1.5;
  }
  .meta {
    font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, monospace;
    font-size: 12px;
    color: var(--ink-3);
    word-break: break-all;
  }
  .actions {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 4px;
  }
  .divider {
    height: 1px;
    background: var(--line);
    margin: 4px 0;
  }
  .section-label {
    font-size: 12px;
    font-weight: 500;
    color: var(--ink-3);
  }
  button {
    width: 100%;
    min-height: 36px;
    padding: 8px 14px;
    border-radius: 8px;
    font: 500 13px/1.2 inherit;
    cursor: pointer;
    border: 1px solid transparent;
  }
  .btn-primary {
    background: var(--primary);
    color: var(--on-primary);
  }
  .btn-secondary {
    background: transparent;
    color: var(--ink);
    border-color: var(--line);
  }
  .btn-secondary:hover {
    background: var(--hover);
  }
  .countdown {
    text-align: center;
    font-size: 12px;
    color: var(--ink-3);
    font-variant-numeric: tabular-nums;
  }
</style>
</head>
<body>
  <main class="card" data-testid="desktop-offline-page">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(subtitle)}</p>
    <p class="meta">${escapeHtml(input.hostUrl)}</p>
    <div class="actions">
      <button type="button" class="btn-primary" id="retry-btn">${escapeHtml(retryLabel)}</button>
      <p class="countdown"><span id="countdown-num">15</span> ${escapeHtml(autoRetryPrefix)}</p>
    </div>
    ${
      switchButtons !== ''
        ? `<div class="divider"></div><div class="section-label">${escapeHtml(switchHeading)}</div><div class="actions">${switchButtons}</div>`
        : ''
    }
  </main>
  <script>
    const retry = () => window.cairnDesktop?.host?.retry?.();
    document.getElementById('retry-btn')?.addEventListener('click', retry);
    for (const btn of document.querySelectorAll('[data-switch-id]')) {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-switch-id');
        if (id) window.cairnDesktop?.host?.switch?.(id);
      });
    }
    let seconds = 15;
    const label = document.getElementById('countdown-num');
    setInterval(() => {
      seconds -= 1;
      if (seconds <= 0) {
        seconds = 15;
        retry();
      }
      if (label) label.textContent = String(seconds);
    }, 1000);
  </script>
</body>
</html>`;
}
