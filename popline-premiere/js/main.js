/* Popline panel UI. Runs in Premiere's CEF with Node enabled (mixed context). */
(function () {
  'use strict';

  var path = require('path');
  var os = require('os');
  var fs = require('fs');
  var extRoot = Host.extensionRoot() || path.resolve(__dirname || '.', '..');
  function mod(n) { return require(path.join(extRoot, 'js', n)); }
  var C = mod('captions.js'), LK = mod('looks.js'), T = mod('transcribe.js'), R = mod('render.js'), U = mod('util.js'), M = mod('mogrt.js'), LIB = mod('library.js'), SM = mod('smart.js');

  var $ = function (id) { return document.getElementById(id); };
  var el = {};
  ['seqPill', 'previewImg', 'previewVid', 'previewEmpty', 'previewBusy', 'tplView', 'tplViewImg', 'tplViewName', 'prevCap', 'nextCap',
    'capCounter', 'playBtn', 'tabs', 'barFill', 'status', 'source', 'language', 'engine', 'model', 'apiKey', 'dlModel', 'dlBtn', 'prompt',
    'inOut', 'fillers', 'translate', 'transcribeBtn', 'cancelBtn', 'tools', 'fillerBtn', 'syncEarly', 'syncLate', 'syncTotal', 'findText',
    'replaceText', 'replaceBtn', 'inspector', 'inspTitle', 'inspTime', 'chips', 'wordLook', 'capLook', 'capList',
    'presetName', 'savePreset', 's_font', 's_anim', 's_highlight', 'addPresetBtn', 'applyAllBtn', 'clearCapBtn', 'dropZone',
    'presetSearch', 'presetKind', 'presetCats', 'presetGrid', 'restoreLooks', 'hiddenCount', 'quickText', 'quickDur', 'custom', 'customTitle',
    'customClose', 'c_name', 'c_cat', 'c_text', 'c_scale', 'c_params', 'customSave', 'customReset', 'mixPool', 'mixVariety', 'mixBtn',
    'shuffleBtn', 'unmixBtn', 'packFolders', 'addPackBtn', 'rescanBtn', 'overlayBtn', 'nativeBtn', 'srtBtn', 'assBtn', 'txtBtn', 'folderBtn', 'log', 'screen'
  ].forEach(function (id) { el[id] = $(id); });

  var tools = {};
  var seq = null;          // popline_sequenceInfo()
  var doc = null;          // the caption document for this sequence (saved as popline.json)
  var caps = [];           // captions derived from doc.words + style
  var sel = 0;             // selected caption
  var selWords = [];       // selected word indices (inspector)
  var busy = false;
  var job = null;
  var style = LK.withDefaults(LK.LOOKS[0].style);
  var presetId = LK.LOOKS[0].id;
  var lookCat = 'All';
  var packs = { folders: [], templates: [], byId: {} };

  /* ---------------------------------------------------------- helpers */

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
  function fmt(t) { var m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1); }
  function safe(s) { return String(s || 'Sequence').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'Sequence'; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fileUrl(p) { return 'file:///' + p.replace(/\\/g, '/').replace(/^\//, ''); }
  function setBusy(b) {
    busy = b;
    [el.transcribeBtn, el.overlayBtn, el.nativeBtn, el.dlBtn].forEach(function (x) { x.disabled = b; });
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

  var SETTINGS = ['engine', 'model', 'language', 'apiKey', 'source', 'mixPool', 'mixVariety', 'quickDur'];
  var CHECKS = ['inOut', 'fillers', 'translate'];
  function loadSettings() {
    try {
      var s = JSON.parse(localStorage.getItem('popline.settings') || '{}');
      SETTINGS.forEach(function (k) { if (s[k] != null) { el[k].dataset.want = s[k]; el[k].value = s[k]; } });
      CHECKS.forEach(function (k) { if (s[k] != null) el[k].checked = !!s[k]; });
      if (s.style) { style = LK.withDefaults(s.style); presetId = s.presetId || null; }
      if (s.packFolders) packs.extra = s.packFolders;
    } catch (e) {}
  }
  function saveSettings() {
    try {
      var s = { style: style, presetId: presetId, packFolders: packs.extra || [] };
      SETTINGS.forEach(function (k) { s[k] = el[k].value; });
      CHECKS.forEach(function (k) { s[k] = el[k].checked; });
      localStorage.setItem('popline.settings', JSON.stringify(s));
    } catch (e) {}
  }
  SETTINGS.concat(CHECKS).forEach(function (k) {
    el[k].addEventListener('change', function () { saveSettings(); if (k === 'engine') showEngine(); });
  });
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
    if (!tools.ffmpeg) log('ffmpeg not found. Run the installer or put ffmpeg in ' + path.join(extRoot, 'bin'), 'err');
    if (!tools.whisper) log('whisper.cpp not found. Run the installer, or use the OpenAI engine.', 'dim');
  }

  function refreshModels() {
    var have = T.installedModels(extRoot);
    var want = el.model.dataset.want || el.model.value;
    el.model.innerHTML = have.length ? '' : '<option value="">No model yet: download one below</option>';
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
    else if (!have.length && el.dlModel.querySelector('[value="base"]')) el.dlModel.value = 'base';
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
        if (d.style) style = LK.withDefaults(d.style);
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
      el.source.innerHTML = '<option value="all">Whole sequence (all audio tracks)</option><option value="selected">Selected clips</option>' +
        info.audioTracks.map(function (n, i) {
          return '<option value="track:' + i + '">Audio track ' + (i + 1) + (n && !/^Audio \d+$/.test(n) ? ' (' + esc(n) + ')' : '') + '</option>';
        }).join('');
      if (cur && el.source.querySelector('[value="' + cur + '"]')) el.source.value = cur;
      if (changed) {
        doc = null;
        loadDoc();
        syncControls();
        renderPresets();
        rebuild();
      }
    }).catch(function () {
      el.seqPill.textContent = 'no host';
      el.seqPill.className = 'pill off';
    });
  }

  function frame() { return { w: seq ? seq.width : 1080, h: seq ? seq.height : 1920, fps: seq ? seq.fps : 30 }; }

  /* ---------------------------------------------------------- transcribe */

  el.transcribeBtn.addEventListener('click', function () {
    guarded('transcribe', function () {
      checkTools();
      if (!tools.ffmpeg) throw new Error('ffmpeg not found. Run the installer first.');
      var sources;
      return refreshSequence().then(function () {
        if (!seq) throw new Error('Open a sequence first.');
        var src = el.source.value;
        var scope = src === 'selected' ? 'selected' : src === 'all' ? 'all' : 'track';
        var trackIdx = scope === 'track' ? parseInt(src.split(':')[1], 10) : 0;
        status('Finding clips…');
        return Host.call('popline_sources', [scope, trackIdx, el.inOut.checked]);
      }).then(function (res) {
        if (!res.ok) throw new Error(res.error);
        sources = res.sources;
        log('Transcribing ' + sources.length + ' clip(s): ' + sources.map(function (s) { return path.basename(s.mediaPath); }).join(', '), 'dim');
        return track(T.transcribeSources(tools, sources, {
          engine: el.engine.value, modelPath: el.model.value, apiKey: el.apiKey.value.trim(),
          language: el.language.value, translate: el.translate.checked, prompt: el.prompt.value.trim(),
          workDir: path.join(workDir(), 'audio')
        }, {
          onStatus: function (s) { status(s); },
          onProgress: bar,
          onLine: function (l) { log(l, 'dim'); }
        }));
      }).then(function (raw) {
        var words = C.dedupeOverlaps(C.normalizeWords(raw));
        var n = words.length;
        if (el.fillers.checked) words = C.removeFillers(words);
        if (!words.length) throw new Error('No speech found in those clips.');
        var prev = doc || {};
        doc = {
          version: 2, created: new Date().toISOString(),
          sequence: { name: seq.name, id: seq.id, width: seq.width, height: seq.height, fps: seq.fps },
          sources: sources,
          span: { start: Math.min.apply(null, sources.map(function (s) { return s.startSec; })), end: Math.max.apply(null, sources.map(function (s) { return s.endSec; })) },
          words: words, sync: 0, overlay: prev.overlay || null, placedTemplates: prev.placedTemplates || []
        };
        sel = 0;
        selWords = [];
        rebuild();
        saveDoc();
        showTab('edit');
        return 'Transcribed ' + words.length + ' words' + (n !== words.length ? ' (' + (n - words.length) + ' fillers removed)' : '') + ' into ' + caps.length + ' captions.';
      });
    });
  });
  el.cancelBtn.addEventListener('click', function () { if (job) job.cancel(); });

  /* ---------------------------------------------------------- looks lookup */

  function customLooks() {
    try {
      return JSON.parse(localStorage.getItem('popline.presets') || '[]').map(function (p) {
        return { id: p.id, label: p.label, cat: 'Mine', style: LK.withDefaults(p.style), custom: true };
      });
    } catch (e) { return []; }
  }
  function hiddenLooks() { try { return JSON.parse(localStorage.getItem('popline.hiddenLooks') || '[]'); } catch (e) { return []; } }
  function allLooks() {
    var hidden = hiddenLooks();
    return LK.LOOKS.filter(function (l) { return hidden.indexOf(l.id) < 0; }).concat(customLooks());
  }
  function lookName(id) { var l = LK.lookById(id, customLooks()); return l ? l.label : id; }
  function tplName(id) { var t = packs.byId[id]; return t ? t.name : 'missing template'; }

  /* ---------------------------------------------------------- caption list + inspector */

  function rebuild() {
    caps = doc ? C.groupCaptions(doc.words, style) : [];
    if (sel >= caps.length) sel = Math.max(0, caps.length - 1);
    renderList();
    renderInspector();
    updateCounter();
    el.syncTotal.textContent = doc && doc.sync ? 'shifted ' + (doc.sync > 0 ? '+' : '') + doc.sync.toFixed(1) + 's' : '';
    el.overlayBtn.textContent = doc && (doc.overlay || (doc.placedTemplates && doc.placedTemplates.length)) ? 'UPDATE CAPTIONS ON TIMELINE' : 'ADD CAPTIONS TO TIMELINE';
    renderPresets();
    schedulePreview();
  }

  function capTag(cap) {
    var tpl = C.capTemplate(doc.words, cap), lk = C.capLookId(doc.words, cap);
    var wl = [];
    for (var i = cap.from; i <= cap.to; i++) if (doc.words[i].look) wl.push(doc.words[i].text + ': ' + lookName(doc.words[i].look));
    var parts = [];
    if (tpl) parts.push('▣ ' + tplName(tpl));
    if (lk) parts.push('◆ ' + lookName(lk));
    if (wl.length) parts.push('● ' + wl.join(', '));
    return parts.join('   ');
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
      var tag = capTag(cap);
      if (tag) { var tg = document.createElement('div'); tg.className = 'tag'; tg.textContent = tag; row.appendChild(tg); }
      frag.appendChild(row);
    });
    el.capList.appendChild(frag);
  }

  function lookOptions(selected, withTemplates) {
    var html = '<option value="">' + (withTemplates ? 'Same as all captions' : 'Same as the caption') + '</option>';
    var groups = {};
    allLooks().forEach(function (l) { (groups[l.cat] = groups[l.cat] || []).push(l); });
    Object.keys(groups).forEach(function (g) {
      html += '<optgroup label="' + esc(g) + ' looks">' + groups[g].map(function (l) {
        return '<option value="look:' + l.id + '"' + (selected === 'look:' + l.id ? ' selected' : '') + '>' + esc(l.label) + '</option>';
      }).join('') + '</optgroup>';
    });
    if (withTemplates && packs.templates.length) {
      var byPack = {};
      packs.templates.forEach(function (t) { (byPack[t.pack] = byPack[t.pack] || []).push(t); });
      Object.keys(byPack).forEach(function (p) {
        html += '<optgroup label="Template: ' + esc(p) + '">' + byPack[p].map(function (t) {
          return '<option value="tpl:' + t.id + '"' + (selected === 'tpl:' + t.id ? ' selected' : '') + '>' + esc(t.name) + '</option>';
        }).join('') + '</optgroup>';
      });
    }
    return html;
  }

  function renderInspector() {
    if (!doc || !caps.length) { el.inspector.hidden = true; return; }
    el.inspector.hidden = false;
    var cap = caps[sel];
    el.inspTitle.textContent = 'CAPTION ' + (sel + 1);
    el.inspTime.textContent = fmt(cap.start) + ' – ' + fmt(cap.end);
    selWords = selWords.filter(function (i) { return i >= cap.from && i <= cap.to; });
    el.chips.innerHTML = '';
    for (var i = cap.from; i <= cap.to; i++) {
      var b = document.createElement('button');
      b.className = 'chip' + (selWords.indexOf(i) >= 0 ? ' sel' : '');
      b.dataset.i = i;
      b.innerHTML = esc(doc.words[i].text) + (doc.words[i].look ? '<i>' + esc(lookName(doc.words[i].look)) + '</i>' : '');
      el.chips.appendChild(b);
    }
    var tpl = C.capTemplate(doc.words, cap), lk = C.capLookId(doc.words, cap);
    el.capLook.innerHTML = lookOptions(tpl ? 'tpl:' + tpl : lk ? 'look:' + lk : '', true);
    var wsel = selWords.length && doc.words[selWords[0]].look ? 'look:' + doc.words[selWords[0]].look : '';
    el.wordLook.innerHTML = lookOptions(wsel, false);
    el.wordLook.disabled = !selWords.length || !!tpl;
  }

  el.chips.addEventListener('click', function (e) {
    var b = e.target.closest('.chip');
    if (!b) return;
    var i = +b.dataset.i, at = selWords.indexOf(i);
    if (at >= 0) selWords.splice(at, 1); else selWords.push(i);
    renderInspector();
  });
  el.wordLook.addEventListener('change', function () {
    if (!selWords.length) return;
    var v = el.wordLook.value;
    doc.words = C.setWordLook(doc.words, selWords, v ? v.slice(5) : null);
    status(selWords.length + ' word(s) → ' + (v ? lookName(v.slice(5)) : 'caption look'));
    rebuild();
    saveDoc();
  });
  el.capLook.addEventListener('change', function () { applyCapChoice(el.capLook.value); });

  function applyCapChoice(v) {
    if (!doc || !caps.length) return;
    var cap = caps[sel];
    var look = v && v.indexOf('look:') === 0 ? v.slice(5) : null, tpl = v && v.indexOf('tpl:') === 0 ? v.slice(4) : null;
    doc.words = C.setCaptionLook(doc.words, cap, look, tpl);
    status('Caption ' + (sel + 1) + ' → ' + (tpl ? 'template ' + tplName(tpl) : look ? lookName(look) : 'default look'));
    rebuild();
    saveDoc();
  }

  function select(k, seek) {
    if (!caps.length) return;
    var nk = Math.max(0, Math.min(caps.length - 1, k));
    if (nk !== sel) selWords = [];
    sel = nk;
    Array.prototype.forEach.call(el.capList.children, function (r) { r.classList.toggle('sel', +r.dataset.k === sel); });
    renderInspector();
    renderPresets();
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
    if (k !== sel) select(k, true);
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
    var rep = el.replaceText.value.trim(), n = 0;
    doc.words.forEach(function (w) { if (re.test(w.text)) { w.text = w.text.replace(re, rep); n++; } });
    doc.words = doc.words.filter(function (w) { return w.text; });
    rebuild();
    saveDoc();
    status('Replaced ' + n + ' word(s).');
  });

  /* ---------------------------------------------------------- style controls */

  function sampleCss(node, s, hiNode) {
    var f = LK.fontFace(s.font);
    node.style.fontFamily = '"' + s.font + '"';
    if (f.i) node.style.fontStyle = 'italic';
    node.style.color = s.color;
    var stroke = Math.min(3, Math.max(0, s.outline / 3));
    if (stroke && s.highlight !== 'hollow') node.style.webkitTextStroke = stroke + 'px ' + s.outlineColor;
    if (s.highlight === 'hollow') { node.style.color = 'transparent'; node.style.webkitTextStroke = '1px ' + s.outlineColor; }
    node.style.paintOrder = 'stroke fill';
    if (s.glow) node.style.textShadow = '0 0 8px ' + s.outlineColor;
    else if (s.shadow) node.style.textShadow = '1px 2px 0 ' + s.shadowColor;
    if (!hiNode) return;
    if (s.highlight === 'box') { hiNode.style.background = s.boxColor; hiNode.style.borderRadius = '3px'; hiNode.style.padding = '0 3px'; hiNode.style.webkitTextStroke = '0'; hiNode.style.color = s.accent; }
    else if (s.highlight === 'hollow') { hiNode.style.color = s.accent; }
    else if (s.highlight === 'underline') { hiNode.style.color = s.accent; hiNode.style.textDecoration = 'underline'; }
    else if (s.highlight !== 'none' || s.rainbow) hiNode.style.color = s.rainbow ? s.palette[1] : s.accent;
    if (s.fadeTail) hiNode.style.opacity = String(1 - s.fadeTail / 160);
  }

  /** Make a look the main look for every caption (and the Style tab's starting point). */
  function useLookGlobally(p) {
    var keepY = style.posY;
    style = LK.withDefaults(JSON.parse(JSON.stringify(p.style)));
    if (!p.custom && p.style.posY === LK.BASE_STYLE.posY) style.posY = keepY;
    presetId = p.id;
    syncControls();
    renderPresets();
    styleChanged(true);
  }

  el.savePreset.addEventListener('click', function () {
    var name = el.presetName.value.trim() || 'My look ' + (customLooks().length + 1);
    var list = customLooks().map(function (p) { return { id: p.id, label: p.label, style: p.style }; });
    var id = 'custom-' + Date.now();
    list.push({ id: id, label: name, style: JSON.parse(JSON.stringify(style)) });
    localStorage.setItem('popline.presets', JSON.stringify(list));
    presetId = id;
    el.presetName.value = '';
    renderPresets();
    saveSettings();
    status('Saved preset "' + name + '". It is in PRESETS and can be used on single captions and words.');
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
    var unit = { animMs: ' ms', posY: '%', shadowOpacity: '%', outlineOpacity: '%', fadeTail: '%' }[c.dataset.k] ||
      { c_scale: '%', mixVariety: '%', quickDur: ' s' }[c.id] || '';
    o.textContent = c.value + unit;
  }
  var GROUPING = ['maxWords', 'maxChars', 'lines'];
  controls.forEach(function (c) {
    c.addEventListener('input', function () {
      var k = c.dataset.k;
      style[k] = c.type === 'checkbox' ? c.checked : (c.type === 'range' || k === 'lines') ? Number(c.value) : c.value;
      showOutput(c);
      presetId = null;
      Array.prototype.forEach.call(el.presetGrid.querySelectorAll('.preset'), function (n) { n.classList.remove('on'); });
      styleChanged(GROUPING.indexOf(k) >= 0);
    });
  });
  function styleChanged(regroup) {
    if (regroup) rebuild(); else schedulePreview();
    saveSettings();
    saveDoc();
  }

  function fillSelects() {
    el.s_font.innerHTML = Object.keys(LK.FONTS).map(function (f) {
      return '<option value="' + f + '" style="font-family:\'' + f + '\'">' + f + '</option>';
    }).join('');
    el.s_anim.innerHTML = Object.keys(LK.ANIMS).map(function (k) { return '<option value="' + k + '">' + esc(LK.ANIMS[k].label) + '</option>'; }).join('');
    el.s_highlight.innerHTML = Object.keys(LK.HIGHLIGHTS).map(function (k) { return '<option value="' + k + '">' + esc(LK.HIGHLIGHTS[k]) + '</option>'; }).join('');
  }

  /* ---------------------------------------------------------- presets: looks + templates */

  var presetCat = 'All';
  var activeKey = null;     // last preset clicked (APPLY TO ALL uses it)
  var editing = null;       // template open in the customise drawer

  function scanPacks() {
    try {
      var n = LIB.seed(extRoot);
      if (n) log('Added ' + n + ' bundled templates to your preset library.', 'dim');
    } catch (e) { log('Library: ' + e.message, 'err'); }
    var own = path.join(extRoot, 'packs');
    var folders = M.discoverPackFolders(extRoot).filter(function (f) { return path.resolve(f) !== path.resolve(own); });
    (packs.extra || []).forEach(function (f) { if (folders.indexOf(f) < 0 && fs.existsSync(f)) folders.push(f); });
    var r = LIB.list(folders);
    packs.folders = folders;
    packs.templates = r.templates;
    packs.byId = {};
    r.templates.forEach(function (t) { packs.byId[t.id] = t; });
    r.errors.forEach(function (e) { log('Template skipped: ' + e, 'dim'); });
    var hiddenN = r.hiddenCount + hiddenLooks().length;
    el.hiddenCount.textContent = hiddenN ? '(' + hiddenN + ' hidden)' : '';
    el.restoreLooks.parentNode.hidden = !hiddenN;
    renderFolders();
    renderPresets();
    renderInspector();
  }

  function renderFolders() {
    var lines = ['<div><span>📚 Library: ' + esc(LIB.libDir()) + '</span></div>'];
    packs.folders.forEach(function (f) {
      var mine = (packs.extra || []).indexOf(f) >= 0;
      lines.push('<div><span>📁 ' + esc(f) + '</span>' + (mine ? '<button data-rm="' + esc(f) + '" title="Stop using this folder">✕</button>' : '<span class="dim">found automatically</span>') + '</div>');
    });
    el.packFolders.innerHTML = lines.join('');
  }
  el.packFolders.addEventListener('click', function (e) {
    var f = e.target.getAttribute && e.target.getAttribute('data-rm');
    if (!f) return;
    packs.extra = (packs.extra || []).filter(function (x) { return x !== f; });
    saveSettings();
    scanPacks();
  });
  el.addPackBtn.addEventListener('click', function () {
    var f = Host.pickFolder('Choose a folder of .mogrt templates');
    if (!f) return;
    packs.extra = (packs.extra || []).concat([f]);
    saveSettings();
    scanPacks();
  });
  el.rescanBtn.addEventListener('click', scanPacks);

  /** Every preset as one list: [{key, kind, id, label, cat, obj}] */
  function presetItems() {
    var out = allLooks().map(function (l) { return { key: 'look:' + l.id, kind: 'look', id: l.id, label: l.label, cat: l.cat, obj: l }; });
    packs.templates.forEach(function (t) { out.push({ key: 'tpl:' + t.id, kind: 'tpl', id: t.id, label: t.name, cat: t.cat, obj: t }); });
    return out;
  }

  function renderCats() {
    var cats = ['All'].concat(LK.CATEGORIES, customLooks().length ? ['Mine'] : []);
    el.presetCats.innerHTML = cats.map(function (c) {
      return '<button data-cat="' + c + '" class="' + (c === presetCat ? 'on' : '') + '">' + c + '</button>';
    }).join('');
  }
  el.presetCats.addEventListener('click', function (e) {
    var c = e.target.getAttribute && e.target.getAttribute('data-cat');
    if (c) { presetCat = c; renderCats(); renderPresets(); }
  });
  el.presetSearch.addEventListener('input', function () { renderPresets(); });
  el.presetKind.addEventListener('change', function () { renderPresets(); });

  function currentKeyForCaption() {
    if (!doc || !caps[sel]) return presetId ? 'look:' + presetId : null;
    var tpl = C.capTemplate(doc.words, caps[sel]), lk = C.capLookId(doc.words, caps[sel]);
    return tpl ? 'tpl:' + tpl : lk ? 'look:' + lk : (presetId ? 'look:' + presetId : null);
  }

  function renderPresets() {
    if (!el.presetGrid) return;
    renderCats();
    var q = el.presetSearch.value.trim().toLowerCase();
    var kind = el.presetKind.value;
    var on = currentKeyForCaption();
    el.presetGrid.innerHTML = '';
    presetItems().filter(function (p) {
      if (kind !== 'all' && p.kind !== kind) return false;
      if (presetCat !== 'All' && p.cat !== presetCat) return false;
      var hay = p.label + ' ' + p.cat + ' ' + (p.kind === 'look' ? p.obj.style.font + ' ' + p.obj.style.anim : p.obj.file + ' ' + p.obj.pack);
      return !q || hay.toLowerCase().indexOf(q) >= 0;
    }).forEach(function (p) {
      var card = document.createElement('div');
      card.className = 'preset' + (p.kind === 'tpl' ? ' tplcard' : '') + (p.key === on ? ' on' : '');
      card.dataset.key = p.key;
      if (p.kind === 'look') {
        var s = p.obj.style;
        card.title = p.label + ': ' + s.font + ' · ' + ((LK.ANIMS[s.anim] || {}).label || s.anim) + ' · ' + (LK.HIGHLIGHTS[s.highlight] || s.highlight);
        var sample = document.createElement('div');
        sample.className = 'sample';
        var txt = s.uppercase ? 'GO VIRAL' : 'Go viral';
        sample.innerHTML = '<span></span> <span></span>';
        sample.children[0].textContent = txt.split(' ')[0];
        sample.children[1].textContent = txt.split(' ')[1];
        sampleCss(sample, s, sample.children[1]);
        card.innerHTML = '<div class="cat">' + esc(p.cat.toUpperCase()) + '</div>';
        card.appendChild(sample);
        card.insertAdjacentHTML('beforeend', '<div class="name">' + esc(p.label) + '</div>');
      } else {
        var t = p.obj;
        card.title = t.name + ' (' + t.file + ')\n' + t.slots + ' text field(s)' + (t.fonts.length ? '\nFonts: ' + t.fonts.join(', ') : '') + '\nDrag onto the timeline, or click to use on the selected caption.';
        card.draggable = true;
        card.innerHTML = (t.thumb ? '<img src="' + fileUrl(t.thumb) + '" alt="" draggable="false">' : '<div style="aspect-ratio:16/9"></div>') +
          '<div class="kind">MOGRT</div><div class="name">' + esc(t.name) + '</div>';
      }
      card.insertAdjacentHTML('beforeend', '<div class="tools"><button data-t="add" title="Add at the playhead">＋</button><button data-t="edit" title="Customise">✎</button><button data-t="del" title="Delete">🗑</button></div>');
      el.presetGrid.appendChild(card);
    });
    if (!el.presetGrid.children.length) el.presetGrid.innerHTML = '<p class="empty">No presets match.</p>';
  }

  function itemByKey(key) {
    return presetItems().filter(function (p) { return p.key === key; })[0] || null;
  }

  el.presetGrid.addEventListener('click', function (e) {
    var card = e.target.closest('.preset');
    if (!card) return;
    var p = itemByKey(card.dataset.key);
    if (!p) return;
    var t = e.target.getAttribute && e.target.getAttribute('data-t');
    if (t === 'add') return quickInsert(p);
    if (t === 'edit') return customise(p);
    if (t === 'del') return deletePreset(p);
    activeKey = p.key;
    if (doc && caps.length) {
      applyCapChoice(p.key);
    } else if (p.kind === 'look') {
      useLookGlobally(p.obj);
      status('Main look → ' + p.label + '. Transcribe to caption your video with it.');
    } else {
      status('Transcribe first to use templates on captions, or use ＋ / drag to place it now.');
    }
    renderPresets();
  });

  // Drag a template card straight onto Premiere's timeline or Project panel (CEP file drag).
  el.presetGrid.addEventListener('dragstart', function (e) {
    var card = e.target.closest && e.target.closest('.preset');
    var p = card && itemByKey(card.dataset.key);
    if (!p || p.kind !== 'tpl') { e.preventDefault(); return; }
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('com.adobe.cep.dnd.file.0', p.obj.path);
    e.dataTransfer.setData('text/uri-list', fileUrl(p.obj.path));
    e.dataTransfer.setData('text/plain', p.obj.path);
    window.__poplineDragOut = true;
  });
  el.presetGrid.addEventListener('dragend', function () { window.__poplineDragOut = false; });

  el.applyAllBtn.addEventListener('click', function () {
    var p = activeKey ? itemByKey(activeKey) : (presetId ? itemByKey('look:' + presetId) : null);
    if (!p) { status('Click a preset first.', 'err'); return; }
    if (p.kind === 'look') {
      if (doc) doc.words = doc.words.map(function (w) { var c = Object.assign({}, w); delete c.capLook; delete c.capTpl; return c; });
      useLookGlobally(p.obj);
    } else {
      if (!doc) { status('Transcribe first.', 'err'); return; }
      doc.words = doc.words.map(function (w) { var c = Object.assign({}, w); delete c.capLook; c.capTpl = p.id; return c; });
      rebuild();
      saveDoc();
    }
    status('Every caption → ' + p.label + '.');
  });
  el.clearCapBtn.addEventListener('click', function () { applyCapChoice(''); renderPresets(); });

  /** ＋ : put a preset at the playhead with typed text (works with or without a transcript). */
  function quickInsert(p) {
    var dur = Number(el.quickDur.value) || 3;
    guarded('insert ' + p.label, function () {
      return refreshSequence().then(function () {
        if (!seq) throw new Error('Open a sequence first.');
        if (p.kind === 'tpl') {
          var t = p.obj;
          var text = el.quickText.value.trim() || t.text || t.sample || 'Your text';
          var it = tplItem(t, { start: -1, end: -1 + dur, texts: C.splitIntoSlots(text.split(/\s+/), t.slots) });
          return Host.call('popline_placeMogrts', [[it]]).then(function (r) {
            if (!r.ok) throw new Error(r.error);
            return 'Added ' + t.name + ' at the playhead on ' + r.track + '. Edit its text in Essential Graphics.';
          });
        }
        checkTools();
        if (!tools.ffmpeg) throw new Error('ffmpeg not found.');
        var text2 = el.quickText.value.trim() || 'Your text here';
        var tokens = text2.split(/\s+/);
        var st = LK.overlayLook(style, p.obj.style);
        var span = dur * 0.75;
        var words = tokens.map(function (w, i) { return { text: w, start: i * span / tokens.length, end: (i + 1) * span / tokens.length, join: i < tokens.length - 1 }; });
        var oneCap = [{ from: 0, to: words.length - 1, start: 0, end: dur }];
        var wd = path.join(workDir(), 'titles');
        R.ensureFonts(extRoot, wd);
        var stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
        var lay = Object.assign({}, st, { lines: Math.max(st.lines, 2), maxChars: Math.max(st.maxChars, 18) });
        fs.writeFileSync(path.join(wd, 'title.ass'), C.buildAss(words, oneCap, lay, frame(), 0, customLooks()));
        var out = path.join(wd, p.label + ' ' + stamp + '.mov');
        status('Rendering ' + p.label + '…');
        return track(R.renderOverlay(tools, wd, 'title.ass', frame(), dur, out, { onProgress: bar })).then(function () {
          job = null;
          return Host.call('popline_placeOverlay', [out, -1, dur, 'Popline Titles']);
        }).then(function (r) {
          if (!r.ok) throw new Error(r.error);
          return 'Added "' + text2 + '" (' + p.label + ') at the playhead on ' + r.track + '.';
        });
      });
    });
  }

  /** A MOGRT placement with the template's saved size and colour/number settings. */
  function tplItem(t, base) {
    var fr = frame();
    var params = Object.keys(t.overrides || {}).map(function (name) {
      var def = (t.params || []).filter(function (x) { return x.name === name; })[0];
      return { name: name, type: def ? def.type : 'number', value: t.overrides[name] };
    });
    var s = LIB.settings(t.id);
    return Object.assign({
      path: t.path, slotNames: t.slotNames, scaleParam: t.scaleParam, params: params,
      scale: t.comp && t.comp.w ? Math.round(fr.w / t.comp.w * (s.scale || 100) * 10) / 10 : null
    }, base);
  }

  function deletePreset(p) {
    var what = p.kind === 'tpl' ? (LIB.owns(p.obj) ? 'Delete the template file "' + p.label + '" from your library?' : 'Hide "' + p.label + '"? (the file in ' + p.obj.pack + ' is kept)')
      : 'Delete the preset "' + p.label + '"?';
    if (!window.confirm(what)) return;
    try {
      if (p.kind === 'tpl') LIB.remove(p.obj);
      else if (p.obj.custom) {
        localStorage.setItem('popline.presets', JSON.stringify(customLooks().filter(function (x) { return x.id !== p.id; }).map(function (x) { return { id: x.id, label: x.label, style: x.style }; })));
      } else {
        localStorage.setItem('popline.hiddenLooks', JSON.stringify(hiddenLooks().concat([p.id])));
      }
      if (activeKey === p.key) activeKey = null;
      status('Deleted ' + p.label + '.');
      scanPacks();
      rebuild();
    } catch (e) { status(e.message, 'err'); }
  }
  el.restoreLooks.addEventListener('click', function (e) {
    e.preventDefault();
    localStorage.setItem('popline.hiddenLooks', '[]');
    LIB.unhideAll();
    scanPacks();
    status('Restored the deleted built-in presets and hidden templates.');
  });

  /* customise drawer */
  function customise(p) {
    if (p.kind === 'look') {
      useLookGlobally(p.obj);
      showTab('style');
      status('Editing "' + p.label + '". Change anything, then SAVE AS PRESET to keep it.');
      return;
    }
    var t = p.obj, s = LIB.settings(t.id);
    editing = t;
    el.custom.hidden = false;
    el.customTitle.textContent = 'CUSTOMISE · ' + t.file;
    el.c_name.value = s.label || t.name;
    el.c_cat.innerHTML = LK.CATEGORIES.map(function (c) { return '<option' + (c === t.cat ? ' selected' : '') + '>' + c + '</option>'; }).join('');
    el.c_text.value = s.text || t.sample || '';
    el.c_scale.value = s.scale || 100;
    showOutput(el.c_scale);
    el.c_params.innerHTML = (t.params || []).map(function (prm, i) {
      var v = (s.params && s.params[prm.name] !== undefined) ? s.params[prm.name] : prm.value;
      var id = 'cp_' + i;
      if (prm.type === 'color') return '<div><label for="' + id + '">' + esc(prm.name.toUpperCase()) + '</label><input id="' + id + '" data-p="' + esc(prm.name) + '" type="color" value="' + esc(v) + '"></div>';
      var min = prm.min != null ? prm.min : 0, max = prm.max != null ? prm.max : Math.max(100, v * 2);
      return '<div><label for="' + id + '">' + esc(prm.name.toUpperCase()) + ' <output>' + v + '</output></label><input id="' + id + '" data-p="' + esc(prm.name) + '" type="range" min="' + min + '" max="' + max + '" step="1" value="' + v + '"></div>';
    }).join('');
    el.custom.scrollIntoView({ block: 'nearest' });
  }
  el.c_params.addEventListener('input', function (e) {
    var o = e.target.previousElementSibling && e.target.previousElementSibling.querySelector('output');
    if (o) o.textContent = e.target.value;
  });
  el.c_scale.addEventListener('input', function () { showOutput(el.c_scale); });
  el.customClose.addEventListener('click', function () { el.custom.hidden = true; editing = null; });
  el.customSave.addEventListener('click', function () {
    if (!editing) return;
    var params = {};
    Array.prototype.forEach.call(el.c_params.querySelectorAll('[data-p]'), function (inp) {
      var def = (editing.params || []).filter(function (x) { return x.name === inp.getAttribute('data-p'); })[0];
      var v = inp.type === 'color' ? inp.value : Number(inp.value);
      if (!def || String(def.value).toLowerCase() !== String(v).toLowerCase()) params[inp.getAttribute('data-p')] = v;
    });
    LIB.saveSettings(editing.id, { label: el.c_name.value.trim() || undefined, cat: el.c_cat.value, text: el.c_text.value, scale: Number(el.c_scale.value), params: params });
    status('Saved settings for ' + (el.c_name.value || editing.name) + '. They apply every time it is placed.');
    el.custom.hidden = true;
    editing = null;
    scanPacks();
  });
  el.customReset.addEventListener('click', function () {
    if (!editing) return;
    LIB.saveSettings(editing.id, {});
    var id = editing.id;
    scanPacks();
    var p = itemByKey('tpl:' + id);
    if (p) customise(p);
  });

  /* add presets: button + drag and drop */
  el.addPresetBtn.addEventListener('click', function () {
    var files = Host.pickFiles('Add Motion Graphics Templates', ['mogrt']);
    if (!files || !files.length) return;
    try {
      var added = LIB.importFiles(files);
      status('Added ' + added.length + ' preset(s) to your library.');
      log('Added: ' + added.map(function (f) { return path.basename(f); }).join(', '), 'ok');
      scanPacks();
    } catch (e) { status(e.message, 'err'); }
  });

  function importDropped(fileList) {
    var files = Array.prototype.slice.call(fileList || []).filter(function (f) { return /\.mogrt$/i.test(f.name); });
    if (!files.length) { status('Drop .mogrt files to add them as presets.', 'err'); return; }
    Promise.all(files.map(function (f) {
      if (f.path && fs.existsSync(f.path)) return Promise.resolve(LIB.importFiles([f.path])[0]);
      return new Promise(function (resolve, reject) {
        var r = new FileReader();
        r.onload = function () { try { resolve(LIB.importBuffer(f.name, Buffer.from(r.result))); } catch (e) { reject(e); } };
        r.onerror = function () { reject(r.error); };
        r.readAsArrayBuffer(f);
      });
    })).then(function (added) {
      status('Added ' + added.length + ' preset(s) to your library.');
      scanPacks();
    }).catch(function (e) { status(e.message, 'err'); log(e.message, 'err'); });
  }
  document.addEventListener('dragover', function (e) {
    if (window.__poplineDragOut) return;
    e.preventDefault();
    document.body.classList.add('dragging');
  });
  document.addEventListener('dragleave', function (e) { if (!e.relatedTarget) document.body.classList.remove('dragging'); });
  document.addEventListener('drop', function (e) {
    document.body.classList.remove('dragging');
    if (window.__poplineDragOut) return;
    e.preventDefault();
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) { showTab('presets'); importDropped(e.dataTransfer.files); }
  });

  /* smart mix */
  var mixSeed = 7;
  function smartMix(seed) {
    if (!doc || !caps.length) { status('Transcribe first.', 'err'); return; }
    var mode = el.mixPool.value;
    var pool = presetItems().filter(function (p) {
      if (mode === 'look') return p.kind === 'look';
      if (mode === 'tpl') return p.kind === 'tpl';
      if (mode === 'cat') return presetCat === 'All' || p.cat === presetCat;
      return true;
    }).map(function (p) { return { key: p.key, label: p.label, cat: p.cat }; });
    if (!pool.length) { status('No presets to mix from with that choice.', 'err'); return; }
    var input = caps.map(function (c) {
      var t = [];
      for (var i = c.from; i <= c.to; i++) t.push(doc.words[i].text);
      return { text: t.join(' '), start: c.start, end: c.end, words: c.to - c.from + 1 };
    });
    var planned = SM.plan(input, pool, { variety: Number(el.mixVariety.value), seed: seed });
    var words = doc.words;
    var counts = {};
    planned.forEach(function (pl, k) {
      var key = pl.key;
      words = C.setCaptionLook(words, caps[k], key && key.indexOf('look:') === 0 ? key.slice(5) : null, key && key.indexOf('tpl:') === 0 ? key.slice(4) : null);
      if (key) {
        counts[pl.mood] = (counts[pl.mood] || 0) + 1;
        log('  ' + fmt(caps[k].start) + '  "' + input[k].text + '"  → ' + (itemByKey(key) || { label: key }).label + ' (' + pl.mood + (pl.reason ? ': ' + pl.reason : '') + ')', 'dim');
      }
    });
    doc.words = words;
    doc.mixSeed = seed;
    rebuild();
    saveDoc();
    var accents = planned.filter(function (p) { return p.key; }).length;
    status('Smart Mix: ' + accents + ' of ' + caps.length + ' captions got a matching preset (' +
      Object.keys(counts).map(function (m) { return counts[m] + ' ' + m; }).join(', ') + '). The rest keep your main look.');
  }
  el.mixBtn.addEventListener('click', function () { log('— smart mix', 'head'); smartMix(mixSeed); });
  el.shuffleBtn.addEventListener('click', function () { mixSeed = (mixSeed * 31 + 17) % 100003; log('— smart mix (shuffle)', 'head'); smartMix(mixSeed); });
  el.unmixBtn.addEventListener('click', function () {
    if (!doc) return;
    doc.words = doc.words.map(function (w) { var c = Object.assign({}, w); delete c.capLook; delete c.capTpl; return c; });
    rebuild();
    saveDoc();
    status('Every caption is back on the main look.');
  });
  el.mixVariety.addEventListener('input', function () { showOutput(el.mixVariety); });
  el.quickDur.addEventListener('input', function () { showOutput(el.quickDur); });

  /* ---------------------------------------------------------- preview */

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
    var hit = null;
    doc.sources.forEach(function (s) { if (!hit && t >= s.startSec && t < s.endSec && /\.(mp4|mov|mxf|mkv|avi|m4v|webm|mts)$/i.test(s.mediaPath)) hit = s; });
    return hit || doc.sources[0];
  }

  var pvTimer = null, pvGen = 0;
  function schedulePreview() {
    clearTimeout(pvTimer);
    pvTimer = setTimeout(renderPreview, 220);
  }
  function previewSet() {
    var real = doc && doc.words.length;
    var words = real ? doc.words : sampleWords();
    var cs = real ? caps : C.groupCaptions(words, style);
    var k = real ? sel : 0;
    return { words: words, caps: cs, cap: cs[Math.min(k, cs.length - 1)], real: real };
  }
  function showImage(png, gen) {
    el.previewVid.pause();
    el.previewVid.hidden = true;
    el.tplView.hidden = true;
    el.previewImg.src = fileUrl(png) + '?v=' + gen;
    el.previewImg.hidden = false;
    el.previewEmpty.hidden = true;
  }

  function renderPreview() {
    var set = previewSet();
    if (!set.cap) return;
    var tpl = set.real ? C.capTemplate(set.words, set.cap) : null;
    if (tpl) {
      // Templates animate inside Premiere; show the pack's thumbnail.
      var t = packs.byId[tpl];
      el.previewImg.hidden = true; el.previewVid.hidden = true; el.previewEmpty.hidden = true;
      el.tplView.hidden = false;
      el.tplViewImg.src = t && t.thumb ? fileUrl(t.thumb) : '';
      el.tplViewName.textContent = 'Template: ' + (t ? t.name : 'missing') + ' · "' + C.captionEditText(set.words, set.cap) + '"';
      return;
    }
    if (!tools.ffmpeg) return;
    var gen = ++pvGen;
    var fr = frame();
    var dir;
    try { dir = previewDir(); } catch (e) { log(e.message, 'err'); return; }
    var cs = set.real && C.capLookId(set.words, set.cap) ? LK.lookById(C.capLookId(set.words, set.cap), customLooks()) : null;
    var animMs = cs ? cs.style.animMs : style.animMs;
    var dur = set.cap.end - set.cap.start;
    var t0 = set.cap.start + Math.min(animMs / 1000 + 0.12, dur * 0.6);
    fs.writeFileSync(path.join(dir, 'preview.ass'), C.buildAss(set.words, set.caps, style, fr, 0, customLooks()));
    el.previewBusy.hidden = false;
    var src = set.real ? sourceAt(t0) : null;
    var bg = src ? path.join(dir, 'bg-' + Math.round(t0 * 10) + '.png') : null;
    var bgReady = !src || U.isFile(bg) ? Promise.resolve() : R.grabBackground(tools, src, t0, fr, bg).catch(function () { bg = null; });
    bgReady.then(function () {
      return R.renderPreviewFrame(tools, dir, 'preview.ass', fr, t0, bg, 'frame.png', 540);
    }).then(function (png) {
      if (gen === pvGen) showImage(png, gen);
    }).catch(function (e) {
      if (gen === pvGen) log('Preview: ' + e.message, 'err');
    }).then(function () { if (gen === pvGen) el.previewBusy.hidden = true; });
  }

  el.playBtn.addEventListener('click', function () {
    if (!tools.ffmpeg) return;
    var set = previewSet();
    if (!set.cap || (set.real && C.capTemplate(set.words, set.cap))) return;
    var fr = frame(), dir = previewDir(), gen = ++pvGen;
    fs.writeFileSync(path.join(dir, 'preview.ass'), C.buildAss(set.words, set.caps, style, fr, 0, customLooks()));
    var t0 = Math.max(0, set.cap.start - 0.1), t1 = set.cap.end + 0.15;
    var src = set.real ? sourceAt(set.cap.start) : null;
    var bg = src ? path.join(dir, 'bg-play.png') : null;
    el.previewBusy.hidden = false;
    (src ? R.grabBackground(tools, src, (t0 + t1) / 2, fr, bg).catch(function () { bg = null; }) : Promise.resolve()).then(function () {
      return R.renderPreviewClip(tools, dir, 'preview.ass', fr, t0, t1, bg, 'play-' + (gen % 2) + '.webm', 432);
    }).then(function (webm) {
      if (gen !== pvGen) return;
      el.previewImg.hidden = true;
      el.tplView.hidden = true;
      el.previewVid.hidden = false;
      el.previewVid.loop = true;
      el.previewVid.src = fileUrl(webm) + '?v=' + gen;
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
    guarded('add captions', function () {
      checkTools();
      return refreshSequence().then(function () {
        needCaptions();
        if (seq.id !== doc.sequence.id) throw new Error('These captions belong to "' + doc.sequence.name + '". Open that sequence first.');
        var fr = frame();
        var items = C.templateItems(doc.words, caps, style, packs.byId, fr, 100).map(function (it) {
          var t = packs.templates.filter(function (x) { return x.path === it.path; })[0];
          return t ? tplItem(t, { start: it.start, end: it.end, texts: it.texts }) : it;
        });
        var missingTpl = caps.filter(function (c) { var id = C.capTemplate(doc.words, c); return id && !packs.byId[id]; }).length;
        if (missingTpl) log(missingTpl + ' caption(s) use a template that is not in your pack folders any more; they are skipped.', 'err');
        var animated = caps.filter(function (c) { return !C.capTemplate(doc.words, c); }).length;
        var msgs = [];
        return (animated ? addOverlay(fr).then(function (m) { msgs.push(m); }) : Promise.resolve()).then(function () {
          return replaceTemplates(items);
        }).then(function (m) {
          if (m) msgs.push(m);
          saveDoc();
          el.overlayBtn.textContent = 'UPDATE CAPTIONS ON TIMELINE';
          return msgs.join(' ');
        });
      });
    });
  });

  function addOverlay(fr) {
    var wd = workDir();
    R.ensureFonts(extRoot, wd);
    var span = doc.span;
    var spanEnd = Math.max(span.end, caps[caps.length - 1].end);
    var dur = spanEnd - span.start;
    fs.writeFileSync(path.join(wd, 'captions.ass'), C.buildAss(doc.words, caps, style, fr, span.start, customLooks()));
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
      var relink = old ? Host.call('popline_relinkOverlay', [old, out]).then(function (r) {
        if (r.ok) {
          try { fs.unlinkSync(old); } catch (e) {}
          return 'Updated the animated captions.';
        }
        if (!r.notFound) throw new Error(r.error);
        return null;
      }) : Promise.resolve(null);
      return relink.then(function (msg) {
        if (msg) return msg;
        return Host.call('popline_placeOverlay', [out, span.start, dur, 'Popline Captions']).then(function (r) {
          if (!r.ok) throw new Error(r.error);
          return 'Added animated captions on ' + r.track + '.';
        });
      }).then(function (msg) {
        doc.overlay = { path: out, rev: rev };
        return msg;
      });
    });
  }

  /** Remove the templates placed last time, then place the current ones. */
  function replaceTemplates(items) {
    var prev = doc.placedTemplates || [];
    var clear = prev.length ? Host.call('popline_removeItems', [prev]).catch(function () { return {}; }) : Promise.resolve();
    return clear.then(function () {
      doc.placedTemplates = [];
      if (!items.length) return prev.length ? 'Removed the old templates.' : null;
      status('Placing ' + items.length + ' templates…');
      return Host.call('popline_placeMogrts', [items]).then(function (r) {
        if (!r.ok) throw new Error(r.error);
        doc.placedTemplates = r.ids || [];
        var m = 'Placed ' + r.placed + ' template caption(s) on ' + r.track + '.';
        if (r.textSet < r.placed) m += ' ' + (r.placed - r.textSet) + ' had no text field Popline could fill.';
        return m;
      });
    });
  }

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
  el.assBtn.addEventListener('click', exportBtn('ass', function () { return C.buildAss(doc.words, caps, style, frame(), 0, customLooks()); }));
  el.txtBtn.addEventListener('click', exportBtn('txt', function () { return C.plainText(doc.words) + '\n'; }));
  el.folderBtn.addEventListener('click', function () {
    var d = workDir();
    fs.mkdirSync(d, { recursive: true });
    U.openFolder(d);
  });

  /* ---------------------------------------------------------- boot */

  window.addEventListener('focus', function () { refreshSequence(); });
  fillSelects();
  loadSettings();
  showEngine();
  checkTools();
  refreshModels();
  syncControls();
  showOutput(el.mixVariety);
  showOutput(el.quickDur);
  scanPacks();
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
