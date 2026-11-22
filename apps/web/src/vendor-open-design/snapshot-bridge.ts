// SPDX-License-Identifier: Apache-2.0. Modified by Cairn from nexu-io/open-design@07258801 apps/web/src/runtime/srcdoc.ts
export function buildSnapshotBridgeScript(): string {
  return `<script data-od-snapshot-bridge>(function(){
  var SNAPSHOT_STYLE_PROPS = [
    'display','position','box-sizing','width','height','min-width','max-width','min-height','max-height',
    'margin','margin-top','margin-right','margin-bottom','margin-left',
    'padding','padding-top','padding-right','padding-bottom','padding-left',
    'border','border-top','border-right','border-bottom','border-left','border-radius',
    'font','font-family','font-size','font-weight','font-style','line-height','letter-spacing',
    'color','background-color','opacity','transform','transform-origin','overflow','overflow-x','overflow-y',
    'white-space','text-align','vertical-align','object-fit','object-position',
    'flex','flex-direction','flex-wrap','flex-grow','flex-shrink','flex-basis',
    'grid','grid-template-columns','grid-template-rows','grid-column','grid-row',
    'gap','row-gap','column-gap','align-items','align-content','align-self',
    'justify-items','justify-content','justify-self','inset','top','right','bottom','left',
    'z-index','box-shadow','text-shadow'
  ];
  function copyComputedStyle(source, target){
    if (!source || !target || source.nodeType !== 1 || target.nodeType !== 1) return;
    var computed = window.getComputedStyle(source);
    var style = target.getAttribute('style') || '';
    for (var i = 0; i < SNAPSHOT_STYLE_PROPS.length; i++){
      var prop = SNAPSHOT_STYLE_PROPS[i];
      var value = computed.getPropertyValue(prop);
      if (value) style += prop + ':' + value + ';';
    }
    target.setAttribute('style', style);
  }
  function syncElementState(source, target){
    var tag = source.tagName ? source.tagName.toLowerCase() : '';
    if (tag === 'img' && source.currentSrc) target.setAttribute('src', source.currentSrc);
    if (tag === 'input' || tag === 'textarea') target.setAttribute('value', source.value || '');
    if (tag === 'canvas') {
      try {
        var img = document.createElement('img');
        img.setAttribute('src', source.toDataURL('image/png'));
        img.setAttribute('style', target.getAttribute('style') || '');
        target.parentNode && target.parentNode.replaceChild(img, target);
      } catch (_) {}
    }
  }
  function inlineSnapshotStyles(originalRoot, cloneRoot){
    copyComputedStyle(originalRoot, cloneRoot);
    syncElementState(originalRoot, cloneRoot);
    var originals = originalRoot.querySelectorAll('*');
    var clones = cloneRoot.querySelectorAll('*');
    var count = Math.min(originals.length, clones.length, 3500);
    for (var i = 0; i < count; i++){
      copyComputedStyle(originals[i], clones[i]);
      syncElementState(originals[i], clones[i]);
    }
  }
  function stripSnapshotResources(cloneRoot){
    var scripts = cloneRoot.querySelectorAll('script');
    for (var s = scripts.length - 1; s >= 0; s--) scripts[s].remove();
    var links = cloneRoot.querySelectorAll('link[rel~="stylesheet"], link[rel~="preload"], link[rel~="preconnect"]');
    for (var l = links.length - 1; l >= 0; l--) links[l].remove();
    var styles = cloneRoot.querySelectorAll('style');
    for (var st = 0; st < styles.length; st++) {
      styles[st].textContent = (styles[st].textContent || '')
        .replace(/@import[^;]+;/gi, '')
        .replace(/@font-face\\s*\\{[^}]*\\}/gi, '');
    }
    var XML_NAME = /^[A-Za-z_][A-Za-z0-9_.-]*(?::[A-Za-z_][A-Za-z0-9_.-]*)?$/;
    var all = cloneRoot.querySelectorAll('*');
    for (var e = 0; e < all.length; e++) {
      var attrs = all[e].attributes;
      for (var a = attrs.length - 1; a >= 0; a--) {
        if (!XML_NAME.test(attrs[a].name)) all[e].removeAttribute(attrs[a].name);
      }
    }
  }
  function serializeSnapshotXhtml(node){
    try {
      var serializer = new XMLSerializer();
      var out = '';
      for (var i = 0; i < node.childNodes.length; i++) out += serializer.serializeToString(node.childNodes[i]);
      return out;
    } catch (_) { return node.innerHTML || ''; }
  }
  function pruneHiddenSnapshotNodes(originalRoot, cloneRoot){
    var originals = originalRoot.querySelectorAll('*');
    var clones = cloneRoot.querySelectorAll('*');
    var count = Math.min(originals.length, clones.length);
    var removals = [];
    for (var i = 0; i < count; i++){
      var original = originals[i];
      var clone = clones[i];
      if (!original || !clone || !clone.parentNode) continue;
      var computed = window.getComputedStyle(original);
      if (computed && (computed.display === 'none' || computed.visibility === 'hidden')) {
        removals.push(clone);
      }
    }
    for (var r = removals.length - 1; r >= 0; r--){
      if (removals[r].parentNode) removals[r].parentNode.removeChild(removals[r]);
    }
  }
  function waitForImages(){
    var imgs = Array.prototype.slice.call(document.images || []);
    return Promise.all(imgs.map(function(img){
      if (img.complete) return Promise.resolve();
      return new Promise(function(resolve){
        img.addEventListener('load', resolve, { once: true });
        img.addEventListener('error', resolve, { once: true });
      });
    }));
  }
  function scrollOffset(){
    var doc = document.documentElement;
    var body = document.body;
    return {
      x: Math.max(window.scrollX || 0, doc ? doc.scrollLeft || 0 : 0, body ? body.scrollLeft || 0 : 0),
      y: Math.max(window.scrollY || 0, doc ? doc.scrollTop || 0 : 0, body ? body.scrollTop || 0 : 0)
    };
  }
  function escapeAttribute(value){
    return String(value || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }
  function snapshotBackgroundColor(){
    try {
      var probe = window.getComputedStyle(document.body || document.documentElement);
      var bg = probe && probe.backgroundColor || '';
      if (!bg || bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)') return '#ffffff';
      return bg;
    } catch (_) { return '#ffffff'; }
  }
  function canvasLooksBlank(ctx, cw, ch){
    try {
      var data = ctx.getImageData(0, 0, cw, ch).data;
      var step = Math.max(4, Math.floor((cw * ch) / 4096)) * 4;
      var first = null, samples = 0;
      for (var i = 0; i + 3 < data.length; i += step){
        samples++;
        if (!first){ first = [data[i], data[i+1], data[i+2], data[i+3]]; continue; }
        if (Math.abs(data[i]-first[0]) > 6 || Math.abs(data[i+1]-first[1]) > 6 ||
            Math.abs(data[i+2]-first[2]) > 6 || Math.abs(data[i+3]-first[3]) > 6) return false;
      }
      return samples > 8;
    } catch (_) { return false; }
  }
  function captureSnapshot(opts){
    opts = opts || {};
    return new Promise(function(resolve, reject){
      var w = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
      var h = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
      var dpr = window.devicePixelRatio || 1;
      var bgColor = snapshotBackgroundColor();
      var docW = Math.max(w, document.documentElement.scrollWidth || 0, document.body ? document.body.scrollWidth : 0);
      var docH = Math.max(h, document.documentElement.scrollHeight || 0, document.body ? document.body.scrollHeight : 0);
      var full = !!opts.full;
      var capW = full ? docW : w;
      var capH = full ? docH : h;
      var clone = document.documentElement.cloneNode(true);
      clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
      inlineSnapshotStyles(document.documentElement, clone);
      pruneHiddenSnapshotNodes(document.documentElement, clone);
      stripSnapshotResources(clone);
      var scroll = full ? { x: 0, y: 0 } : scrollOffset();
      var cloneBody = clone.querySelector('body');
      var rootStyle = clone.getAttribute('style') || '';
      var bodyStyle = cloneBody ? cloneBody.getAttribute('style') || '' : '';
      var bodyContent = serializeSnapshotXhtml(cloneBody || clone);
      var wrapperStyle = rootStyle + bodyStyle +
        'margin:0;position:relative;left:' + (-scroll.x) + 'px;top:' + (-scroll.y) + 'px;' +
        'width:' + docW + 'px;height:' + docH + 'px;overflow:visible;';
      var html = '<div xmlns="http://www.w3.org/1999/xhtml" style="' + escapeAttribute(wrapperStyle) + '">' + bodyContent + '</div>';
      var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + capW + '" height="' + capH + '" viewBox="0 0 ' + capW + ' ' + capH + '">' +
        '<foreignObject x="0" y="0" width="' + docW + '" height="' + docH + '">' +
        html +
        '</foreignObject></svg>';
      var img = new Image();
      img.onload = function(){
        try {
          var canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.floor(capW * dpr));
          canvas.height = Math.max(1, Math.floor(capH * dpr));
          var ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('no 2d context');
          ctx.scale(dpr, dpr);
          ctx.fillStyle = bgColor;
          ctx.fillRect(0, 0, capW, capH);
          ctx.drawImage(img, 0, 0, capW, capH);
          if (canvasLooksBlank(ctx, canvas.width, canvas.height)) {
            reject(new Error('empty-render'));
            return;
          }
          resolve({ dataUrl: canvas.toDataURL('image/png'), w: canvas.width, h: canvas.height });
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err && err.message || err)));
        }
      };
      img.onerror = function(){ reject(new Error('snapshot image failed')); };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }
  window.__odCaptureSnapshot = function(opts){
    return waitForImages().then(function(){ return captureSnapshot(opts || {}); });
  };
  window.addEventListener('message', function(ev){
    var data = ev && ev.data;
    if (!data || data.type !== 'od:snapshot' || !data.id) return;
    window.__odCaptureSnapshot({ full: !!data.full }).then(function(res){
      window.parent.postMessage({ type: 'od:snapshot:result', id: String(data.id), dataUrl: res.dataUrl, w: res.w, h: res.h }, '*');
    }, function(err){
      window.parent.postMessage({ type: 'od:snapshot:result', id: String(data.id), error: String(err && err.message || err) }, '*');
    });
  });
})();</script>`;
}
