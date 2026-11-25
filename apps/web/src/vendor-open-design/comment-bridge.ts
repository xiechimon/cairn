// SPDX-License-Identifier: Apache-2.0. Modified by Cairn from nexu-io/open-design@07258801 apps/web/src/runtime/comment-bridge.ts
export const COMMENT_BRIDGE_MESSAGES = {
  mode: 'od:comment-mode',
  target: 'od:comment-target',
  hover: 'od:comment-hover',
  locate: 'od:comment-locate',
  located: 'od:comment-located',
  scroll: 'od:preview-scroll',
  wheel: 'od:preview-wheel',
  keydown: 'od:preview-keydown',
  ready: 'od:comment-ready',
} as const;

export function buildCommentBridgeScript(): string {
  return `<script data-od-comment-bridge>(function(){
  var commentEnabled = false;
  var ANNOTATED = '[data-od-id], [data-screen-label], [data-cairn-id]';
  var STYLE_KEYS = ['color','backgroundColor','fontSize','fontWeight','fontFamily','lineHeight'];
  function visible(el){ try { var r=el.getBoundingClientRect(); return r.width >= 1 && r.height >= 1; } catch (_) { return false; } }
  function esc(value){ return String(value).replace(/"/g, String.fromCharCode(92) + '"'); }
  function annotatedElementIdFor(el){
    var odId = el.getAttribute('data-od-id');
    if (odId) return odId;
    var cairnId = el.getAttribute('data-cairn-id');
    if (cairnId) return cairnId;
    var label = el.getAttribute('data-screen-label');
    return label || null;
  }
  function annotatedSelectorFor(el){
    var odId = el.getAttribute('data-od-id');
    if (odId) return '[data-od-id="' + esc(odId) + '"]';
    var cairnId = el.getAttribute('data-cairn-id');
    if (cairnId) return '[data-cairn-id="' + esc(cairnId) + '"]';
    var label = el.getAttribute('data-screen-label');
    if (label) return '[data-screen-label="' + esc(label) + '"]';
    return null;
  }
  function structuralSelectorFor(el){
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      if (node.id) { parts.unshift('#' + CSS.escape(node.id)); break; }
      var tag = node.tagName.toLowerCase();
      var parent = node.parentElement;
      if (!parent) { parts.unshift(tag); break; }
      var same = Array.prototype.filter.call(parent.children, function(c){ return c.tagName === node.tagName; });
      parts.unshift(same.length > 1 ? tag + ':nth-of-type(' + (same.indexOf(node) + 1) + ')' : tag);
      node = parent;
    }
    return parts.join(' > ');
  }
  function styleOf(el){
    try {
      var cs = getComputedStyle(el);
      var out = {};
      for (var i = 0; i < STYLE_KEYS.length; i++) { var v = cs[STYLE_KEYS[i]]; if (v) out[STYLE_KEYS[i]] = String(v).slice(0, 120); }
      return out;
    } catch (_) { return null; }
  }
  function pickable(clicked){
    if (!clicked || clicked.nodeType !== 1) return null;
    var annotated = clicked.closest && clicked.closest(ANNOTATED);
    if (annotated) return annotated;
    if (clicked === document.body || clicked === document.documentElement) return null;
    return clicked;
  }
  function targetFrom(el){
    if (!el || !visible(el)) return null;
    var id = annotatedElementIdFor(el) || '';
    var selector = annotatedSelectorFor(el) || structuralSelectorFor(el);
    if (!selector) return null;
    var rect = el.getBoundingClientRect();
    return {
      elementId: id.slice(0, 200),
      selector: selector.slice(0, 1000),
      label: (el.tagName || 'element').toLowerCase(),
      text: (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 160),
      position: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      htmlHint: ((el.outerHTML || '').replace(/\\s+/g, ' ').match(/^<[^>]+>/) || [''])[0].slice(0, 180),
      style: styleOf(el)
    };
  }
  function find(data){
    var el = null;
    try { el = data.selector ? document.querySelector(String(data.selector)) : null; } catch (_) {}
    if (!el && data.elementId) {
      var id = esc(data.elementId);
      el = document.querySelector('[data-od-id="' + id + '"], [data-cairn-id="' + id + '"], [data-screen-label="' + id + '"]');
    }
    if (!el && data.text) {
      var all = document.querySelectorAll(data.label || '*');
      for (var i = 0; i < all.length && !el; i++) {
        if ((all[i].textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 160) === data.text) el = all[i];
      }
    }
    return el;
  }
  function postScroll(){
    var frame = document.scrollingElement || document.documentElement;
    window.parent.postMessage({ type: 'od:preview-scroll', left: Math.round(frame.scrollLeft || 0), top: Math.round(frame.scrollTop || 0) }, '*');
  }
  window.addEventListener('message', function(ev){
    var data = ev && ev.data;
    if (!data || !data.type) return;
    if (data.type === 'od:comment-mode') {
      commentEnabled = !!data.enabled;
      document.documentElement.toggleAttribute('data-od-comment-mode', commentEnabled);
      return;
    }
    if (data.type === 'od:comment-locate') {
      var results = [];
      var items = Array.isArray(data.items) ? data.items : [];
      for (var i = 0; i < items.length; i++) {
        var el = find(items[i]);
        var target = targetFrom(el);
        var how = !target ? 'lost' : (items[i].elementId && target.elementId === items[i].elementId) || target.selector === items[i].selector ? 'anchored' : 'moved';
        results.push({ id: items[i].id, state: how, position: target ? target.position : null });
      }
      window.parent.postMessage({ type: 'od:comment-located', requestId: data.requestId, results: results }, '*');
    }
  });
  document.addEventListener('mousemove', function(ev){
    if (!commentEnabled) return;
    var target = targetFrom(pickable(ev.target));
    window.parent.postMessage({ type: 'od:comment-hover', target: target }, '*');
  }, true);
  document.addEventListener('click', function(ev){
    if (!commentEnabled) return;
    var target = targetFrom(pickable(ev.target));
    if (!target) return;
    ev.preventDefault();
    ev.stopPropagation();
    window.parent.postMessage({ type: 'od:comment-target', target: target }, '*');
  }, true);
  function isEditable(el){
    return !!(el && el.nodeType === 1 && (el.isContentEditable || (el.closest && el.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'))));
  }
  window.addEventListener('wheel', function(ev){
    if (!ev.ctrlKey) return;
    ev.preventDefault();
    window.parent.postMessage({ type: 'od:preview-wheel', deltaY: ev.deltaY, deltaMode: ev.deltaMode, clientX: ev.clientX, clientY: ev.clientY }, '*');
  }, { passive: false });
  document.addEventListener('keydown', function(ev){
    if (ev.defaultPrevented || ev.isComposing || ev.keyCode === 229) return;
    if (ev.key === 'Escape') {
      if (!isEditable(ev.target)) {
        window.parent.postMessage({ type: 'od:preview-keydown', key: ev.key, code: ev.code, metaKey: ev.metaKey, ctrlKey: ev.ctrlKey, altKey: ev.altKey }, '*');
      }
      return;
    }
    if ((ev.metaKey || ev.ctrlKey) && !ev.altKey && (ev.key === '=' || ev.key === '+' || ev.key === '-' || ev.key === '_' || ev.key === '0')) {
      ev.preventDefault();
      window.parent.postMessage({ type: 'od:preview-keydown', key: ev.key, code: ev.code, metaKey: ev.metaKey, ctrlKey: ev.ctrlKey, altKey: ev.altKey }, '*');
    }
  });
  document.addEventListener('scroll', postScroll, true);
  window.addEventListener('resize', postScroll);
  window.parent.postMessage({ type: 'od:comment-ready' }, '*');
})();</script>`;
}
