// 主题切换：重载时读 localStorage。首帧会用到默认主题，再切到用户主题。
export function applyTheme() {
  const saved = localStorage.getItem('cairn-theme') ?? 'light';
  document.documentElement.dataset.theme = saved;
}
