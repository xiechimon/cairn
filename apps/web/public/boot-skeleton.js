(() => {
  try {
    let theme = localStorage.getItem('pacman-theme');
    if (theme !== 'light' && theme !== 'dark') {
      theme = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }
    if (theme === 'light') document.documentElement.classList.add('light');
    document.documentElement.dataset.theme = theme;

    let shape = { cols: [3, 3, 3, 3] };
    const raw = localStorage.getItem('pacman-boot-shape');
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed?.cols) && parsed.cols.length > 0) shape = parsed;
      } catch {}
    }

    const boot = document.getElementById('boot');
    if (!boot) return;

    const ink = theme === 'light' ? '#e8dec5' : '#24201b';
    const page = theme === 'light' ? '#efe6d0' : '#1a1612';
    boot.style.cssText = `position:fixed;inset:0;display:grid;grid-template-columns:288px 1fr;background:${page};z-index:0`;

    const rail = document.createElement('div');
    rail.style.cssText = 'padding:16px 12px';
    for (let r = 0; r < 8; r += 1) {
      const row = document.createElement('div');
      row.style.cssText = `height:28px;border-radius:8px;margin-bottom:8px;background:${ink}`;
      rail.appendChild(row);
    }
    boot.appendChild(rail);

    const grid = document.createElement('div');
    grid.style.cssText =
      'display:grid;grid-template-columns:repeat(4,minmax(200px,1fr));gap:14px;padding:28px 17px 13px';
    for (const n of shape.cols.slice(0, 4)) {
      const col = document.createElement('div');
      const count = Math.max(0, Math.min(12, Number(n) || 0));
      for (let i = 0; i < count; i += 1) {
        const card = document.createElement('div');
        card.style.cssText = `height:72px;border-radius:20px;margin-bottom:8px;background:${ink}`;
        col.appendChild(card);
      }
      grid.appendChild(col);
    }
    while (grid.children.length < 4) {
      grid.appendChild(document.createElement('div'));
    }
    boot.appendChild(grid);
  } catch {}
})();
