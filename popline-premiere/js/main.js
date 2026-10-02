/* Popline panel UI. Runs in Premiere's CEF with Node enabled (mixed context). */
(function () {
  'use strict';

  var path = require('path');
  var os = require('os');
  var fs = require('fs');
  var extRoot = Host.extensionRoot() || path.resolve(__dirname || '.', '..');
  var C = require(path.join(extRoot, 'js', 'captions.js'));
  var T = require(path.join(extRoot, 'js', 'transcribe.js'));
  var R = require(path.join(extRoot, 'js', 'render.js'));
  var U = require(path.join(extRoot, 'js', 'util.js'));

  var $ = function (id) { return document.getElementById(id); };
  var el = {};
  ['seqPill', 'previewImg', 'previewVid', 'previewEmpty', 'previewBusy', 'prevCap', 'nextCap', 'capCounter', 'playBtn', 'tabs', 'barFill',
    'status', 'source', 'language', 'engine', 'model', 'apiKey', 'dlModel', 'dlBtn', 'prompt', 'inOut', 'fillers', 'translate',
    'transcribeBtn', 'cancelBtn', 'tools', 'fillerBtn', 'syncEarly', 'syncLate', 'syncTotal', 'findText', 'replaceText', 'replaceBtn',
    'capList', 'presets', 'presetName', 'savePreset', 's_font', 'overlayBtn', 'nativeBtn', 'mogrtBtn', 'srtBtn', 'assBtn', 'txtBtn',
    'folderBtn', 'log', 'screen'].forEach(function (id) { el[id] = $(id); });

  var tools = {};
  var seq = null;          // popline_sequenceInfo()
  var doc = null;          // the caption document for this sequence (saved as popline.json)
  var caps = [];           // captions derived from doc.words + doc.style
  var sel = 0;             // selected caption
  var busy = false;
  var job = null;          // current cancellable job
  var style = C.withDefaults(C.PRESETS[0].style);
  var presetId = C.PRESETS[0].id;

  /* ---------------------------------------------------------- small helpers */

  function log(line, cls) {
    var span = document.createElement('span');
    if (cls) span.className = cls;
    span.textContent = line + '\n';
    el.log.appendChild(span);
    while (el.log.childNodes.length > 400) el.log.removeChild(el.log.firstChild);
    el.log.scrollTop = el.log.scrollHeight;
  }
  function status(text, cls) { el.status.textContent = text; el.status.style.color = cls === 'err' ? 'var(--err)' : ''; }
  function bar(pct) { el.barFill.style.width = (pct == null ? 0 : Math.max(0, Math.min(100, pct))) + '%'; }
  function fmt(t) {
    var m = Math.floor(t / 60), s = t - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1);
  }
  function safe(s) { return String(s || 'Sequence').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'Sequence'; }
  function setBusy(b) {
    busy = b;
    [el.transcribeBtn, el.overlayBtn, el.nativeBtn, el.mogrtBtn, el.dlBtn].forEach(function (x) { x.disabled = b; });
    el.cancelBtn.hidden = !b;
    document.body.classList.toggle('busy', b);
  }
  function track(j) { job = j; return j.promise; }

  function guarded(label, fn) {
    if (busy) return Promise.resolve();
    setBusy(true);
    bar(0);
    log('— ' + label, 'head');
    return Promise.resolve().then(fn).then(function (msg) {
      bar(100);
      if (msg) { status(msg); log(msg, 'ok'); }
    }).catch(function (err) {
      bar(0);
      status(err.cancelled ? 'Cancelled.' : err.message, err.cancelled ? '' : 'err');
      log(err.message, err.cancelled ? 'dim' : 'err');
    }).then(function () { job = null; setBusy(false); });
  }

  /* ---------------------------------------------------------- settings */

  var SETTINGS = ['engine', 'model', 'language', 'apiKey', 'source'];
  var CHECKS = ['inOut', 'fillers', 'translate'];
  function loadSettings() {
    try {
      var s = JSON.parse(localStorage.getItem('popline.settings') || '{}');
      SETTINGS.forEach(function (k) { if (s[k] != null) el[k].dataset.want = s[k]; if (s[k] != null) el[k].value = s[k]; });
      CHECKS.forEach(function (k) { if (s[k] != null) el[k].checked = !!s[k]; });
      if (s.style) { style = C.withDefaults(s.style); presetId = s.presetId || null; }
    } catch (e) {}
  }
  function saveSettings() {
    try {
      var s = { style: style, presetId: presetId };
      SETTINGS.forEach(function (k) { s[k] = el[k].value; });
      CHECKS.forEach(function (k) { s[k] = el[k].checked; });
      localStorage.setItem('popline.settings', JSON.stringify(s));
    } catch (e) {}
  }
  SETTINGS.concat(CHECKS).forEach(function (k) { el[k].addEventListener('change', function () { saveSettings(); if (k === 'engine') showEngine(); }); });

  function showEngine() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-engine]'), function (n) { n.hidden = n.getAttribute('data-engine') !== el.engine.value; });
  }

  /* ---------------------------------------------------------- tabs */

  function showTab(name) {
    Array.prototype.forEach.call(el.tabs.children, function (b) { b.classList.toggle('on', b.getAttribute('data-tab') === name); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-panel]'), function (p) { p.hidden = p.getAttribute('data-panel') !== name; });
  }
  el.tabs.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (b) { showTab(b.getAttribute('data-tab')); refreshSequence(); }
  });

  /* ---------------------------------------------------------- tools & models */

  function checkTools() {
    tools = U.resolveTools(extRoot);
    el.tools.innerHTML = '';
    [['ffmpeg', 'ffmpeg'], ['whisper.cpp', 'whisper']].forEach(function (t) {
      var p = tools[t[1]];
      var row = document.createElement('div');
      row.className = p ? 'ok' : 'missing';
      row.textContent = (p ? '✓ ' : '✗ ') + t[0] + ': ' + (p || 'not found');
      el.tools.appendChild(row);
    });
    if (!tools.ffmpeg) log('ffmpeg not found. Run the installer in install/ or put ffmpeg in ' + path.join(extRoot, 'bin'), 'err');
    if (!tools.whisper) log('whisper.cpp not found. Run the installer, or use the OpenAI engine.', 'dim');
  }

  function refreshModels() {
    var have = T.installedModels(extRoot);
    var want = el.model.dataset.want || el.model.value;
    el.model.innerHTML = '';
    if (!have.length) el.model.innerHTML = '<option value="">No model yet: download one below</option>';
    have.forEach(function (m) {
      var o = document.createElement('option');
      o.value = m.path;
      o.textContent = m.label;
      el.model.appendChild(o);
    });
    if (want && have.some(function (m) { return m.path === want; })) el.model.value = want;
    el.dlModel.innerHTML = '';
    T.MODELS.forEach(function (m) {
      if (have.some(function (h) { return path.basename(h.path) === m.file; })) return;
      var o = document.createElement('option');
      o.value = m.id;
      o.textContent = m.label;
      el.dlModel.appendChild(o);
    });
    el.dlModel.disabled = el.dlBtn.disabled = !el.dlModel.options.length;
    if (!el.dlModel.options.length) el.dlModel.innerHTML = '<option>All models installed</option>';
    else el.dlModel.value = have.length ? el.dlModel.options[0].value : (el.dlModel.querySelector('[value="base"]') ? 'base' : el.dlModel.options[0].value);
  }

  el.dlBtn.addEventListener('click', function () {
    var id = el.dlModel.value;
    guarded('download model ' + id, function () {
      status('Downloading model ' + id + '…');
      return T.downloadModel(id, extRoot, function (pct, done, total) {
        bar(pct);
        status('Downloading model ' + id + '… ' + pct.toFixed(0) + '% of ' + Math.round(total / 1e6) + ' MB');
      }).then(function (p) {
        el.model.dataset.want = p;
        refreshModels();
        saveSettings();
        return 'Model ready: ' + path.basename(p);
      });
    });
  });

  /* ---------------------------------------------------------- sequence & document */

  function workDir() {
    var base = seq && seq.projectPath ? path.join(path.dirname(seq.projectPath), 'Popline') : path.join(os.homedir(), 'Documents', 'Popline');
    return path.join(base, safe(seq ? seq.name : 'Sequence') + (seq ? ' [' + String(seq.id).slice(0, 8) + ']' : ''));
  }
  function docPath() { return path.join(workDir(), 'popline.json'); }

  var saveTimer = null;
  function saveDoc() {
    if (!doc) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try {
        doc.style = style;
        doc.presetId = presetId;
        fs.mkdirSync(workDir(), { recursive: true });
        fs.writeFileSync(docPath(), JSON.stringify(doc, null, 1));
      } catch (e) { log('Could not save: ' + e.message, 'err'); }
    }, 300);
  }

  function loadDoc() {
    try {
      var d = JSON.parse(fs.readFileSync(docPath(), 'utf8'));
      if (d && d.words) {
        doc = d;
        if (d.style) style = C.withDefaults(d.style);
        presetId = d.presetId || null;
        log('Loaded ' + d.words.length + ' words for "' + seq.name + '".', 'dim');
        return true;
      }
    } catch (e) {}
    return false;
  }

  function refreshSequence() {
    return Host.call('popline_sequenceInfo').then(function (info) {
      if (!info.ok) {
        seq = null;
        el.seqPill.textContent = 'no sequence';
        el.seqPill.className = 'pill off';
        return;
      }
      var changed = !seq || seq.id !== info.id;
      seq = info;
      el.seqPill.textContent = info.name + ' · ' + info.width + '×' + info.height;
      el.seqPill.className = 'pill on';
      el.screen.style.aspectRatio = info.width + ' / ' + info.height;
      var cur = el.source.value || el.source.dataset.want;
      el.source.innerHTML = '<option value="selected">Selected clips</option>' + info.audioTracks.map(function (n, i) {
        return '<option value="track:' + i + '">Audio track ' + (i + 1) + (n && !/^Audio \d+$/.test(n) ? ' (' + n + ')' : '') + '</option>';
      }).join('');
      if (cur && el.source.querySelector('[value="' + cur + '"]')) el.source.value = cur;
      if (changed) {
        doc = null;
        loadDoc();
        rebuild();
      }
    }).catch(function (e) {
      el.seqPill.textContent = 'no host';
      el.seqPill.className = 'pill off';
    });
  }

  function frame() {
    return { w: seq ? seq.width : 1080, h: seq ? seq.height : 1920, fps: seq ? seq.fps : 30 };
  }

  /* ---------------------------------------------------------- transcribe */

  el.transcribeBtn.addEventListener('click', function () {
    guarded('transcribe', function () {
      checkTools();
      if (!tools.ffmpeg) throw new Error('ffmpeg not found. Run the installer first.');
      return refreshSequence().then(function () {
        if (!seq) throw new Error('Open a sequence first.');
        var src = el.source.value;
        var scope = src === 'selected' ? 'selected' : 'track';
        var trackIdx = scope === 'track' ? parseInt(src.split(':')[1], 10) : 0;
        status('Finding clips…');
        return Host.call('popline_sources', [scope, trackIdx, el.inOut.checked]);
      }).then(function (res) {
        if (!res.ok) throw new Error(res.error);
        var sources = res.sources;
        log('Transcribing ' + sources.length + ' clip(s): ' + sources.map(function (s) { return path.basename(s.mediaPath); }).join(', '), 'dim');
        var wd = path.join(workDir(), 'audio');
        return track(T.transcribeSources(tools, sources, {
          engine: el.engine.value, modelPath: el.model.value, apiKey: el.apiKey.value.trim(),
          language: el.language.value, translate: el.translate.checked, prompt: el.prompt.value.trim(), workDir: wd
        }, {
          onStatus: function (s) { status(s); },
          onProgress: bar,
          onLine: function (l) { log(l, 'dim'); }
        })).then(function (raw) {
          var words = C.normalizeWords(raw);
          var n = words.length;
          if (el.fillers.checked) words = C.removeFillers(words);
          if (!words.length) throw new Error('No speech found in those clips.');
          var spanStart = Math.min.apply(null, sources.map(function (s) { return s.startSec; }));
          var spanEnd = Math.max.apply(null, sources.map(function (s) { return s.endSec; }));
          var prevOverlay = doc && doc.overlay;
          doc = {
            version: 1, created: new Date().toISOString(),
            sequence: { name: seq.name, id: seq.id, width: seq.width, height: seq.height, fps: seq.fps },
            sources: sources, span: { start: spanStart, end: spanEnd }, words: words, sync: 0,
            overlay: prevOverlay || null
          };
          sel = 0;
          rebuild();
          saveDoc();
          showTab('edit');
          return 'Transcribed ' + words.length + ' words' + (n !== words.length ? ' (' + (n - words.length) + ' fillers removed)' : '') + ' into ' + caps.length + ' captions.';
        });
      });
    });
  });
  el.cancelBtn.addEventListener('click', function () { if (job) job.cancel(); });

  /* ---------------------------------------------------------- caption list */

  function rebuild() {
    caps = doc ? C.groupCaptions(doc.words, style) : [];
    if (sel >= caps.length) sel = Math.max(0, caps.length - 1);
    renderList();
    updateCounter();
    el.syncTotal.textContent = doc && doc.sync ? 'shifted ' + (doc.sync > 0 ? '+' : '') + doc.sync.toFixed(1) + 's' : '';
    el.overlayBtn.textContent = doc && doc.overlay ? 'UPDATE CAPTIONS ON TIMELINE' : 'ADD ANIMATED CAPTIONS TO TIMELINE';
    schedulePreview();
  }

  function renderList() {
    el.capList.innerHTML = '';
    if (!caps.length) { el.capList.innerHTML = '<p class="empty">No captions yet. Transcribe first.</p>'; return; }
    var frag = document.createDocumentFragment();
    caps.forEach(function (cap, k) {
      var row = document.createElement('div');
      row.className = 'cap' + (k === sel ? ' sel' : '');
      row.dataset.k = k;
      var t = document.createElement('span');
      t.className = 't';
      t.textContent = fmt(cap.start);
      t.title = 'Jump the playhead here';
      var inp = document.createElement('input');
      inp.type = 'text';
      inp.spellcheck = true;
      inp.value = C.captionEditText(doc.words, cap);
      var acts = document.createElement('div');
      acts.className = 'acts';
      acts.innerHTML = '<button data-a="merge" title="Merge with the caption above">⤒</button><button data-a="del" title="Delete caption">✕</button>';
      row.appendChild(t); row.appendChild(inp); row.appendChild(acts);
      frag.appendChild(row);
    });
    el.capList.appendChild(frag);
  }

  function select(k, seek) {
    if (!caps.length) return;
    sel = Math.max(0, Math.min(caps.length - 1, k));
    Array.prototype.forEach.call(el.capList.children, function (r) { r.classList.toggle('sel', +r.dataset.k === sel); });
    updateCounter();
    schedulePreview();
    if (seek) Host.call('popline_seek', [caps[sel].start]).catch(function () {});
  }

  function updateCounter() {
    el.capCounter.textContent = caps.length ? (sel + 1) + ' / ' + caps.length : (doc ? '0' : 'sample');
  }

  function editCaption(k, text) {
    var before = doc.words.length;
    doc.words = C.applyCaptionEdit(doc.words, caps[k], text);
    if (!doc.words.length) doc.words = [];
    rebuild();
    saveDoc();
    if (doc.words.length !== before) status('Caption updated (' + (doc.words.length - before >= 0 ? '+' : '') + (doc.words.length - before) + ' words).');
  }

  el.capList.addEventListener('focusin', function (e) {
    var row = e.target.closest('.cap');
    if (row && +row.dataset.k !== sel) select(+row.dataset.k, true);
  });
  el.capList.addEventListener('click', function (e) {
    var row = e.target.closest('.cap');
    if (!row) return;
    var k = +row.dataset.k;
    var a = e.target.getAttribute && e.target.getAttribute('data-a');
    if (a === 'del') { editCaption(k, ''); return; }
    if (a === 'merge') {
      if (k === 0) return;
      doc.words = C.mergeWithPrevious(doc.words, caps, k);
      sel = k - 1;
      rebuild();
      saveDoc();
      return;
    }
    if (e.target.classList.contains('t')) select(k, true);
  });
  el.capList.addEventListener('change', function (e) {
    var row = e.target.closest('.cap');
    if (row && e.target.tagName === 'INPUT') editCaption(+row.dataset.k, e.target.value);
  });
  el.capList.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
      e.target.blur();
      var next = el.capList.querySelector('.cap[data-k="' + (+e.target.closest('.cap').dataset.k + 1) + '"] input');
      if (next) next.focus();
    }
  });

  el.prevCap.addEventListener('click', function () { select(sel - 1, true); });
  el.nextCap.addEventListener('click', function () { select(sel + 1, true); });

  el.fillerBtn.addEventListener('click', function () {
    if (!doc) return;
    var n = doc.words.length;
    doc.words = C.removeFillers(doc.words);
    rebuild();
    saveDoc();
    status('Removed ' + (n - doc.words.length) + ' filler words.');
  });
  function sync(d) {
    if (!doc) return;
    doc.words = C.shiftWords(doc.words, d);
    doc.sync = Math.round(((doc.sync || 0) + d) * 10) / 10;
    rebuild();
    saveDoc();
  }
  el.syncEarly.addEventListener('click', function () { sync(-0.1); });
  el.syncLate.addEventListener('click', function () { sync(0.1); });
  el.replaceBtn.addEventListener('click', function () {
    if (!doc) return;
    var find = el.findText.value.trim();
    if (!find) return;
    var re = new RegExp('^' + find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=[^\\w]*$)', 'i');
    var rep = el.replaceText.value.trim();
    var n = 0;
    doc.words.forEach(function (w) {
      if (re.test(w.text)) { w.text = w.text.replace(re, rep); n++; }
    });
    doc.words = doc.words.filter(function (w) { return w.text; });
    rebuild();
    saveDoc();
    status('Replaced ' + n + ' word(s).');
  });

  /* ---------------------------------------------------------- style */

  function customPresets() {
    try { return JSON.parse(localStorage.getItem('popline.presets') || '[]'); } catch (e) { return []; }
  }
  function allPresets() {
    return C.PRESETS.concat(customPresets().map(function (p) { p.custom = true; return p; }));
  }

  function renderPresets() {
    el.presets.innerHTML = '';
    allPresets().forEach(function (p) {
      var s = C.withDefaults(p.style);
      var card = document.createElement('div');
      card.className = 'preset' + (p.id === presetId ? ' on' : '');
      card.dataset.id = p.id;
      var sample = document.createElement('div');
      sample.className = 'sample';
      var txt = s.uppercase ? 'GO VIRAL' : 'Go viral';
      sample.innerHTML = '<span></span> <span></span>';
      sample.children[0].textContent = txt.split(' ')[0];
      sample.children[1].textContent = txt.split(' ')[1];
      sample.style.fontFamily = '"' + s.font + '"';
      if (C.FONTS[s.font] && C.FONTS[s.font].italic) sample.style.fontStyle = 'italic';
      sample.style.color = s.color;
      var stroke = Math.min(3, Math.max(0, s.outline / 3));
      if (stroke) sample.style.webkitTextStroke = stroke + 'px ' + s.outlineColor;
      sample.style.paintOrder = 'stroke fill';
      if (s.glow) sample.style.textShadow = '0 0 8px ' + s.outlineColor;
      else if (s.shadow) sample.style.textShadow = '1px 2px 0 ' + s.shadowColor;
      var hi = sample.children[1];
      if (s.highlight === 'box') { hi.style.background = s.boxColor; hi.style.borderRadius = '3px'; hi.style.padding = '0 3px'; hi.style.webkitTextStroke = '0'; }
      else if (s.highlight !== 'none' || s.rainbow) hi.style.color = s.rainbow ? s.palette[1] : s.accent;
      var name = document.createElement('div');
      name.className = 'name';
      name.textContent = p.label;
      card.title = p.label + ': ' + s.font + ', ' + s.anim + ' in, ' + s.highlight + ' highlight';
      card.appendChild(sample);
      card.appendChild(name);
      if (p.custom) { var del = document.createElement('span'); del.className = 'del'; del.textContent = '✕'; del.title = 'Delete preset'; card.appendChild(del); }
      el.presets.appendChild(card);
    });
  }

  el.presets.addEventListener('click', function (e) {
    var card = e.target.closest('.preset');
    if (!card) return;
    if (e.target.classList.contains('del')) {
      localStorage.setItem('popline.presets', JSON.stringify(customPresets().filter(function (p) { return p.id !== card.dataset.id; })));
      renderPresets();
      return;
    }
    var p = allPresets().filter(function (x) { return x.id === card.dataset.id; })[0];
    if (!p) return;
    var keepY = style.posY;
    style = C.withDefaults(JSON.parse(JSON.stringify(p.style)));
    if (p.custom) keepY = style.posY;
    style.posY = keepY;
    presetId = p.id;
    syncControls();
    renderPresets();
    styleChanged(true);
  });

  el.savePreset.addEventListener('click', function () {
    var name = el.presetName.value.trim() || 'My look ' + (customPresets().length + 1);
    var list = customPresets();
    var id = 'custom-' + Date.now();
    list.push({ id: id, label: name, style: JSON.parse(JSON.stringify(style)) });
    localStorage.setItem('popline.presets', JSON.stringify(list));
    presetId = id;
    el.presetName.value = '';
    renderPresets();
    saveSettings();
    status('Saved preset "' + name + '".');
  });

  var controls = Array.prototype.slice.call(document.querySelectorAll('[data-k]'));
  function syncControls() {
    controls.forEach(function (c) {
      var v = style[c.dataset.k];
      if (c.type === 'checkbox') c.checked = !!v;
      else c.value = String(v);
      showOutput(c);
    });
  }
  function showOutput(c) {
    var o = document.querySelector('output[data-for="' + c.id + '"]');
    if (!o) return;
    var unit = { animMs: ' ms', posY: '%', shadowOpacity: '%' }[c.dataset.k] || '';
    o.textContent = c.value + unit;
  }
  var GROUPING = ['maxWords', 'maxChars', 'lines'];
  controls.forEach(function (c) {
    c.addEventListener('input', function () {
      var k = c.dataset.k;
      var v = c.type === 'checkbox' ? c.checked : c.type === 'range' || k === 'lines' ? Number(c.value) : c.value;
      style[k] = v;
      showOutput(c);
      presetId = null;
      Array.prototype.forEach.call(el.presets.children, function (n) { n.classList.remove('on'); });
      styleChanged(GROUPING.indexOf(k) >= 0);
    });
  });

  function styleChanged(regroup) {
    if (regroup) rebuild(); else schedulePreview();
    saveSettings();
    saveDoc();
  }

  function fillFonts() {
    el.s_font.innerHTML = Object.keys(C.FONTS).map(function (f) {
      return '<option value="' + f + '" style="font-family:\'' + f + '\'">' + f + '</option>';
    }).join('');
  }

  /* ---------------------------------------------------------- preview */

  // Before anything is transcribed the preview shows sample words.
  function sampleWords() {
    var t = 'This is how your captions will look on the timeline'.split(' ');
    var words = t.map(function (w, i) { return { text: w, start: 0.2 + i * 0.34, end: 0.2 + i * 0.34 + 0.3 }; });
    words[3].emph = true;
    return words;
  }

  function previewDir() {
    var d = seq ? path.join(workDir(), 'preview') : path.join(os.tmpdir(), 'popline-preview');
    R.ensureFonts(extRoot, d);
    return d;
  }

  function sourceAt(t) {
    if (!doc || !doc.sources) return null;
    for (var i = 0; i < doc.sources.length; i++) {
      var s = doc.sources[i];
      if (t >= s.startSec && t < s.endSec) return s;
    }
    return doc.sources[0];
  }

  var pvTimer = null, pvGen = 0;
  function schedulePreview() {
    clearTimeout(pvTimer);
    pvTimer = setTimeout(renderPreview, 220);
  }

  function previewSet() {
    var words = doc && doc.words.length ? doc.words : sampleWords();
    var cs = doc && doc.words.length ? caps : C.groupCaptions(words, style);
    var k = doc && doc.words.length ? sel : 0;
    return { words: words, caps: cs, cap: cs[Math.min(k, cs.length - 1)] };
  }

  function renderPreview() {
    if (!tools.ffmpeg) return;
    var gen = ++pvGen;
    var set = previewSet();
    if (!set.cap) return;
    var fr = frame();
    var dir;
    try { dir = previewDir(); } catch (e) { log(e.message, 'err'); return; }
    var dur = set.cap.end - set.cap.start;
    // Show the caption once the in-animation has settled, with a word or two spoken.
    var t = set.cap.start + Math.min(style.animMs / 1000 + 0.12, dur * 0.6);
    fs.writeFileSync(path.join(dir, 'preview.ass'), C.buildAss(set.words, set.caps, style, fr, 0));
    el.previewBusy.hidden = false;
    var src = doc && doc.words.length ? sourceAt(t) : null;
    var bgName = src ? 'bg-' + Math.round(t * 10) + '.png' : null;
    var bg = bgName ? path.join(dir, bgName) : null;
    var bgReady = !src || U.isFile(bg) ? Promise.resolve() : R.grabBackground(tools, src, t, fr, bg).catch(function () { bg = null; });
    bgReady.then(function () {
      return R.renderPreviewFrame(tools, dir, 'preview.ass', fr, t, bg, 'frame.png', 540);
    }).then(function (png) {
      if (gen !== pvGen) return;
      el.previewVid.pause();
      el.previewVid.hidden = true;
      el.previewImg.src = 'file:///' + png.replace(/\\/g, '/').replace(/^\//, '') + '?v=' + gen;
      el.previewImg.hidden = false;
      el.previewEmpty.hidden = true;
    }).catch(function (e) {
      if (gen === pvGen) log('Preview: ' + e.message, 'err');
    }).then(function () { if (gen === pvGen) el.previewBusy.hidden = true; });
  }

  el.playBtn.addEventListener('click', function () {
    if (!tools.ffmpeg) return;
    var set = previewSet();
    if (!set.cap) return;
    var fr = frame();
    var dir = previewDir();
    var gen = ++pvGen;
    fs.writeFileSync(path.join(dir, 'preview.ass'), C.buildAss(set.words, set.caps, style, fr, 0));
    var t0 = Math.max(0, set.cap.start - 0.1), t1 = set.cap.end + 0.15;
    var src = doc && doc.words.length ? sourceAt(set.cap.start) : null;
    var bg = src ? path.join(dir, 'bg-play.png') : null;
    el.previewBusy.hidden = false;
    (src ? R.grabBackground(tools, src, (t0 + t1) / 2, fr, bg).catch(function () { bg = null; }) : Promise.resolve()).then(function () {
      return R.renderPreviewClip(tools, dir, 'preview.ass', fr, t0, t1, bg, 'play-' + (gen % 2) + '.webm', 432);
    }).then(function (webm) {
      if (gen !== pvGen) return;
      el.previewImg.hidden = true;
      el.previewVid.hidden = false;
      el.previewVid.loop = true;
      el.previewVid.src = 'file:///' + webm.replace(/\\/g, '/').replace(/^\//, '') + '?v=' + gen;
      el.previewVid.play().catch(function () {});
    }).catch(function (e) { log('Preview: ' + e.message, 'err'); })
      .then(function () { el.previewBusy.hidden = true; });
  });

  /* ---------------------------------------------------------- add to Premiere */

  function needCaptions() {
    if (!doc || !caps.length) throw new Error('Transcribe something first.');
    if (!seq) throw new Error('Open a sequence first.');
  }

  el.overlayBtn.addEventListener('click', function () {
    guarded('animated captions', function () {
      checkTools();
      return refreshSequence().then(function () {
        needCaptions();
        if (seq.id !== doc.sequence.id) throw new Error('These captions belong to "' + doc.sequence.name + '". Open that sequence first.');
        var wd = workDir();
        R.ensureFonts(extRoot, wd);
        var fr = frame();
        var span = doc.span;
        var lastCapEnd = caps[caps.length - 1].end;
        var spanEnd = Math.max(span.end, lastCapEnd);
        var dur = spanEnd - span.start;
        fs.writeFileSync(path.join(wd, 'captions.ass'), C.buildAss(doc.words, caps, style, fr, span.start));
        var rev = (doc.overlay && doc.overlay.rev || 0) + 1;
        var out = path.join(wd, 'Popline Captions v' + rev + '.mov');
        status('Rendering captions (' + Math.round(dur) + 's)…');
        var t0 = Date.now();
        return track(R.renderOverlay(tools, wd, 'captions.ass', fr, dur, out, {
          onProgress: function (p) { bar(p); status('Rendering captions… ' + p.toFixed(0) + '%'); }
        })).then(function () {
          log('Rendered ' + path.basename(out) + ' in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's', 'dim');
          job = null;
          status('Placing on the timeline…');
          var old = doc.overlay && doc.overlay.path;
          var step = old ? Host.call('popline_relinkOverlay', [old, out]).then(function (r) {
            if (r.ok) {
              try { fs.unlinkSync(old); } catch (e) {}  // Premiere may still hold it; harmless if it stays
              return 'Updated the captions on the timeline (' + caps.length + ' captions).';
            }
            if (!r.notFound) throw new Error(r.error);
            return null;
          }) : Promise.resolve(null);
          return step.then(function (msg) {
            if (msg) return msg;
            return Host.call('popline_placeOverlay', [out, span.start, dur, 'Popline Captions']).then(function (r) {
              if (!r.ok) throw new Error(r.error);
              return 'Added ' + caps.length + ' animated captions on ' + r.track + '.';
            });
          }).then(function (msg) {
            doc.overlay = { path: out, rev: rev };
            saveDoc();
            el.overlayBtn.textContent = 'UPDATE CAPTIONS ON TIMELINE';
            return msg;
          });
        });
      });
    });
  });

  function exportFile(ext, content) {
    var f = path.join(workDir(), safe(seq ? seq.name : 'captions') + '.' + ext);
    fs.mkdirSync(workDir(), { recursive: true });
    fs.writeFileSync(f, content);
    return f;
  }

  el.nativeBtn.addEventListener('click', function () {
    guarded('Premiere captions', function () {
      return refreshSequence().then(function () {
        needCaptions();
        var srt = exportFile('srt', C.buildSrt(doc.words, caps, style));
        return Host.call('popline_importCaptions', [srt, 'Popline Captions']).then(function (r) {
          if (!r.ok) throw new Error(r.error);
          return 'Added a caption track with ' + caps.length + ' captions. Style it in Essential Graphics.';
        });
      });
    });
  });

  el.mogrtBtn.addEventListener('click', function () {
    var file = Host.pickFile('Choose a Motion Graphics Template', ['mogrt']);
    if (!file) return;
    guarded('MOGRT captions', function () {
      return refreshSequence().then(function () {
        needCaptions();
        var items = caps.map(function (c) {
          var text = [];
          for (var i = c.from; i <= c.to; i++) text.push(style.uppercase ? doc.words[i].text.toUpperCase() : doc.words[i].text);
          return { start: c.start, end: c.end, text: text.join(' ') };
        });
        status('Placing ' + items.length + ' templates…');
        return Host.call('popline_placeMogrt', [file, items]).then(function (r) {
          if (!r.ok) throw new Error(r.error);
          var msg = 'Placed ' + r.placed + ' templates on ' + r.track + '.';
          if (r.textSet < r.placed) msg += ' ' + (r.placed - r.textSet) + ' had no text field Popline could fill.';
          return msg;
        });
      });
    });
  });

  function exportBtn(ext, build) {
    return function () {
      try {
        needCaptions();
        var f = exportFile(ext, build());
        status('Saved ' + f);
        log('Saved ' + f, 'ok');
      } catch (e) { status(e.message, 'err'); }
    };
  }
  el.srtBtn.addEventListener('click', exportBtn('srt', function () { return C.buildSrt(doc.words, caps, style); }));
  el.assBtn.addEventListener('click', exportBtn('ass', function () { return C.buildAss(doc.words, caps, style, frame(), 0); }));
  el.txtBtn.addEventListener('click', exportBtn('txt', function () { return C.plainText(doc.words) + '\n'; }));
  el.folderBtn.addEventListener('click', function () {
    var d = workDir();
    fs.mkdirSync(d, { recursive: true });
    U.openFolder(d);
  });

  /* ---------------------------------------------------------- boot */

  window.addEventListener('focus', function () { refreshSequence(); });
  fillFonts();
  loadSettings();
  showEngine();
  checkTools();
  refreshModels();
  syncControls();
  renderPresets();
  rebuild();
  log('Popline ready. Extension root: ' + extRoot, 'dim');
  Host.call('popline_ping').then(function (r) {
    log('Connected to Premiere Pro ' + r.version, 'dim');
    return refreshSequence();
  }).catch(function (err) {
    el.seqPill.textContent = 'no host';
    el.seqPill.className = 'pill off';
    log(err.message, 'err');
  });
})();
