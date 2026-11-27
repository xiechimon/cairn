import type { DesktopLocale } from './locale.js';

export interface OfflinePageInput {
  locale: DesktopLocale;
  hostName: string;
  hostUrl: string;
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
  const title = zh ? `无法连接 ${input.hostName}` : `Cannot connect to ${input.hostName}`;
  const subtitle = zh
    ? `你的任务和对话保存在 ${input.hostName} 上。恢复连接后页面自动打开。`
    : `Your tasks and conversations stay on ${input.hostName}. Cairn opens automatically once it responds.`;
  const retryLabel = zh ? '立即重试' : 'Retry now';
  const retryingLabel = zh ? '正在连接…' : 'Connecting…';
  const autoRetryStatus = zh ? '正在自动重试…' : 'Retrying automatically…';

  return `<!doctype html>
<html lang="${zh ? 'zh-CN' : 'en'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${escapeHtml(title)}</title>
<style>
  :root {
    color-scheme: light;
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
      color-scheme: dark;
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
    min-height: 100dvh;
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
  button {
    width: 100%;
    min-height: 36px;
    padding: 8px 14px;
    border-radius: 8px;
    font: 500 13px/1.2 inherit;
    cursor: pointer;
    border: 1px solid transparent;
    touch-action: manipulation;
    user-select: none;
  }
  button:focus-visible {
    outline: 2px solid #c27829;
    outline-offset: 2px;
  }
  button:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .btn-primary {
    background: var(--primary);
    color: var(--on-primary);
  }
  .status {
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
      <p class="status" role="status">${escapeHtml(autoRetryStatus)}</p>
    </div>
  </main>
  <script>
    const retryBtn = document.getElementById('retry-btn');
    const idleLabel = ${JSON.stringify(retryLabel)};
    const busyLabel = ${JSON.stringify(retryingLabel)};
    let busy = false;
    retryBtn?.addEventListener('click', async () => {
      if (busy) return;
      busy = true;
      retryBtn.disabled = true;
      retryBtn.textContent = busyLabel;
      try {
        const ok = await window.cairnDesktop?.host?.retry?.();
        if (!ok) {
          busy = false;
          retryBtn.disabled = false;
          retryBtn.textContent = idleLabel;
        }
      } catch {
        busy = false;
        retryBtn.disabled = false;
        retryBtn.textContent = idleLabel;
      }
    });
  </script>
</body>
</html>`;
}
