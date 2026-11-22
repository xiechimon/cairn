// SPDX-License-Identifier: Apache-2.0. Modified by Cairn from nexu-io/open-design@07258801 packages/contracts/src/runtime/preview-guards.ts
export function buildPreviewSandboxShim(): string {
  return `<script data-od-sandbox-shim>(function(){
  function makeStore(){
    var data = {};
    var api = {
      getItem: function(k){ return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
      setItem: function(k, v){ data[k] = String(v); },
      removeItem: function(k){ delete data[k]; },
      clear: function(){ data = {}; },
      key: function(i){ return Object.keys(data)[i] || null; }
    };
    Object.defineProperty(api, 'length', { get: function(){ return Object.keys(data).length; } });
    return api;
  }
  function tryShim(name){
    var works = false;
    try { works = !!window[name] && typeof window[name].getItem === 'function'; void window[name].length; }
    catch (_) { works = false; }
    if (works) return;
    try { Object.defineProperty(window, name, { configurable: true, value: makeStore() }); }
    catch (_) { try { window[name] = makeStore(); } catch (__) {} }
  }
  tryShim('localStorage');
  tryShim('sessionStorage');
  function shimHistoryMethod(name){
    try {
      var h = window.history;
      var original = h && h[name];
      if (typeof original !== 'function') return;
      h[name] = function(state, title, url){
        try { return original.call(h, state, title, url); }
        catch (_) { return undefined; }
      };
    } catch (_) {}
  }
  shimHistoryMethod('pushState');
  shimHistoryMethod('replaceState');
  document.addEventListener('readystatechange', function(){
    var localSubmitActivations = new WeakMap();
    var localSubmitCounts = new WeakMap();
    document.addEventListener('submit', function(e){
      if (e.target instanceof HTMLFormElement) {
        localSubmitCounts.set(e.target, (localSubmitCounts.get(e.target) || 0) + 1);
      }
    }, true);
    function rememberLocalSubmit(e){
      if (!(e.target instanceof Element)) return;
      var control;
      if (e.type === 'click') {
        control = e.target.closest('button, input');
        if (!control || control.type !== 'submit') return;
      } else {
        if (e.key !== 'Enter' || e.isComposing || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
        var input = e.target;
        if (!(input instanceof HTMLInputElement) || !/^(text|email|tel|url|search|password|number)$/.test(input.type)) return;
        var inputForm = input.form;
        if (!inputForm) return;
        control = Array.from(inputForm.elements).find(function(el){
          return (el instanceof HTMLButtonElement || el instanceof HTMLInputElement) && el.type === 'submit' && !el.matches(':disabled');
        });
      }
      if (!control || control.matches(':disabled') || !control.form) return;
      localSubmitActivations.set(e, { form: control.form, submitter: control, count: localSubmitCounts.get(control.form) || 0 });
    }
    function finishLocalSubmit(e){
      var activation = localSubmitActivations.get(e);
      if (!activation) return;
      setTimeout(function(){
        var form = activation.form;
        var submitter = activation.submitter;
        if (e.defaultPrevented || !form.isConnected || submitter.matches(':disabled')) return;
        if ((localSubmitCounts.get(form) || 0) !== activation.count) return;
        if (!form.noValidate && !submitter.formNoValidate && !form.reportValidity()) return;
        form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: submitter }));
      }, 0);
    }
    ['click', 'keydown'].forEach(function(type){
      document.addEventListener(type, rememberLocalSubmit, true);
      document.addEventListener(type, finishLocalSubmit);
    });
    function setLocalHash(hash){
      if (location.hash === hash) return;
      if (location.protocol === 'blob:') {
        var oldUrl = location.href;
        try {
          history.pushState(null, '', oldUrl.split('#')[0] + hash);
          if (location.hash === hash) {
            window.dispatchEvent(new HashChangeEvent('hashchange', { oldURL: oldUrl, newURL: location.href }));
          }
        } catch (_) {}
        return;
      }
      location.hash = hash;
    }
    document.addEventListener('click', function(e){
      if (e.defaultPrevented) return;
      if (!e.target || !(e.target instanceof Element)) return;
      var link = e.target.closest('a[href]');
      if (!link) return;
      var href = link.getAttribute('href');
      if (href === null) return;
      var isAnchor = href.indexOf('#') === 0 || href === '';
      if (isAnchor) {
        e.preventDefault();
        if (href === '' || href === '#') {
          window.scrollTo({ top: 0 });
          history.replaceState(null, '', ' ');
        } else {
          var targetId = href.slice(1);
          var target = targetId ? document.getElementById(targetId) : null;
          if (target) {
            target.scrollIntoView();
            if (location.hash === href) history.replaceState(null, '', ' ');
            setLocalHash(href);
          } else {
            setLocalHash(href);
          }
        }
      } else if (link.getAttribute('target') === '_blank') {
        e.preventDefault();
        var safe = false;
        try {
          var parsedUrl = new URL(href, location.href);
          safe = parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:' || parsedUrl.protocol === 'mailto:';
        } catch (_) {}
        if (safe) window.open(href, '_blank', 'noopener,noreferrer');
      }
    });
  }, { once: true });
})();</script>`;
}
