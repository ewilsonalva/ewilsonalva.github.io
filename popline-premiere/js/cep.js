/*
 * Minimal stand-in for Adobe's CSInterface.js: just the two calls Popline needs.
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

    /** Native folder/file picker (CEP). Returns a path or null. */
    pickFile: function (title, exts) {
      if (!window.cep || !window.cep.fs) return null;
      var r = window.cep.fs.showOpenDialogEx(false, false, title, '', exts || []);
      return r && r.data && r.data.length ? r.data[0] : null;
    },
    pickFiles: function (title, exts) {
      if (!window.cep || !window.cep.fs) return null;
      var r = window.cep.fs.showOpenDialogEx(true, false, title, '', exts || []);
      return r && r.data ? r.data : null;
    },
    pickFolder: function (title) {
      if (!window.cep || !window.cep.fs) return null;
      var r = window.cep.fs.showOpenDialogEx(false, true, title, '', []);
      return r && r.data && r.data.length ? r.data[0] : null;
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
