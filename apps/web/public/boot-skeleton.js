(() => {
  try {
    let theme = localStorage.getItem('cairn-theme');
    if (theme !== 'light' && theme !== 'dark') {
      theme = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }
    if (theme === 'light') document.documentElement.classList.add('light');
    document.documentElement.dataset.theme = theme;

    const boot = document.getElementById('boot');
    if (!boot) return;

    const page = theme === 'light' ? '#e7e6e1' : '#1b1c1b';
    const ink = theme === 'light' ? '#343633' : '#bbbab7';
    const meta = theme === 'light' ? '#4b4d4a' : '#9c9b98';
    boot.style.cssText = `position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:32px;background:${page};z-index:0;transition:opacity .24s ease`;

    let locale = localStorage.getItem('cairn.locale') || localStorage.getItem('cairn-locale') || '';
    if (locale !== 'zh' && locale !== 'en') {
      locale = (navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en';
    }

    const size = Math.max(160, Math.min(300, window.innerWidth - 96, window.innerHeight - 220));
    const d =
      'M-7 0 A7 7 0 0 1 7 0 A22 22 0 0 1 -37 0 A37 37 0 0 1 37 0 A52 52 0 0 1 -67 0 A67 67 0 0 1 67 0 A82 82 0 0 1 47.816 52.709';
    const caption = locale === 'zh' ? '正在连接…' : 'Connecting…';

    boot.innerHTML = `
      <svg width="${size}" height="${size}" viewBox="-105 -105 210 210" aria-hidden="true" style="overflow:visible;color:${ink}">
        <defs>
          <filter id="cairn-boot-ink" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="7" result="warp" />
            <feDisplacementMap in="SourceGraphic" in2="warp" scale="1.6" xChannelSelector="R" yChannelSelector="G" result="rough" />
            <feTurbulence type="fractalNoise" baseFrequency="1.4" numOctaves="1" seed="2" result="grain" />
            <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -3.2 2.55" result="holes" />
            <feComposite in="rough" in2="holes" operator="in" />
          </filter>
        </defs>
        <g filter="url(#cairn-boot-ink)">
          <path class="boot-path" d="${d}" pathLength="1" fill="none" stroke="currentColor" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" />
        </g>
      </svg>
      <div style="display:flex;flex-direction:column;align-items:center;gap:8px">
        <span style="font-family:'Source Serif 4',Georgia,serif;font-size:20px;color:${ink}">Cairn</span>
        <span style="font-family:'Instrument Sans',system-ui,sans-serif;font-size:13px;color:${meta}">${caption}</span>
      </div>
      <style>
        @keyframes cairn-boot-draw { from { stroke-dashoffset: 1 } to { stroke-dashoffset: 0 } }
        #boot .boot-path { stroke-dasharray: 1 1; animation: cairn-boot-draw 1.6s cubic-bezier(0.45, 0.05, 0.3, 1) both }
        @media (prefers-reduced-motion: reduce) { #boot .boot-path { animation: none; stroke-dashoffset: 0 } }
      </style>`;
  } catch {}
})();
