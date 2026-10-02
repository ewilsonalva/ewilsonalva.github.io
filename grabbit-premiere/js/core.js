/*
 * Grabbit core: everything that talks to yt-dlp / ffmpeg / ffprobe.
 * Plain Node (CommonJS) with no CEP dependencies, so it can be unit tested
 * outside Premiere (see test/core.test.js).
 */
'use strict';

var childProcess = require('child_process');
var fs = require('fs');
var path = require('path');
var os = require('os');

var IS_WIN = process.platform === 'win32';

// Premiere launched from the Dock/Explorer doesn't inherit your shell PATH,
// so these common install locations are searched as well.
var EXTRA_DIRS = IS_WIN
  ? [
      path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links'),
      'C:\\ffmpeg\\bin',
      path.join(process.env.USERPROFILE || '', 'scoop', 'shims'),
      'C:\\ProgramData\\chocolatey\\bin'
    ]
  : ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', path.join(os.homedir(), '.deno', 'bin'), path.join(os.homedir(), '.local', 'bin')];

function exeName(name) {
  return IS_WIN ? name + '.exe' : name;
}

function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch (e) { return false; }
}

/** Find a tool: <extension>/bin first, then PATH, then common install dirs. Returns null if missing. */
function resolveTool(name, extRoot) {
  var file = exeName(name);
  var candidates = [];
  if (extRoot) candidates.push(path.join(extRoot, 'bin', file));
  var pathDirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  pathDirs.concat(EXTRA_DIRS).forEach(function (d) { candidates.push(path.join(d, file)); });
  for (var i = 0; i < candidates.length; i++) {
    if (isFile(candidates[i])) return candidates[i];
  }
  return null;
}

function resolveTools(extRoot) {
  return {
    ytdlp: resolveTool('yt-dlp', extRoot),
    ffmpeg: resolveTool('ffmpeg', extRoot),
    ffprobe: resolveTool('ffprobe', extRoot),
    deno: resolveTool('deno', extRoot)
  };
}

function childEnv() {
  var env = Object.assign({}, process.env);
  env.PATH = [env.PATH || ''].concat(EXTRA_DIRS).join(path.delimiter);
  env.PYTHONIOENCODING = 'utf-8';
  env.PYTHONUTF8 = '1';
  return env;
}

/* ---------------------------------------------------------------- parsing */

function looksLikeUrl(text) {
  var t = String(text || '').trim();
  return /^https?:\/\//i.test(t) || /^(www\.)?(youtube\.com|youtu\.be|m\.youtube\.com|vimeo\.com|tiktok\.com|instagram\.com|x\.com|twitter\.com)\//i.test(t);
}

function normalizeUrl(text) {
  var t = String(text || '').trim();
  return /^https?:\/\//i.test(t) ? t : 'https://' + t;
}

/** "1:02:03.5", "2:15", "95", "95.5" -> seconds. Empty / "0:00" -> null. Throws on garbage. */
function parseTimecode(text) {
  var t = String(text == null ? '' : text).trim();
  if (!t) return null;
  if (!/^\d+(\.\d+)?$|^\d+:\d{1,2}(\.\d+)?$|^\d+:\d{1,2}:\d{1,2}(\.\d+)?$/.test(t)) {
    throw new Error('Bad timecode "' + t + '". Use seconds, m:ss or h:mm:ss.');
  }
  var parts = t.split(':').map(parseFloat);
  var secs = 0;
  for (var i = 0; i < parts.length; i++) secs = secs * 60 + parts[i];
  return secs > 0 ? secs : null;
}

function formatDuration(secs) {
  if (secs == null || isNaN(secs)) return '';
  secs = Math.round(secs);
  var h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
  var ss = (s < 10 ? '0' : '') + s;
  return h ? h + ':' + (m < 10 ? '0' : '') + m + ':' + ss : m + ':' + ss;
}

/**
 * yt-dlp -f selector. Premiere edits H.264 smoothly but chokes on VP9/AV1, and
 * YouTube only serves H.264 up to 1080p, so: prefer avc1+m4a at or below the
 * cap, then fall back to the best available (which the encode step will fix).
 */
function formatSelector(maxHeight) {
  var h = parseInt(maxHeight, 10);
  var cap = h > 0 ? '[height<=' + h + ']' : '';
  if (h > 1080 || !h) {
    // User asked for >1080p: resolution wins over codec.
    return 'bv*' + cap + '+ba[ext=m4a]/bv*' + cap + '+ba/b' + cap + '/b';
  }
  return [
    'bv*' + cap + '[vcodec^=avc1]+ba[ext=m4a]',
    'b' + cap + '[vcodec^=avc1][acodec^=mp4a]',
    'bv*' + cap + '+ba',
    'b' + cap,
    'b'
  ].join('/');
}

function sectionArg(inSecs, outSecs) {
  if (inSecs == null && outSecs == null) return null;
  if (inSecs != null && outSecs != null && outSecs <= inSecs) {
    throw new Error('Out point must be after the in point.');
  }
  return '*' + (inSecs || 0) + '-' + (outSecs == null ? 'inf' : outSecs);
}

var PROGRESS_TAG = 'GRABBIT_PROGRESS';
var FILE_TAG = 'GRABBIT_FILE';

function buildDownloadArgs(opts, tools) {
  var args = [
    '--newline', '--no-quiet', '--no-playlist', '--no-mtime', '--no-part',
    '--encoding', 'utf-8',
    '--windows-filenames',
    '-f', formatSelector(opts.maxHeight),
    '--merge-output-format', 'mp4',
    '-o', path.join(opts.outDir, '%(title).80B [%(id)s].%(ext)s'),
    '--progress',
    '--progress-template', 'download:' + PROGRESS_TAG + ' %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s %(progress.speed)s %(progress.eta)s',
    '--print', 'after_move:' + FILE_TAG + ' %(filepath)s'
  ];
  if (tools.ffmpeg) args.push('--ffmpeg-location', tools.ffmpeg);
  if (tools.deno) args.push('--js-runtimes', 'deno:' + tools.deno);
  var section = sectionArg(opts.inSecs, opts.outSecs);
  if (section) args.push('--download-sections', section, '--force-keyframes-at-cuts');
  if (opts.cookiesFromBrowser) args.push('--cookies-from-browser', opts.cookiesFromBrowser);
  args.push(opts.url);
  return args;
}

function num(s) {
  var n = parseFloat(s);
  return isNaN(n) ? null : n;
}

/** Parse one line of our --progress-template output. Returns null for other lines. */
function parseProgressLine(line) {
  var idx = line.indexOf(PROGRESS_TAG + ' ');
  if (idx < 0) return null;
  var f = line.slice(idx + PROGRESS_TAG.length + 1).trim().split(/\s+/);
  var done = num(f[0]), total = num(f[1]) || num(f[2]);
  return {
    downloaded: done,
    total: total,
    percent: done != null && total ? Math.min(100, (done / total) * 100) : null,
    speed: num(f[3]),
    eta: num(f[4])
  };
}

/* ------------------------------------------------------------- processes */

/** Spawn a tool, stream stdout+stderr lines to onLine. Returns {promise, cancel}. */
function run(cmd, args, onLine) {
  var child = childProcess.spawn(cmd, args, { env: childEnv(), windowsHide: true });
  var cancelled = false;
  var tail = [];
  function pump(stream) {
    var buf = '';
    stream.setEncoding('utf8');
    stream.on('data', function (chunk) {
      buf += chunk;
      var lines = buf.split(/\r\n|\n|\r/);
      buf = lines.pop();
      lines.forEach(emit);
    });
    stream.on('end', function () { if (buf) emit(buf); });
  }
  function emit(line) {
    if (!line) return;
    tail.push(line);
    if (tail.length > 30) tail.shift();
    if (onLine) onLine(line);
  }
  pump(child.stdout);
  pump(child.stderr);
  var promise = new Promise(function (resolve, reject) {
    child.on('error', function (err) {
      reject(err.code === 'ENOENT' ? new Error(path.basename(cmd) + ' not found. Put it in the extension bin/ folder or on PATH.') : err);
    });
    child.on('close', function (code) {
      if (cancelled) return reject(Object.assign(new Error('Cancelled.'), { cancelled: true }));
      if (code === 0) return resolve();
      var errLines = tail.filter(function (l) { return /ERROR|Error|error:/.test(l); });
      reject(new Error((errLines.length ? errLines.slice(-2).join('\n') : tail.slice(-3).join('\n')) || path.basename(cmd) + ' exited with code ' + code));
    });
  });
  function cancel() {
    if (child.exitCode != null) return;
    cancelled = true;
    if (IS_WIN) {
      // yt-dlp spawns ffmpeg; kill the whole tree.
      childProcess.spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    } else {
      child.kill('SIGTERM');
    }
  }
  return { promise: promise, cancel: cancel, child: child };
}

/** Capture full stdout of a tool (for JSON output). */
function capture(cmd, args) {
  return new Promise(function (resolve, reject) {
    childProcess.execFile(cmd, args, { env: childEnv(), windowsHide: true, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' },
      function (err, stdout, stderr) {
        if (err) {
          var msg = (stderr || '').split(/\r?\n/).filter(function (l) { return /ERROR/.test(l); }).join('\n');
          return reject(new Error(msg || err.message));
        }
        resolve(stdout);
      });
  });
}

/* ------------------------------------------------------------- features */

function mapSearchEntry(e) {
  var id = e.id;
  var thumbs = e.thumbnails || [];
  return {
    id: id,
    title: e.title || id,
    url: e.url && /^https?:/.test(e.url) ? e.url : 'https://www.youtube.com/watch?v=' + id,
    channel: e.channel || e.uploader || '',
    duration: e.duration || null,
    views: e.view_count || null,
    thumbnail: id ? 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg' : (thumbs.length ? thumbs[thumbs.length - 1].url : '')
  };
}

/** YouTube search via yt-dlp. Resolves to an array of results. */
function search(tools, query, count) {
  if (!tools.ytdlp) return Promise.reject(new Error('yt-dlp not found.'));
  var args = ['--flat-playlist', '--dump-single-json', '--no-warnings', '--encoding', 'utf-8',
    'ytsearch' + (count || 12) + ':' + query];
  if (tools.deno) args.unshift('--js-runtimes', 'deno:' + tools.deno);
  return capture(tools.ytdlp, args).then(function (out) {
    var data = JSON.parse(out);
    return (data.entries || []).filter(function (e) { return e && e.id; }).map(mapSearchEntry);
  });
}

/**
 * Download one URL. opts: {url, outDir, maxHeight, inSecs, outSecs, cookiesFromBrowser}
 * hooks: {onLine(line), onProgress(p)}. Returns {promise -> filepath, cancel}.
 */
function download(tools, opts, hooks) {
  hooks = hooks || {};
  if (!tools.ytdlp) return { promise: Promise.reject(new Error('yt-dlp not found.')), cancel: function () {} };
  fs.mkdirSync(opts.outDir, { recursive: true });
  var filepath = null;
  var job = run(tools.ytdlp, buildDownloadArgs(opts, tools), function (line) {
    var p = parseProgressLine(line);
    if (p) { if (hooks.onProgress) hooks.onProgress(p); return; }
    var fi = line.indexOf(FILE_TAG + ' ');
    if (fi >= 0) { filepath = line.slice(fi + FILE_TAG.length + 1).trim(); return; }
    if (hooks.onLine) hooks.onLine(line);
  });
  return {
    cancel: job.cancel,
    promise: job.promise.then(function () {
      if (!filepath || !isFile(filepath)) throw new Error('yt-dlp finished but no output file was reported.');
      return filepath;
    })
  };
}

/** ffprobe a file -> {vcodec, acodec, pixFmt, duration, width, height} */
function probe(tools, file) {
  if (!tools.ffprobe) return Promise.reject(new Error('ffprobe not found.'));
  return capture(tools.ffprobe, ['-v', 'error', '-show_entries',
    'stream=codec_type,codec_name,pix_fmt,width,height:format=duration', '-of', 'json', file])
    .then(function (out) {
      var j = JSON.parse(out);
      var v = (j.streams || []).filter(function (s) { return s.codec_type === 'video'; })[0] || {};
      var a = (j.streams || []).filter(function (s) { return s.codec_type === 'audio'; })[0] || {};
      return {
        vcodec: v.codec_name || null,
        acodec: a.codec_name || null,
        pixFmt: v.pix_fmt || null,
        width: v.width || null,
        height: v.height || null,
        duration: j.format && j.format.duration ? parseFloat(j.format.duration) : null
      };
    });
}

var EDITABLE_VIDEO = ['h264', 'hevc', 'prores'];
var EDITABLE_AUDIO = ['aac', 'pcm_s16le', 'pcm_s24le', 'mp3', null];

/** Does this file need transcoding for Premiere under the given mode? */
function needsEncode(info, mode) {
  if (mode === 'never') return false;
  if (mode === 'h264' || mode === 'prores') return true;
  // auto
  if (!info.vcodec) return EDITABLE_AUDIO.indexOf(info.acodec) < 0;
  if (EDITABLE_VIDEO.indexOf(info.vcodec) < 0) return true;
  if (EDITABLE_AUDIO.indexOf(info.acodec) < 0) return true;
  // 10-bit / 4:4:4 H.264 decodes poorly in Premiere.
  return info.vcodec === 'h264' && !!info.pixFmt && info.pixFmt !== 'yuv420p' && info.pixFmt !== 'yuvj420p';
}

function buildEncodeArgs(input, output, mode, info) {
  var args = ['-hide_banner', '-y', '-i', input, '-map', '0:v:0?', '-map', '0:a:0?'];
  if (mode === 'prores') {
    args.push('-c:v', 'prores_ks', '-profile:v', '2', '-pix_fmt', 'yuv422p10le', '-c:a', 'pcm_s16le');
  } else {
    args.push('-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p');
    // Copy audio when it's already AAC, else encode.
    if (info && info.acodec === 'aac') args.push('-c:a', 'copy');
    else args.push('-c:a', 'aac', '-b:a', '320k');
    args.push('-movflags', '+faststart');
  }
  args.push('-progress', 'pipe:1', '-nostats', output);
  return args;
}

function encodedPath(input, mode) {
  var ext = mode === 'prores' ? '.mov' : '.mp4';
  var base = input.replace(/\.[^.\\/]+$/, '');
  return base + (mode === 'prores' ? ' [prores]' : ' [h264]') + ext;
}

/**
 * Transcode for smooth editing. Returns {promise -> outputPath, cancel}.
 * mode: 'h264' | 'prores'. If keepOriginal is false the source is deleted.
 */
function encode(tools, input, mode, info, hooks, keepOriginal) {
  hooks = hooks || {};
  if (!tools.ffmpeg) return { promise: Promise.reject(new Error('ffmpeg not found.')), cancel: function () {} };
  var output = encodedPath(input, mode === 'prores' ? 'prores' : 'h264');
  var duration = info && info.duration;
  var job = run(tools.ffmpeg, buildEncodeArgs(input, output, mode === 'prores' ? 'prores' : 'h264', info), function (line) {
    var m = /^out_time_(?:us|ms)=(\d+)/.exec(line);
    if (m) {
      if (duration && hooks.onProgress) hooks.onProgress({ percent: Math.min(100, (parseInt(m[1], 10) / 1e6 / duration) * 100) });
      return;
    }
    if (/^[a-z_]+=/.test(line)) return; // other -progress keys
    if (hooks.onLine) hooks.onLine(line);
  });
  return {
    cancel: function () { job.cancel(); setTimeout(function () { try { fs.unlinkSync(output); } catch (e) {} }, 500); },
    promise: job.promise.then(function () {
      if (!keepOriginal) { try { fs.unlinkSync(input); } catch (e) {} }
      return output;
    })
  };
}

function version(cmd, args) {
  return capture(cmd, args).then(function (out) { return out.split(/\r?\n/)[0].trim(); });
}

function openFolder(dir) {
  var cmd = IS_WIN ? 'explorer' : (process.platform === 'darwin' ? 'open' : 'xdg-open');
  childProcess.spawn(cmd, [dir], { detached: true, stdio: 'ignore' }).unref();
}

module.exports = {
  resolveTool: resolveTool,
  resolveTools: resolveTools,
  looksLikeUrl: looksLikeUrl,
  normalizeUrl: normalizeUrl,
  parseTimecode: parseTimecode,
  formatDuration: formatDuration,
  formatSelector: formatSelector,
  sectionArg: sectionArg,
  buildDownloadArgs: buildDownloadArgs,
  parseProgressLine: parseProgressLine,
  needsEncode: needsEncode,
  buildEncodeArgs: buildEncodeArgs,
  encodedPath: encodedPath,
  mapSearchEntry: mapSearchEntry,
  run: run,
  search: search,
  download: download,
  probe: probe,
  encode: encode,
  version: version,
  openFolder: openFolder
};
