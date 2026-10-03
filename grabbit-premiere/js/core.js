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


/* ------------------------------------------------------ stills & paste */

var IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'tif', 'tiff', 'psd', 'ai', 'eps', 'tga', 'exr', 'dpx'];
var CONVERT_EXT = ['webp', 'avif', 'heic', 'heif', 'jfif'];   // Premiere can't import these; turn them into PNG
var MEDIA_EXT = IMAGE_EXT.concat(CONVERT_EXT, ['mp4', 'mov', 'm4v', 'mkv', 'webm', 'avi', 'mxf', 'mts', 'm2ts', 'mpg', 'mpeg', 'wmv', 'flv',
  'mp3', 'wav', 'aif', 'aiff', 'm4a', 'aac', 'flac', 'ogg', 'opus']);

function extOf(p) {
  var m = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(String(p));
  return m ? m[1].toLowerCase() : '';
}

function isMediaPath(p) {
  return MEDIA_EXT.indexOf(extOf(p)) >= 0;
}

function safeName(s) {
  return String(s || 'untitled').replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'untitled';
}

function stamp() {
  var d = new Date();
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + '.' + p2(d.getMinutes()) + '.' + p2(d.getSeconds());
}

/** a/b/name.png -> a/b/name (2).png if it exists. */
function uniquePath(p) {
  if (!fs.existsSync(p)) return p;
  var ext = path.extname(p), base = p.slice(0, p.length - ext.length);
  for (var i = 2; ; i++) {
    var c = base + ' (' + i + ')' + ext;
    if (!fs.existsSync(c)) return c;
  }
}

/** "1m05s" style tag for filenames. */
function timeTag(secs) {
  var m = Math.floor(secs / 60), s = secs - m * 60;
  var ss = (Math.round(s * 100) / 100).toString();
  return (m ? m + 'm' : '') + ss + 's';
}

var PS_CLIPBOARD = [
  "$ErrorActionPreference = 'Stop'",
  '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
  'Add-Type -AssemblyName System.Windows.Forms, System.Drawing',
  "$out = '__OUT__'",
  '$d = [Windows.Forms.Clipboard]::GetDataObject()',
  "if ($d -eq $null) { 'EMPTY'; exit }",
  'if ($d.GetDataPresent([Windows.Forms.DataFormats]::FileDrop)) { foreach ($f in $d.GetData([Windows.Forms.DataFormats]::FileDrop)) { "FILE`t$f" }; exit }',
  "if ($d.GetDataPresent('PNG')) { $ms = $d.GetData('PNG'); if ($ms -is [IO.Stream]) { $fs = [IO.File]::Create($out); $ms.CopyTo($fs); $fs.Close(); \"IMAGE`t$out\"; exit } }",
  'if ($d.GetDataPresent([Windows.Forms.DataFormats]::Bitmap)) { $img = [Windows.Forms.Clipboard]::GetImage(); $img.Save($out, [Drawing.Imaging.ImageFormat]::Png); "IMAGE`t$out"; exit }',
  'if ($d.GetDataPresent([Windows.Forms.DataFormats]::UnicodeText)) { "TEXT`t" + $d.GetData([Windows.Forms.DataFormats]::UnicodeText); exit }',
  "'EMPTY'"
].join('\n');

var JXA_CLIPBOARD = [
  "ObjC.import('AppKit');",
  'function run(argv) {',
  '  var out = argv[0], pb = $.NSPasteboard.generalPasteboard;',
  '  var opts = $.NSDictionary.dictionaryWithObjectForKey($.NSNumber.numberWithBool(true), $.NSPasteboardURLReadingFileURLsOnlyKey);',
  '  var urls = pb.readObjectsForClassesOptions($.NSArray.arrayWithObject($.NSURL), opts);',
  '  if (urls && !urls.isNil() && urls.count > 0) {',
  '    var lines = [];',
  "    for (var i = 0; i < urls.count; i++) lines.push('FILE\\t' + ObjC.unwrap(urls.objectAtIndex(i).path));",
  "    return lines.join('\\n');",
  '  }',
  "  var data = pb.dataForType('public.png');",
  '  if (data.isNil()) {',
  "    var tiff = pb.dataForType('public.tiff');",
  '    if (!tiff.isNil()) data = $.NSBitmapImageRep.imageRepWithData(tiff).representationUsingTypeProperties(4, $.NSDictionary.dictionary);',
  '  }',
  "  if (!data.isNil()) { data.writeToFileAtomically(out, true); return 'IMAGE\\t' + out; }",
  "  var s = pb.stringForType('public.utf8-plain-text');",
  "  if (!s.isNil()) return 'TEXT\\t' + ObjC.unwrap(s);",
  "  return 'EMPTY';",
  '}'
].join('\n');

/** Parse the helper output: FILE<TAB>path lines | IMAGE<TAB>path | TEXT<TAB>text | EMPTY */
function parseClipboardOutput(out) {
  out = String(out || '').replace(/^﻿/, '').replace(/\s+$/, '');
  if (/^TEXT\t/.test(out)) return { kind: 'text', text: out.slice(5) };
  if (/^IMAGE\t/.test(out)) return { kind: 'image', files: [out.slice(6).trim()] };
  var files = out.split(/\r?\n/).filter(function (l) { return /^FILE\t/.test(l); }).map(function (l) { return l.slice(5).trim(); });
  if (files.length) return { kind: 'files', files: files };
  return { kind: 'empty' };
}

/** Read the OS clipboard. Images are saved as PNG into outDir. */
function readClipboard(outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  var out = uniquePath(path.join(outDir, 'Pasted ' + stamp() + '.png'));
  var p;
  if (IS_WIN) {
    var script = PS_CLIPBOARD.replace('__OUT__', out.replace(/'/g, "''"));
    p = capture('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass',
      '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]);
  } else if (process.platform === 'darwin') {
    p = capture('osascript', ['-l', 'JavaScript', '-e', JXA_CLIPBOARD, out]);
  } else {
    return Promise.reject(new Error('Reading the clipboard is supported on Windows and macOS.'));
  }
  return p.then(parseClipboardOutput);
}

var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
var TYPE_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif',
  'image/bmp': 'bmp', 'image/tiff': 'tif', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
  'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mp4': 'm4a' };

/**
 * GET a URL. If it serves an image/video/audio file, save it into outDir and resolve {file}.
 * Otherwise (a web page) resolve {notMedia: true} without downloading the body.
 */
function fetchMedia(url, outDir, redirects) {
  redirects = redirects || 0;
  return new Promise(function (resolve, reject) {
    var mod = /^https:/i.test(url) ? require('https') : require('http');
    var req = mod.get(url, { headers: { 'User-Agent': UA, 'Accept': '*/*' }, timeout: 30000 }, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 6) {
        res.resume();
        return resolve(fetchMedia(new URL(res.headers.location, url).toString(), outDir, redirects + 1));
      }
      var type = String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (res.statusCode !== 200 || !/^(image|video|audio)\//.test(type) || type === 'image/svg+xml') {
        res.destroy();
        return resolve({ notMedia: true, status: res.statusCode, type: type });
      }
      var name = '';
      var cd = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(res.headers['content-disposition'] || '');
      if (cd) name = decodeURIComponent(cd[1]);
      if (!name) { try { name = decodeURIComponent(path.basename(new URL(url).pathname)); } catch (e) {} }
      var ext = extOf(name);
      if (!ext || MEDIA_EXT.indexOf(ext) < 0) { ext = TYPE_EXT[type] || type.split('/')[1]; name = (name.replace(/\.[^.]*$/, '') || 'Pasted') + '.' + ext; }
      fs.mkdirSync(outDir, { recursive: true });
      var file = uniquePath(path.join(outDir, safeName(name.replace(/\.[^.]*$/, '')) + '.' + ext));
      var ws = fs.createWriteStream(file);
      res.pipe(ws);
      ws.on('finish', function () { resolve({ file: file, type: type }); });
      ws.on('error', reject);
      res.on('error', reject);
    });
    req.on('timeout', function () { req.destroy(new Error('Timed out fetching ' + url)); });
    req.on('error', reject);
  });
}

/**
 * Convert formats Premiere can't import (webp, avif...) to PNG. Resolves to the importable path.
 * opts.outDir: where to write the PNG (default: beside the source). opts.keep: leave the source alone.
 */
function ensureImportable(tools, file, opts) {
  opts = opts || {};
  if (CONVERT_EXT.indexOf(extOf(file)) < 0) return Promise.resolve(file);
  if (!tools.ffmpeg) return Promise.reject(new Error('ffmpeg is needed to convert ' + path.basename(file) + ' to PNG.'));
  var dir = opts.outDir || path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  var out = uniquePath(path.join(dir, path.basename(file).replace(/\.[^.]+$/, '') + '.png'));
  return run(tools.ffmpeg, ['-hide_banner', '-v', 'error', '-y', '-i', file, '-frames:v', '1', '-update', '1', out]).promise.then(function () {
    if (!opts.keep) { try { fs.unlinkSync(file); } catch (e) {} }
    return out;
  });
}

function isStill(p) {
  return IMAGE_EXT.indexOf(extOf(p)) >= 0;
}

function commonYtArgs(tools, opts) {
  var a = ['--no-playlist', '--no-warnings', '--encoding', 'utf-8'];
  if (tools.ffmpeg) a.push('--ffmpeg-location', tools.ffmpeg);
  if (tools.deno) a.push('--js-runtimes', 'deno:' + tools.deno);
  if (opts && opts.cookiesFromBrowser) a.push('--cookies-from-browser', opts.cookiesFromBrowser);
  return a;
}

/** Download the best thumbnail of a video page as PNG. Resolves to the file path. */
function grabThumbnail(tools, opts, hooks) {
  hooks = hooks || {};
  if (!tools.ytdlp) return { promise: Promise.reject(new Error('yt-dlp not found.')), cancel: function () {} };
  fs.mkdirSync(opts.outDir, { recursive: true });
  var id = null;
  var started = Date.now() - 1000;
  var args = commonYtArgs(tools, opts).concat([
    '--skip-download', '--no-simulate', '--write-thumbnail', '--convert-thumbnails', 'png', '--windows-filenames',
    '-o', path.join(opts.outDir, '%(title).80B [%(id)s].%(ext)s'),
    '-o', 'thumbnail:' + path.join(opts.outDir, '%(title).80B [%(id)s] thumbnail.%(ext)s'),
    '--print', 'GRABBIT_ID %(id)s',
    opts.url
  ]);
  var job = run(tools.ytdlp, args, function (line) {
    var m = /GRABBIT_ID (.+)$/.exec(line);
    if (m) { id = m[1].trim(); return; }
    if (hooks.onLine) hooks.onLine(line);
  });
  return {
    cancel: job.cancel,
    promise: job.promise.then(function () {
      var hits = fs.readdirSync(opts.outDir).filter(function (n) {
        return (!id || n.indexOf('[' + id + '] thumbnail.') >= 0) && / thumbnail\.(png|jpe?g|webp)$/i.test(n);
      }).map(function (n) { var f = path.join(opts.outDir, n); return { f: f, t: fs.statSync(f).mtimeMs }; })
        .filter(function (x) { return x.t >= started; })
        .sort(function (a, b) { return b.t - a.t; });
      if (!hits.length) throw new Error('No thumbnail found for this video.');
      return ensureImportable(tools, hits[0].f);
    })
  };
}

/** Pick the stream URL + headers ffmpeg should read, from yt-dlp -j output. */
function pickStream(info) {
  var f = info;
  if (info.requested_formats && info.requested_formats.length) {
    f = info.requested_formats.filter(function (x) { return x.vcodec && x.vcodec !== 'none'; })[0] || info.requested_formats[0];
  }
  return { url: f.url, headers: f.http_headers || info.http_headers || {} };
}

function headerArgs(headers) {
  var keys = Object.keys(headers || {});
  if (!keys.length) return [];
  return ['-headers', keys.map(function (k) { return k + ': ' + headers[k]; }).join('\r\n') + '\r\n'];
}

/**
 * Grab one frame from a video page at `secs` as a PNG, without downloading the whole video:
 * yt-dlp resolves the stream URL, ffmpeg seeks into it and decodes a single frame.
 */
function grabFrame(tools, opts, hooks) {
  hooks = hooks || {};
  if (!tools.ytdlp || !tools.ffmpeg) return { promise: Promise.reject(new Error('yt-dlp and ffmpeg are needed.')), cancel: function () {} };
  var cancelled = false, current = null;
  var h = parseInt(opts.maxHeight, 10) || 2160;
  var sel = 'bv*[height<=' + h + ']/b[height<=' + h + ']/bv*/b';
  var promise = capture(tools.ytdlp, commonYtArgs(tools, opts).concat(['-f', sel, '-j', opts.url])).then(function (out) {
    if (cancelled) throw Object.assign(new Error('Cancelled.'), { cancelled: true });
    var info = JSON.parse(out.split(/\r?\n/).filter(Boolean)[0]);
    if (info.duration && opts.secs >= info.duration) throw new Error('Frame time ' + formatDuration(opts.secs) + ' is past the end of the video (' + formatDuration(info.duration) + ').');
    var s = pickStream(info);
    if (hooks.onLine) hooks.onLine('Seeking to ' + formatDuration(opts.secs) + ' in ' + (info.format_id ? 'format ' + info.format_id : 'stream') + (info.height ? ' (' + info.height + 'p)' : ''));
    fs.mkdirSync(opts.outDir, { recursive: true });
    var file = uniquePath(path.join(opts.outDir, safeName(info.title) + ' [' + info.id + '] @ ' + timeTag(opts.secs) + '.png'));
    current = extractFrame(tools, s.url, opts.secs, file, s.headers);
    return current.promise;
  });
  return { promise: promise, cancel: function () { cancelled = true; if (current) current.cancel(); } };
}

/** ffmpeg: decode exactly one frame at `secs` from a file or URL. */
function extractFrame(tools, input, secs, out, headers) {
  var args = ['-hide_banner', '-v', 'error', '-y'].concat(headerArgs(headers), ['-ss', String(secs || 0), '-i', input,
    '-frames:v', '1', '-update', '1', out]);
  var job = run(tools.ffmpeg, args);
  return {
    cancel: job.cancel,
    promise: job.promise.then(function () {
      if (!isFile(out) || fs.statSync(out).size === 0) throw new Error('No frame at ' + formatDuration(secs) + '.');
      return out;
    })
  };
}

/** Convert a PNG to JPEG (e.g. for a YouTube thumbnail upload). */
function toJpeg(tools, png, keepPng) {
  var out = uniquePath(png.replace(/\.png$/i, '') + '.jpg');
  return run(tools.ffmpeg, ['-hide_banner', '-v', 'error', '-y', '-i', png, '-q:v', '2', out]).promise.then(function () {
    if (!keepPng) { try { fs.unlinkSync(png); } catch (e) {} }
    return out;
  });
}

/** Wait for a file to appear and stop growing (Premiere writes exported frames asynchronously). */
function waitForFile(candidates, timeoutMs) {
  var deadline = Date.now() + (timeoutMs || 15000);
  var lastSize = -1;
  return new Promise(function (resolve, reject) {
    (function poll() {
      for (var i = 0; i < candidates.length; i++) {
        if (isFile(candidates[i])) {
          var size = fs.statSync(candidates[i]).size;
          if (size > 0 && size === lastSize) return resolve(candidates[i]);
          lastSize = size;
          return setTimeout(poll, 150);
        }
      }
      if (Date.now() > deadline) return reject(new Error('Premiere did not write the frame (' + path.basename(candidates[0]) + ').'));
      setTimeout(poll, 150);
    })();
  });
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
  openFolder: openFolder,
  extOf: extOf,
  isMediaPath: isMediaPath,
  isStill: isStill,
  safeName: safeName,
  stamp: stamp,
  uniquePath: uniquePath,
  timeTag: timeTag,
  parseClipboardOutput: parseClipboardOutput,
  readClipboard: readClipboard,
  fetchMedia: fetchMedia,
  ensureImportable: ensureImportable,
  grabThumbnail: grabThumbnail,
  grabFrame: grabFrame,
  pickStream: pickStream,
  extractFrame: extractFrame,
  toJpeg: toJpeg,
  waitForFile: waitForFile
};
