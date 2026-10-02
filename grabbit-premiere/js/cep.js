/*
 * Minimal stand-in for Adobe's CSInterface.js: just the two calls Grabbit needs.
 * window.__adobe_cep__ is injected by Premiere's CEP runtime.
 */
(function () {
  var cep = window.__adobe_cep__;

  window.Host = {
    available: !!cep,

    /** Absolute filesystem path of the extension folder. */
    extensionRoot: function () {
      if (!cep) return '';
      var p = cep.getSystemPath('extension');
      p = decodeURIComponent(p.replace(/^file:\/\/\//, navigator.platform.indexOf('Win') === 0 ? '' : '/').replace(/^file:\/\//, ''));
      return p;
    },

    /** Ask Premiere to pass Ctrl/Cmd+V to the panel instead of swallowing it as its own Paste. */
    keyInterest: function () {
      if (!cep || !cep.registerKeyEventsInterest) return;
      var win = navigator.platform.indexOf('Win') === 0;
      cep.registerKeyEventsInterest(JSON.stringify(win
        ? [{ keyCode: 86, ctrlKey: true }]          // VK_V
        : [{ keyCode: 9, metaKey: true }]));        // kVK_ANSI_V
    },

    /** Call an ExtendScript function by name; args are passed as JSON literals. Resolves to the parsed JSON result. */
    call: function (fn, args) {
      return new Promise(function (resolve, reject) {
        if (!cep) return reject(new Error('Not running inside Premiere Pro.'));
        var script = fn + '(' + (args || []).map(function (a) { return JSON.stringify(a); }).join(',') + ')';
        cep.evalScript(script, function (res) {
          if (res === 'EvalScript error.') return reject(new Error('ExtendScript error calling ' + fn + '. Is host.jsx loaded?'));
          try { resolve(JSON.parse(res)); } catch (e) { reject(new Error('Bad reply from host: ' + res)); }
        });
      });
    }
  };
})();
