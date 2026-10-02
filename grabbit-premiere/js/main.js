/* Grabbit panel UI. Runs in Premiere's CEF with Node enabled (mixed context). */
(function () {
  'use strict';

  var path = require('path');
  var os = require('os');
  var extRoot = Host.extensionRoot() || path.resolve(__dirname || '.', '..');
  var core = require(path.join(extRoot, 'js', 'core.js'));

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    query: $('query'), go: $('goBtn'), results: $('results'),
    inPoint: $('inPoint'), outPoint: $('outPoint'), quality: $('quality'),
    placeMode: $('placeMode'), encodeMode: $('encodeMode'), binName: $('binName'),
    grab: $('grabBtn'), cancel: $('cancelBtn'), folder: $('folderBtn'),
    outDir: $('outDir'), cookies: $('cookies'), keepOriginal: $('keepOriginal'),
    tools: $('tools'), update: $('updateBtn'), recheck: $('recheckBtn'),
    log: $('log'), status: $('status'), bar: $('barFill'), steps: $('steps'), hostState: $('hostState')
  };

  var tools = {};
  var job = null;          // current cancellable child job
  var busy = false;
  var selectedUrl = null;  // URL picked from search results
  var lastFolder = null;

  /* ---------------------------------------------------------- settings */

  var SAVED = ['quality', 'placeMode', 'encodeMode', 'binName', 'outDir', 'cookies'];
  function loadSettings() {
    try {
      var s = JSON.parse(localStorage.getItem('grabbit.settings') || '{}');
      SAVED.forEach(function (k) { if (s[k] != null) el[k].value = s[k]; });
      el.keepOriginal.checked = !!s.keepOriginal;
    } catch (e) {}
  }
  function saveSettings() {
    try {
      var s = { keepOriginal: el.keepOriginal.checked };
      SAVED.forEach(function (k) { s[k] = el[k].value; });
      localStorage.setItem('grabbit.settings', JSON.stringify(s));
    } catch (e) {}
  }
  SAVED.concat(['keepOriginal']).forEach(function (k) { el[k].addEventListener('change', saveSettings); });

  /* ---------------------------------------------------------- ui helpers */

  function log(line, cls) {
    var span = document.createElement('span');
    if (cls) span.className = cls;
    span.textContent = line + '\n';
    el.log.appendChild(span);
    while (el.log.childNodes.length > 400) el.log.removeChild(el.log.firstChild);
    el.log.scrollTop = el.log.scrollHeight;
  }
  function status(text) { el.status.textContent = text; }
  function bar(pct) { el.bar.style.width = (pct == null ? 0 : Math.max(0, Math.min(100, pct))) + '%'; }

  var STEP_ORDER = ['fetch', 'encode', 'timeline'];
  var currentStep = null;
  function step(name, state) {
    currentStep = name;
    var idx = STEP_ORDER.indexOf(name);
    Array.prototype.forEach.call(el.steps.children, function (li, i) {
      li.className = '';
      if (name == null) return;
      if (i < idx) li.className = 'done';
      else if (i === idx) li.className = state || 'active';
    });
  }

  function setBusy(b) {
    busy = b;
    el.grab.disabled = b;
    el.go.disabled = b;
    el.cancel.hidden = !b;
    document.body.classList.toggle('busy', b);
  }

  function updateGoLabel() {
    el.go.textContent = core.looksLikeUrl(el.query.value) ? 'GRAB' : 'SEARCH';
  }

  function fmtBytes(n) {
    if (!n) return '';
    var u = ['B', 'KB', 'MB', 'GB'], i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return n.toFixed(i ? 1 : 0) + ' ' + u[i];
  }

  /* ---------------------------------------------------------- tools */

  function checkTools() {
    tools = core.resolveTools(extRoot);
    el.tools.innerHTML = '';
    [['yt-dlp', 'ytdlp', true], ['ffmpeg', 'ffmpeg', true], ['ffprobe', 'ffprobe', true], ['deno', 'deno', false]].forEach(function (t) {
      var p = tools[t[1]];
      var row = document.createElement('div');
      row.className = p ? 'ok' : (t[2] ? 'missing' : 'optional');
      row.textContent = (p ? '✓ ' : '✗ ') + t[0] + ': ' + (p || (t[2] ? 'not found' : 'not found (recommended for YouTube)'));
      row.title = p || '';
      el.tools.appendChild(row);
    });
    if (tools.ytdlp) {
      core.version(tools.ytdlp, ['--version']).then(function (v) {
        el.tools.firstChild.textContent += '  (' + v + ')';
      }).catch(function () {});
    }
    var missing = ['ytdlp', 'ffmpeg', 'ffprobe'].filter(function (k) { return !tools[k]; });
    if (missing.length) {
      log('Missing tools: ' + missing.join(', ').replace('ytdlp', 'yt-dlp') + '. Run the installer in install/, or put them in ' + path.join(extRoot, 'bin'), 'err');
    }
    return missing.length === 0;
  }

  /* ---------------------------------------------------------- search */

  function renderResults(items) {
    el.results.innerHTML = '';
    el.results.hidden = false;
    if (!items.length) {
      el.results.innerHTML = '<p class="empty">No results.</p>';
      return;
    }
    items.forEach(function (r) {
      var card = document.createElement('div');
      card.className = 'result';
      card.tabIndex = 0;
      var img = document.createElement('img');
      img.src = r.thumbnail;
      img.alt = '';
      img.loading = 'lazy';
      var dur = document.createElement('span');
      dur.className = 'dur';
      dur.textContent = core.formatDuration(r.duration);
      var thumb = document.createElement('div');
      thumb.className = 'thumb';
      thumb.appendChild(img);
      if (r.duration) thumb.appendChild(dur);
      var meta = document.createElement('div');
      meta.className = 'meta';
      var t = document.createElement('div');
      t.className = 'title';
      t.textContent = r.title;
      var c = document.createElement('div');
      c.className = 'chan';
      c.textContent = r.channel + (r.views ? ' · ' + Number(r.views).toLocaleString() + ' views' : '');
      meta.appendChild(t);
      meta.appendChild(c);
      var btn = document.createElement('button');
      btn.className = 'btn small';
      btn.textContent = 'GRAB';
      card.appendChild(thumb);
      card.appendChild(meta);
      card.appendChild(btn);

      function select() {
        Array.prototype.forEach.call(el.results.querySelectorAll('.result'), function (n) { n.classList.remove('sel'); });
        card.classList.add('sel');
        selectedUrl = r.url;
        status('Selected: ' + r.title);
      }
      card.addEventListener('click', select);
      card.addEventListener('dblclick', function () { select(); grab(); });
      card.addEventListener('keydown', function (e) { if (e.key === 'Enter') { select(); grab(); } });
      btn.addEventListener('click', function (e) { e.stopPropagation(); select(); grab(); });
      el.results.appendChild(card);
    });
  }

  function doSearch() {
    var q = el.query.value.trim();
    if (!q) return;
    if (!tools.ytdlp) { checkTools(); if (!tools.ytdlp) return; }
    setBusy(true);
    step(null);
    bar(null);
    status('Searching YouTube for "' + q + '"…');
    el.results.hidden = false;
    el.results.innerHTML = '<p class="empty">Searching…</p>';
    core.search(tools, q, 15).then(function (items) {
      renderResults(items);
      status(items.length + ' results. Click to select, double-click or GRAB to bring it in.');
    }).catch(function (err) {
      el.results.innerHTML = '<p class="empty">Search failed.</p>';
      status('Search failed.');
      log(err.message, 'err');
    }).then(function () { setBusy(false); });
  }

  /* ---------------------------------------------------------- grab */

  function downloadDir() {
    var custom = el.outDir.value.trim();
    if (custom) return Promise.resolve(custom);
    return Host.call('grabbit_projectInfo').then(function (info) {
      if (info.ok && info.projectPath) return path.join(path.dirname(info.projectPath), 'Grabbit Downloads');
      return path.join(os.homedir(), 'Documents', 'Grabbit Downloads');
    }).catch(function () { return path.join(os.homedir(), 'Documents', 'Grabbit Downloads'); });
  }

  function track(j) { job = j; return j.promise; }

  function grab() {
    if (busy) return;
    var raw = el.query.value.trim();
    var url = core.looksLikeUrl(raw) ? core.normalizeUrl(raw) : selectedUrl;
    if (!url) {
      if (raw) return doSearch();
      status('Paste a link or search first.');
      return;
    }
    var inSecs, outSecs;
    try {
      inSecs = core.parseTimecode(el.inPoint.value);
      outSecs = core.parseTimecode(el.outPoint.value);
      core.sectionArg(inSecs, outSecs);
    } catch (e) {
      status(e.message);
      return;
    }
    if (!checkTools()) { status('Missing tools — see the log.'); return; }

    var mode = el.encodeMode.value;
    var place = el.placeMode.value;
    var t0 = Date.now();
    setBusy(true);
    step('fetch');
    bar(0);
    status('Contacting site…');
    log('— ' + url, 'head');

    var file;
    downloadDir().then(function (dir) {
      lastFolder = dir;
      log('Saving to ' + dir, 'dim');
      return track(core.download(tools, {
        url: url, outDir: dir, maxHeight: el.quality.value,
        inSecs: inSecs, outSecs: outSecs, cookiesFromBrowser: el.cookies.value
      }, {
        onLine: function (l) { log(l); },
        onProgress: function (p) {
          if (p.percent != null) bar(p.percent);
          status('Downloading… ' + (p.percent != null ? p.percent.toFixed(1) + '%' : fmtBytes(p.downloaded)) +
            (p.speed ? '  ' + fmtBytes(p.speed) + '/s' : '') + (p.eta != null ? '  ETA ' + core.formatDuration(p.eta) : ''));
        }
      }));
    }).then(function (f) {
      file = f;
      log('Downloaded: ' + f, 'ok');
      step('encode');
      bar(0);
      if (mode === 'never') return f;
      status('Checking codecs…');
      return core.probe(tools, f).then(function (info) {
        log('Source: ' + [info.vcodec, info.pixFmt, info.width && info.width + 'x' + info.height, info.acodec].filter(Boolean).join(', '), 'dim');
        if (!core.needsEncode(info, mode)) {
          log('Already edit-friendly, skipping encode.', 'dim');
          bar(100);
          return f;
        }
        var target = mode === 'prores' ? 'prores' : 'h264';
        status('Encoding to ' + (target === 'prores' ? 'ProRes 422' : 'H.264') + '…');
        return track(core.encode(tools, f, target, info, {
          onLine: function (l) { log(l, 'dim'); },
          onProgress: function (p) { bar(p.percent); status('Encoding… ' + p.percent.toFixed(1) + '%'); }
        }, el.keepOriginal.checked));
      });
    }).then(function (finalFile) {
      file = finalFile;
      job = null;
      el.cancel.hidden = true;
      step('timeline');
      bar(100);
      status('Importing into Premiere…');
      return Host.call('grabbit_importAndPlace', [finalFile, place, el.binName.value.trim() || 'Grabbit']);
    }).then(function (res) {
      if (!res.ok) throw new Error(res.error);
      var where = {
        insert: 'inserted at the playhead on ' + res.track,
        overwrite: 'overwritten at the playhead on ' + res.track,
        append: 'appended to the end on ' + res.track,
        project: 'added to the "' + res.bin + '" bin',
        'new-sequence': 'placed in new sequence "' + res.sequence + '"'
      }[res.placed];
      step('timeline', 'done');
      status('Done in ' + Math.round((Date.now() - t0) / 1000) + 's — ' + res.clip + ' ' + where + '.');
      log('Done: ' + res.clip + ' ' + where, 'ok');
    }).catch(function (err) {
      if (currentStep) step(currentStep, 'fail');
      status(err.cancelled ? 'Cancelled.' : 'Failed — see log.');
      log(err.message, err.cancelled ? 'dim' : 'err');
      if (!err.cancelled && /Sign in to confirm|bot/i.test(err.message)) {
        log('Tip: set "Cookies from browser" in Settings to a browser where you are signed in to YouTube.', 'dim');
      }
      if (!err.cancelled && /HTTP Error 403|nsig|Requested format is not available|Unsupported URL/i.test(err.message)) {
        log('Tip: sites change often. Try Settings → UPDATE YT-DLP, and install deno for YouTube.', 'dim');
      }
    }).then(function () {
      job = null;
      setBusy(false);
    });
  }

  /* ---------------------------------------------------------- wiring */

  el.query.addEventListener('input', function () { selectedUrl = null; updateGoLabel(); });
  el.query.addEventListener('keydown', function (e) { if (e.key === 'Enter') el.go.click(); });
  el.query.addEventListener('paste', function () { setTimeout(updateGoLabel, 0); });
  el.go.addEventListener('click', function () {
    if (core.looksLikeUrl(el.query.value)) grab(); else doSearch();
  });
  el.grab.addEventListener('click', grab);
  el.cancel.addEventListener('click', function () { if (job) job.cancel(); });
  el.folder.addEventListener('click', function () {
    var p = lastFolder ? Promise.resolve(lastFolder) : downloadDir();
    p.then(function (d) {
      require('fs').mkdirSync(d, { recursive: true });
      core.openFolder(d);
    });
  });
  el.recheck.addEventListener('click', function () { checkTools(); log('Tools re-checked.', 'dim'); });
  el.update.addEventListener('click', function () {
    if (!tools.ytdlp) { log('yt-dlp not found.', 'err'); return; }
    if (busy) return;
    setBusy(true);
    log('Updating yt-dlp…', 'head');
    track(core.run(tools.ytdlp, ['-U'], function (l) { log(l); })).then(function () {
      log('yt-dlp is up to date.', 'ok');
    }).catch(function (err) {
      log(err.message, 'err');
      log('If yt-dlp was installed with pip/brew/winget, update it with that tool instead.', 'dim');
    }).then(function () { setBusy(false); checkTools(); });
  });

  // Mask-free timecode entry: allow digits, ":" and "."
  [el.inPoint, el.outPoint].forEach(function (inp) {
    inp.addEventListener('input', function () { inp.value = inp.value.replace(/[^\d:.]/g, ''); });
  });

  /* ---------------------------------------------------------- boot */

  loadSettings();
  updateGoLabel();
  log('Grabbit ready. Extension root: ' + extRoot, 'dim');
  log('Tools are used from bin/ when present, otherwise from PATH.', 'dim');
  checkTools();
  Host.call('grabbit_ping').then(function (r) {
    el.hostState.textContent = 'ready';
    el.hostState.className = 'pill on';
    log('Connected to Premiere Pro ' + r.version, 'dim');
  }).catch(function (err) {
    el.hostState.textContent = 'no host';
    el.hostState.className = 'pill off';
    log(err.message, 'err');
  });
})();
