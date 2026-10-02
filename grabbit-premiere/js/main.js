/* Grabbit panel UI. Runs in Premiere's CEF with Node enabled (mixed context). */
(function () {
  'use strict';

  var path = require('path');
  var os = require('os');
  var fs = require('fs');
  var extRoot = Host.extensionRoot() || path.resolve(__dirname || '.', '..');
  var core = require(path.join(extRoot, 'js', 'core.js'));

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    query: $('query'), go: $('goBtn'), results: $('results'),
    what: $('what'), whatHint: $('whatHint'), inLabel: $('inLabel'), outWrap: $('outWrap'),
    qualityWrap: $('qualityWrap'), encodeWrap: $('encodeWrap'),
    inPoint: $('inPoint'), outPoint: $('outPoint'), quality: $('quality'),
    placeMode: $('placeMode'), encodeMode: $('encodeMode'), binName: $('binName'),
    grab: $('grabBtn'), cancel: $('cancelBtn'), folder: $('folderBtn'),
    paste: $('pasteBtn'), exportFrame: $('exportFrameBtn'), frameOnTimeline: $('frameOnTimeline'), frameFormat: $('frameFormat'),
    outDir: $('outDir'), cookies: $('cookies'), keepOriginal: $('keepOriginal'),
    tools: $('tools'), update: $('updateBtn'), recheck: $('recheckBtn'),
    log: $('log'), status: $('status'), bar: $('barFill'), steps: $('steps'), hostState: $('hostState')
  };

  var tools = {};
  var job = null;          // current cancellable child job
  var busy = false;
  var selectedUrl = null;  // URL picked from search results
  var lastFolder = null;
  var what = 'video';      // video | thumb | frame

  /* ---------------------------------------------------------- settings */

  var SAVED = ['quality', 'placeMode', 'encodeMode', 'binName', 'outDir', 'cookies', 'frameFormat'];
  var CHECKS = ['keepOriginal', 'frameOnTimeline'];
  function loadSettings() {
    try {
      var s = JSON.parse(localStorage.getItem('grabbit.settings') || '{}');
      SAVED.forEach(function (k) { if (s[k] != null) el[k].value = s[k]; });
      CHECKS.forEach(function (k) { if (s[k] != null) el[k].checked = !!s[k]; });
      if (s.what) setWhat(s.what);
    } catch (e) {}
  }
  function saveSettings() {
    try {
      var s = { what: what };
      SAVED.forEach(function (k) { s[k] = el[k].value; });
      CHECKS.forEach(function (k) { s[k] = el[k].checked; });
      localStorage.setItem('grabbit.settings', JSON.stringify(s));
    } catch (e) {}
  }
  SAVED.concat(CHECKS).forEach(function (k) { el[k].addEventListener('change', saveSettings); });

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
    [el.grab, el.go, el.paste, el.exportFrame].forEach(function (x) { x.disabled = b; });
    el.cancel.hidden = !b;
    document.body.classList.toggle('busy', b);
  }

  function updateGoLabel() {
    el.go.textContent = core.looksLikeUrl(el.query.value) ? 'GRAB' : 'SEARCH';
  }

  var WHAT = {
    video: { button: 'GRAB TO TIMELINE', inLabel: 'IN POINT <i>(optional)</i>', hint: '' },
    thumb: { button: 'THUMBNAIL TO TIMELINE', inLabel: '', hint: 'Grabs the video\'s full-size thumbnail as a PNG.' },
    frame: { button: 'FRAME TO TIMELINE', inLabel: 'FRAME AT', hint: 'Grabs one full-quality frame at that time, without downloading the whole video.' }
  };
  function setWhat(w) {
    if (!WHAT[w]) return;
    what = w;
    Array.prototype.forEach.call(el.what.children, function (b) { b.classList.toggle('on', b.getAttribute('data-what') === w); b.setAttribute('aria-checked', b.getAttribute('data-what') === w); });
    el.grab.textContent = WHAT[w].button;
    el.inLabel.innerHTML = WHAT[w].inLabel;
    el.inPoint.parentNode.hidden = w === 'thumb';
    el.outWrap.hidden = w !== 'video';
    el.encodeWrap.hidden = w !== 'video';
    el.whatHint.textContent = WHAT[w].hint;
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
      var acts = document.createElement('div');
      acts.className = 'acts';
      [['VIDEO', 'video'], ['THUMB', 'thumb'], ['FRAME', 'frame']].forEach(function (a) {
        var btn = document.createElement('button');
        btn.className = 'btn small';
        btn.textContent = a[0];
        btn.title = { video: 'Download the video to the timeline', thumb: 'Put the thumbnail on the timeline', frame: 'Put the frame at the FRAME AT time on the timeline' }[a[1]];
        btn.addEventListener('click', function (e) { e.stopPropagation(); select(); setWhat(a[1]); saveSettings(); grab(); });
        acts.appendChild(btn);
      });
      card.appendChild(thumb);
      card.appendChild(meta);
      card.appendChild(acts);

      function select() {
        Array.prototype.forEach.call(el.results.querySelectorAll('.result'), function (n) { n.classList.remove('sel'); });
        card.classList.add('sel');
        selectedUrl = r.url;
        status('Selected: ' + r.title);
      }
      card.addEventListener('click', select);
      card.addEventListener('dblclick', function () { select(); grab(); });
      card.addEventListener('keydown', function (e) { if (e.key === 'Enter') { select(); grab(); } });
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
      status(items.length + ' results. Pick VIDEO, THUMB or FRAME on a result.');
    }).catch(function (err) {
      el.results.innerHTML = '<p class="empty">Search failed.</p>';
      status('Search failed.');
      log(err.message, 'err');
    }).then(function () { setBusy(false); });
  }

  /* ---------------------------------------------------------- shared pipeline */

  function downloadDir(sub) {
    var custom = el.outDir.value.trim();
    var p = custom ? Promise.resolve(custom) : Host.call('grabbit_projectInfo').then(function (info) {
      if (info.ok && info.projectPath) return path.join(path.dirname(info.projectPath), 'Grabbit Downloads');
      return path.join(os.homedir(), 'Documents', 'Grabbit Downloads');
    }).catch(function () { return path.join(os.homedir(), 'Documents', 'Grabbit Downloads'); });
    return p.then(function (d) {
      lastFolder = d;
      return sub ? path.join(d, sub) : d;
    });
  }

  function track(j) { job = j; return j.promise; }

  /** Runs one grab: busy state, timing, step bar and error reporting. */
  function pipeline(label, work) {
    if (busy) return Promise.resolve();
    var t0 = Date.now();
    setBusy(true);
    step('fetch');
    bar(0);
    log('— ' + label, 'head');
    return work().then(function (summary) {
      step('timeline', 'done');
      bar(100);
      if (summary) {
        status('Done in ' + Math.round((Date.now() - t0) / 1000) + 's — ' + summary + '.');
        log('Done: ' + summary, 'ok');
      }
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

  var WHERE = {
    insert: function (r) { return 'inserted at the playhead on ' + r.track; },
    overwrite: function (r) { return 'overwritten at the playhead on ' + r.track; },
    append: function (r) { return 'appended to the end on ' + r.track; },
    still: function (r) { return 'placed on ' + r.track + ' at the playhead'; },
    project: function (r) { return 'added to the "' + r.bin + '" bin'; },
    'new-sequence': function (r) { return 'placed in new sequence "' + r.sequence + '"'; }
  };

  /** Import files into the project and lay them out back to back from the playhead. */
  function placeFiles(files, mode) {
    step('timeline');
    el.cancel.hidden = true;
    job = null;
    status('Importing into Premiere…');
    var bin = el.binName.value.trim() || 'Grabbit';
    var at = null, results = [];
    return files.reduce(function (p, f) {
      return p.then(function () {
        return Host.call('grabbit_importAndPlace', [f, mode, bin, at, core.isStill(f)]);
      }).then(function (res) {
        if (!res.ok) throw new Error(res.error);
        if (res.end != null && mode !== 'project') at = res.end;
        results.push(res);
      });
    }, Promise.resolve()).then(function () {
      var r = results[0];
      var desc = (WHERE[r.placed] || WHERE.project)(r);
      return results.length === 1 ? r.clip + ' ' + desc : results.length + ' items ' + desc;
    });
  }

  /* ---------------------------------------------------------- grab from link */

  function currentUrl() {
    var raw = el.query.value.trim();
    return core.looksLikeUrl(raw) ? core.normalizeUrl(raw) : selectedUrl;
  }

  function grab() {
    if (busy) return;
    var url = currentUrl();
    if (!url) {
      if (el.query.value.trim()) return doSearch();
      status('Paste a link or search first.');
      return;
    }
    grabUrl(url, what);
  }

  function grabUrl(url, kind) {
    var inSecs = null, outSecs = null;
    try {
      if (kind !== 'thumb') inSecs = core.parseTimecode(el.inPoint.value);
      if (kind === 'video') { outSecs = core.parseTimecode(el.outPoint.value); core.sectionArg(inSecs, outSecs); }
    } catch (e) {
      status(e.message);
      return Promise.resolve();
    }
    if (!checkTools()) { status('Missing tools — see the log.'); return Promise.resolve(); }
    if (kind === 'thumb') return pipeline('thumbnail: ' + url, function () { return grabThumbFlow(url); });
    if (kind === 'frame') return pipeline('frame @ ' + core.formatDuration(inSecs || 0) + ': ' + url, function () { return grabFrameFlow(url, inSecs || 0); });
    return pipeline(url, function () { return grabVideoFlow(url, inSecs, outSecs); });
  }

  function grabVideoFlow(url, inSecs, outSecs) {
    var mode = el.encodeMode.value;
    status('Contacting site…');
    return downloadDir().then(function (dir) {
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
      bar(100);
      return placeFiles([finalFile], el.placeMode.value);
    });
  }

  function grabThumbFlow(url) {
    status('Fetching thumbnail…');
    return downloadDir('Thumbnails').then(function (dir) {
      return track(core.grabThumbnail(tools, { url: url, outDir: dir, cookiesFromBrowser: el.cookies.value }, { onLine: function (l) { log(l); } }));
    }).then(function (f) {
      log('Thumbnail: ' + f, 'ok');
      step('encode');
      return placeFiles([f], el.placeMode.value);
    });
  }

  function grabFrameFlow(url, secs) {
    status('Finding the frame at ' + core.formatDuration(secs) + '…');
    return downloadDir('Frames').then(function (dir) {
      return track(core.grabFrame(tools, { url: url, outDir: dir, secs: secs, maxHeight: el.quality.value, cookiesFromBrowser: el.cookies.value },
        { onLine: function (l) { log(l, 'dim'); } }));
    }).then(function (f) {
      step('encode');
      return el.frameFormat.value === 'jpg' ? core.toJpeg(tools, f) : f;
    }).then(function (f) {
      log('Frame: ' + f, 'ok');
      return placeFiles([f], el.placeMode.value);
    });
  }

  /* ---------------------------------------------------------- paste */

  var VIDEO_HOSTS = /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|tiktok\.com|instagram\.com|x\.com|twitter\.com|facebook\.com|twitch\.tv|reddit\.com|dailymotion\.com|streamable\.com)$/i;

  function writeBlob(blob, dir) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () {
        var ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace(/[^a-z0-9]/g, '');
        var name = blob.name ? core.safeName(blob.name.replace(/\.[^.]+$/, '')) + '.' + (core.extOf(blob.name) || ext) : 'Pasted ' + core.stamp() + '.' + ext;
        fs.mkdirSync(dir, { recursive: true });
        var f = core.uniquePath(path.join(dir, name));
        fs.writeFileSync(f, Buffer.from(r.result));
        resolve(f);
      };
      r.onerror = function () { reject(r.error); };
      r.readAsArrayBuffer(blob);
    });
  }

  /**
   * Paste: whatever is on the clipboard goes into the project.
   * - files copied in Explorer/Finder -> imported in place
   * - an image copied from a browser -> saved as PNG
   * - a link to an image/video file -> downloaded
   * - a link to a video page -> handled like the GRAB mode (video, thumbnail or frame)
   * blobs: optional image/file blobs from a browser paste/drop event (used when the OS clipboard can't be read).
   */
  function pasteClipboard(blobs, droppedText) {
    if (busy) return;
    checkTools();
    var dir;
    var label = droppedText ? 'drop' : 'paste clipboard';
    pipeline(label, function () {
      status('Reading clipboard…');
      return downloadDir('Pasted').then(function (d) {
        dir = d;
        if (droppedText != null) return { kind: 'text', text: droppedText };
        return core.readClipboard(dir).catch(function (err) {
          log('Could not read the system clipboard (' + err.message + ').', 'dim');
          return { kind: 'empty' };
        });
      }).then(function (clip) {
        if ((clip.kind === 'empty' || clip.kind === 'text') && blobs && blobs.length) {
          return Promise.all(blobs.map(function (b) { return writeBlob(b, dir); })).then(function (files) { return { kind: 'image', files: files }; });
        }
        return clip;
      }).then(function (clip) {
        if (clip.kind === 'empty') throw new Error('The clipboard is empty. Copy an image, a file or a link first.');
        if (clip.kind === 'files' || clip.kind === 'image') {
          var files = clip.files.filter(core.isMediaPath);
          var skipped = clip.files.length - files.length;
          if (skipped) log('Skipped ' + skipped + ' file(s) Premiere can\'t import.', 'dim');
          if (!files.length) throw new Error('Nothing importable on the clipboard.');
          log((clip.kind === 'image' ? 'Image: ' : 'Files: ') + files.join(', '), 'dim');
          step('encode');
          return Promise.all(files.map(function (f) {
            return core.ensureImportable(tools, f, { keep: clip.kind === 'files', outDir: dir });
          })).then(function (ready) { return placeFiles(ready, el.placeMode.value); });
        }
        return pasteText(clip.text.trim(), dir);
      });
    });
  }

  function pasteText(text, dir) {
    var first = text.split(/\s+/)[0];
    if (!core.looksLikeUrl(first)) {
      el.query.value = text;
      updateGoLabel();
      throw new Error('The clipboard has text, not media. It\'s in the search box now. Press SEARCH to look it up.');
    }
    var url = core.normalizeUrl(first);
    el.query.value = url;
    updateGoLabel();
    var host = '';
    try { host = new URL(url).hostname; } catch (e) {}
    var direct = VIDEO_HOSTS.test(host) ? Promise.resolve({ notMedia: true }) : core.fetchMedia(url, dir);
    status('Fetching ' + url + '…');
    return direct.then(function (r) {
      if (r.file) {
        log('Downloaded: ' + r.file, 'ok');
        step('encode');
        return core.ensureImportable(tools, r.file).then(function (f) { return placeFiles([f], el.placeMode.value); });
      }
      // A web page: hand it to yt-dlp in the current GRAB mode.
      log('Link is a page, not a file. Using ' + (what === 'video' ? 'video download' : what === 'thumb' ? 'thumbnail' : 'frame grab') + '.', 'dim');
      var secs = null;
      if (what !== 'thumb') secs = core.parseTimecode(el.inPoint.value);
      if (what === 'thumb') return grabThumbFlow(url);
      if (what === 'frame') return grabFrameFlow(url, secs || 0);
      var outSecs = core.parseTimecode(el.outPoint.value);
      core.sectionArg(secs, outSecs);
      return grabVideoFlow(url, secs, outSecs);
    });
  }

  /* ---------------------------------------------------------- export frame */

  function exportTimelineFrame() {
    if (busy) return;
    checkTools();
    var mode = el.frameOnTimeline.checked ? 'overwrite' : 'project';
    pipeline('export frame at playhead', function () {
      status('Exporting frame…');
      var base, info;
      return downloadDir('Frames').then(function (dir) {
        fs.mkdirSync(dir, { recursive: true });
        base = core.uniquePath(path.join(dir, 'Frame ' + core.stamp() + '.png')).replace(/\.png$/, '');
        return Host.call('grabbit_exportFrame', [base + '.png']);
      }).then(function (res) {
        if (!res.ok) throw new Error(res.error);
        info = res;
        log('Exporting ' + res.sequence + ' @ ' + res.timecode, 'dim');
        return core.waitForFile([base + '.png', base + '.png.png', base], 20000);
      }).then(function (f) {
        // Some Premiere versions add ".png" themselves; normalise the name.
        if (f !== base + '.png') { fs.renameSync(f, base + '.png'); f = base + '.png'; }
        step('encode');
        if (el.frameFormat.value === 'jpg') {
          if (!tools.ffmpeg) throw new Error('ffmpeg is needed for JPG frames.');
          return core.toJpeg(tools, f);
        }
        return f;
      }).then(function (f) {
        log('Frame: ' + f, 'ok');
        return placeFiles([f], mode).then(function (summary) {
          return summary + (info.width ? ' (' + info.width + 'x' + info.height + ')' : '');
        });
      });
    });
  }

  /* ---------------------------------------------------------- wiring */

  el.query.addEventListener('input', function () { selectedUrl = null; updateGoLabel(); });
  el.query.addEventListener('keydown', function (e) { if (e.key === 'Enter') el.go.click(); });
  el.query.addEventListener('paste', function () { setTimeout(updateGoLabel, 0); });
  el.go.addEventListener('click', function () {
    if (core.looksLikeUrl(el.query.value)) grab(); else doSearch();
  });
  el.what.addEventListener('click', function (e) {
    var w = e.target.getAttribute && e.target.getAttribute('data-what');
    if (w) { setWhat(w); saveSettings(); }
  });
  el.grab.addEventListener('click', grab);
  el.paste.addEventListener('click', function () { pasteClipboard(); });
  el.exportFrame.addEventListener('click', exportTimelineFrame);
  el.cancel.addEventListener('click', function () { if (job) job.cancel(); });
  el.folder.addEventListener('click', function () {
    var p = lastFolder ? Promise.resolve(lastFolder) : downloadDir();
    p.then(function (d) {
      fs.mkdirSync(d, { recursive: true });
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

  // Ctrl/Cmd+V anywhere in the panel (outside a text box) pastes into Premiere.
  function isTextField(n) { return n && (n.tagName === 'INPUT' && n.type === 'text' || n.tagName === 'TEXTAREA'); }
  document.addEventListener('paste', function (e) {
    if (isTextField(e.target)) return;
    e.preventDefault();
    var blobs = [];
    var items = (e.clipboardData && e.clipboardData.items) || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].kind === 'file') { var b = items[i].getAsFile(); if (b) blobs.push(b); }
    }
    pasteClipboard(blobs);
  });

  // Drag a link or an image from the browser (or files) onto the panel.
  document.addEventListener('dragover', function (e) { e.preventDefault(); document.body.classList.add('dragging'); });
  document.addEventListener('dragleave', function (e) { if (!e.relatedTarget) document.body.classList.remove('dragging'); });
  document.addEventListener('drop', function (e) {
    e.preventDefault();
    document.body.classList.remove('dragging');
    var dt = e.dataTransfer;
    var blobs = Array.prototype.slice.call(dt.files || []);
    var text = dt.getData('text/uri-list') || dt.getData('text/plain');
    text = text ? text.split(/\r?\n/).filter(function (l) { return l && l[0] !== '#'; })[0] : '';
    if (text) pasteClipboard(null, text);
    else if (blobs.length) pasteClipboard(blobs, '');
  });

  // Mask-free timecode entry: allow digits, ":" and "."
  [el.inPoint, el.outPoint].forEach(function (inp) {
    inp.addEventListener('input', function () { inp.value = inp.value.replace(/[^\d:.]/g, ''); });
  });

  /* ---------------------------------------------------------- boot */

  Host.keyInterest();
  setWhat('video');
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
