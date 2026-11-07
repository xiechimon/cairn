(() => {
  if (window.__dc) return;
  const origin = performance.timeOrigin;
  const motionProps = [
    'opacity',
    'transform',
    'scale',
    'translate',
    'rotate',
    'backgroundColor',
    'color',
    'boxShadow',
    'borderTopColor',
    'outlineColor',
    'outlineWidth',
    'filter',
    'clipPath',
    'visibility',
  ];
  const dumpProps = [
    'display',
    'position',
    'fontFamily',
    'fontSize',
    'fontWeight',
    'fontStyle',
    'lineHeight',
    'letterSpacing',
    'textTransform',
    'textDecorationLine',
    'textOverflow',
    'whiteSpace',
    'color',
    'backgroundColor',
    'backgroundImage',
    'opacity',
    'borderTopWidth',
    'borderTopStyle',
    'borderTopColor',
    'borderRightWidth',
    'borderRightStyle',
    'borderRightColor',
    'borderBottomWidth',
    'borderBottomStyle',
    'borderBottomColor',
    'borderLeftWidth',
    'borderLeftStyle',
    'borderLeftColor',
    'borderTopLeftRadius',
    'borderTopRightRadius',
    'borderBottomRightRadius',
    'borderBottomLeftRadius',
    'boxShadow',
    'outlineWidth',
    'outlineStyle',
    'outlineColor',
    'outlineOffset',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
    'marginTop',
    'marginRight',
    'marginBottom',
    'marginLeft',
    'rowGap',
    'columnGap',
    'width',
    'height',
    'maxWidth',
    'transitionProperty',
    'transitionDuration',
    'transitionTimingFunction',
    'transitionDelay',
    'animationName',
    'animationDuration',
    'animationTimingFunction',
    'cursor',
    'listStyleType',
    'textAlign',
    'verticalAlign',
    'backdropFilter',
    'strokeWidth',
    'fill',
    'stroke',
  ];
  const ids = new WeakMap();
  let nextId = 1;
  const idOf = (el) => {
    let id = ids.get(el);
    if (!id) {
      id = nextId++;
      ids.set(el, id);
    }
    return id;
  };
  const ownText = (el) =>
    [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent)
      .join('')
      .trim()
      .replace(/\s+/g, ' ');
  const keyOf = (el) => {
    if (el?.nodeType !== 1) return '';
    const parts = [el.tagName.toLowerCase()];
    const role = el.getAttribute('role');
    if (role) parts.push(`[role=${role}]`);
    const aria = el.getAttribute('aria-label');
    if (aria) parts.push(`[aria=${aria.slice(0, 40)}]`);
    const testid = el.getAttribute('data-testid') || el.getAttribute('data-slot');
    if (testid) parts.push(`[tid=${testid.slice(0, 40)}]`);
    const text = ownText(el);
    if (text) parts.push(`"${text.slice(0, 24)}"`);
    parts.push(`#${idOf(el)}`);
    return parts.join('');
  };
  const pathOf = (el) => {
    const out = [];
    let e = el;
    for (let i = 0; i < 4 && e && e.nodeType === 1; i++) {
      out.unshift(
        e.tagName.toLowerCase() + (e.getAttribute('role') ? `[${e.getAttribute('role')}]` : ''),
      );
      e = e.parentElement;
    }
    return out.join('>');
  };
  const rectOf = (el) => {
    const r = el.getBoundingClientRect();
    return [
      Math.round(r.x * 10) / 10,
      Math.round(r.y * 10) / 10,
      Math.round(r.width * 10) / 10,
      Math.round(r.height * 10) / 10,
    ];
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return (
      r.width > 0 &&
      r.height > 0 &&
      r.bottom > 0 &&
      r.right > 0 &&
      r.top < innerHeight &&
      r.left < innerWidth
    );
  };
  const motionSnap = (el) => {
    const c = getComputedStyle(el);
    const o = { rect: rectOf(el).join(',') };
    for (const p of motionProps) o[p] = c[p];
    for (const ps of ['::before', '::after']) {
      const d = getComputedStyle(el, ps);
      if (d.content !== 'none' && d.content !== 'normal') {
        o[`${ps}bg`] = d.backgroundColor;
        o[`${ps}op`] = d.opacity;
        o[`${ps}tf`] = d.transform;
      }
    }
    return o;
  };
  const state = {
    active: false,
    frames: [],
    events: [],
    mutations: [],
    marks: [],
    watch: [],
    textWatch: [],
    added: new Set(),
    prev: new Map(),
    scrollers: [],
    prevScroll: [],
    prevText: [],
  };
  const findScrollers = () =>
    [...document.querySelectorAll('*')]
      .filter((e) => {
        const c = getComputedStyle(e);
        return (
          e.scrollHeight > e.clientHeight + 40 &&
          /(auto|scroll)/.test(c.overflowY) &&
          e.clientHeight > 200
        );
      })
      .sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)
      .slice(0, 3)
      .concat([document.scrollingElement]);
  const tracked = () => {
    const set = new Set();
    for (const sel of state.watch) {
      for (const e of [...document.querySelectorAll(sel)].slice(0, 40)) set.add(e);
    }
    const hovered = [...document.querySelectorAll(':hover')].slice(-5);
    for (const e of hovered) set.add(e);
    for (const e of hovered.slice(-1))
      for (const k of [...e.querySelectorAll('*')].slice(0, 12)) set.add(k);
    for (const e of document.querySelectorAll(':active')) set.add(e);
    if (document.activeElement && document.activeElement !== document.body)
      set.add(document.activeElement);
    for (const e of state.added) {
      if (e.isConnected) set.add(e);
      else state.added.delete(e);
    }
    return set;
  };
  const tick = (now) => {
    if (!state.active) return;
    const t = Math.round((origin + now) * 100) / 100;
    const diffs = {};
    for (const el of tracked()) {
      if (!el.isConnected) continue;
      const key = keyOf(el);
      const snap = motionSnap(el);
      const before = state.prev.get(key);
      const changed = {};
      let any = false;
      for (const k of Object.keys(snap)) {
        if (!before || before[k] !== snap[k]) {
          changed[k] = snap[k];
          any = true;
        }
      }
      if (any) diffs[key] = before ? changed : { ...snap, _new: true };
      state.prev.set(key, snap);
    }
    const scroll = state.scrollers.map((s) => (s ? Math.round(s.scrollTop * 10) / 10 : null));
    const scrollChanged = scroll.some((v, i) => v !== state.prevScroll[i]);
    state.prevScroll = scroll;
    const text = state.textWatch.map((sel) => {
      const all = document.querySelectorAll(sel);
      const last = all[all.length - 1];
      return last ? last.textContent.length : 0;
    });
    const textChanged = text.some((v, i) => v !== state.prevText[i]);
    state.prevText = text;
    const frame = { t };
    if (Object.keys(diffs).length) frame.d = diffs;
    if (scrollChanged) frame.s = scroll;
    if (textChanged) frame.tl = text;
    state.frames.push(frame);
    requestAnimationFrame(tick);
  };
  const onEvent = (ev) => {
    if (!state.active) return;
    const rec = {
      t: Math.round((origin + ev.timeStamp) * 100) / 100,
      type: ev.type,
      target: keyOf(ev.target),
    };
    if (ev.type === 'keydown') rec.key = ev.key;
    if (ev.type === 'wheel') rec.dy = ev.deltaY;
    if (ev.clientX !== undefined) rec.xy = [ev.clientX, ev.clientY];
    state.events.push(rec);
  };
  for (const type of [
    'pointerdown',
    'pointerup',
    'pointerover',
    'click',
    'keydown',
    'wheel',
    'focusin',
  ]) {
    addEventListener(type, onEvent, { capture: true, passive: true });
  }
  const mo = new MutationObserver((list) => {
    if (!state.active) return;
    const t = Math.round((origin + performance.now()) * 100) / 100;
    for (const m of list) {
      if (m.type === 'childList') {
        const added = [...m.addedNodes].filter((n) => n.nodeType === 1);
        const removed = [...m.removedNodes].filter((n) => n.nodeType === 1);
        const addedText = [...m.addedNodes]
          .filter((n) => n.nodeType === 3)
          .reduce((a, n) => a + n.textContent.length, 0);
        if (!added.length && !removed.length && !addedText) continue;
        for (const a of added) {
          const r = a.getBoundingClientRect();
          if (r.width * r.height > 400) state.added.add(a);
        }
        state.mutations.push({
          t,
          target: keyOf(m.target),
          add: added.slice(0, 4).map(keyOf),
          addN: added.length,
          rm: removed.slice(0, 4).map((n) => n.tagName.toLowerCase()),
          rmN: removed.length,
          chars: addedText || undefined,
        });
      } else if (m.type === 'characterData') {
        state.mutations.push({
          t,
          target: keyOf(m.target.parentElement),
          chars: m.target.textContent.length,
        });
      } else if (m.type === 'attributes') {
        state.mutations.push({
          t,
          target: keyOf(m.target),
          attr: m.attributeName,
          v: String(m.target.getAttribute(m.attributeName)).slice(0, 60),
        });
      }
    }
  });
  const rootVars = () => {
    const names = new Set();
    const walk = (rules) => {
      for (const r of rules) {
        if (r.cssRules) walk(r.cssRules);
        if (
          r.style &&
          r.selectorText &&
          /(:root|^html|\.dark|\.light|data-theme|data-mode|\.cds-root)/.test(r.selectorText)
        ) {
          for (const p of r.style) if (p.startsWith('--')) names.add(p);
        }
      }
    };
    for (const s of document.styleSheets) {
      try {
        walk(s.cssRules);
      } catch {}
    }
    const html = getComputedStyle(document.documentElement);
    const body = getComputedStyle(document.body);
    const out = {};
    for (const n of [...names].sort()) {
      out[n] = { html: html.getPropertyValue(n).trim(), body: body.getPropertyValue(n).trim() };
    }
    return out;
  };
  const resolveRoles = (roles) => {
    const tags = new Map();
    for (const [name, spec] of Object.entries(roles || {})) {
      const [sel, mod] = spec.split(' >>');
      let found = [];
      try {
        found = [...document.querySelectorAll(sel)];
      } catch {}
      for (let el of found) {
        if (mod === 'rounded') {
          let e = el;
          while (
            e &&
            e !== document.body &&
            !(
              parseFloat(getComputedStyle(e).borderTopLeftRadius) > 0 &&
              e.getBoundingClientRect().height > 30
            )
          )
            e = e.parentElement;
          if (!e || e === document.body) continue;
          el = e;
        } else if (mod === 'filled') {
          let e = el;
          while (
            e &&
            e !== document.body &&
            getComputedStyle(e).backgroundColor === 'rgba(0, 0, 0, 0)'
          )
            e = e.parentElement;
          if (!e || e === document.body) continue;
          el = e;
        }
        if (!tags.has(el)) tags.set(el, []);
        if (!tags.get(el).includes(name)) tags.get(el).push(name);
      }
    }
    return tags;
  };
  const dump = (opts = {}) => {
    const all = opts.all === true;
    const roleTags = resolveRoles(opts.roles);
    const els = [];
    for (const el of document.body.querySelectorAll('*')) {
      if (!all && !visible(el)) continue;
      const c = getComputedStyle(el);
      if (c.display === 'none') continue;
      const s = {};
      for (const p of dumpProps) s[p] = c[p];
      const pseudo = {};
      for (const ps of ['::before', '::after', '::placeholder', '::marker']) {
        const d = getComputedStyle(el, ps);
        if (d.content && d.content !== 'none' && d.content !== 'normal') {
          pseudo[ps] = {
            content: d.content.slice(0, 20),
            bg: d.backgroundColor,
            color: d.color,
            radius: d.borderTopLeftRadius,
            opacity: d.opacity,
            boxShadow: d.boxShadow,
            border: `${d.borderTopWidth} ${d.borderTopColor}`,
          };
        }
      }
      els.push({
        key: keyOf(el),
        path: pathOf(el),
        rect: rectOf(el),
        text: ownText(el).slice(0, 60),
        cls: String(
          el.className && el.className.baseVal !== undefined
            ? el.className.baseVal
            : el.className || '',
        ).slice(0, 200),
        s,
        roles: roleTags.get(el),
        pseudo: Object.keys(pseudo).length ? pseudo : undefined,
      });
    }
    return {
      url: location.pathname,
      t: Date.now(),
      viewport: [innerWidth, innerHeight, devicePixelRatio],
      htmlAttrs: Object.fromEntries(
        [...document.documentElement.attributes]
          .filter((a) => !/^(style)$/.test(a.name))
          .map((a) => [a.name, a.value.slice(0, 80)]),
      ),
      vars: rootVars(),
      els,
    };
  };
  window.__dc = {
    start(opts = {}) {
      state.watch = opts.watch || [];
      state.textWatch = opts.textWatch || [];
      state.frames = [];
      state.events = [];
      state.mutations = [];
      state.marks = [];
      state.prev = new Map();
      state.added = new Set();
      state.scrollers = findScrollers();
      state.prevScroll = [];
      state.prevText = [];
      state.active = true;
      mo.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: [
          'data-state',
          'aria-expanded',
          'data-open',
          'open',
          'hidden',
          'aria-hidden',
        ],
      });
      requestAnimationFrame(tick);
      return { scrollers: state.scrollers.map((s) => (s ? keyOf(s) : null)) };
    },
    mark(label) {
      state.marks.push({ t: Math.round((origin + performance.now()) * 100) / 100, label });
    },
    rescanScrollers() {
      state.scrollers = findScrollers();
      return state.scrollers.map((s) => (s ? keyOf(s) : null));
    },
    stop() {
      state.active = false;
      mo.disconnect();
      return {
        frames: state.frames,
        events: state.events,
        mutations: state.mutations,
        marks: state.marks,
      };
    },
    dump,
  };
})();
