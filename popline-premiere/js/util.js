/*
 * Popline utilities: finding and running the command-line tools (ffmpeg, whisper.cpp).
 * Shared shape with Grabbit's core.js. Plain Node, no CEP dependencies.
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
  : ['/opt/homebrew/bin', '/opt/homebrew/opt/whisper-cpp/bin', '/usr/local/bin', '/usr/bin', path.join(os.homedir(), '.deno', 'bin'), path.join(os.homedir(), '.local', 'bin')];

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
    ffmpeg: resolveTool('ffmpeg', extRoot),
    ffprobe: resolveTool('ffprobe', extRoot),
    // whisper.cpp renamed its CLI over time: whisper-cli (current), whisper-cpp (Homebrew), main (old builds)
    whisper: resolveTool('whisper-cli', extRoot) || resolveTool('whisper-cpp', extRoot) || resolveTool('whisper', extRoot) ||
      (extRoot ? (function () { var p = path.join(extRoot, 'bin', exeName('main')); return isFile(p) ? p : null; })() : null)
  };
}

function childEnv() {
  var env = Object.assign({}, process.env);
  env.PATH = [env.PATH || ''].concat(EXTRA_DIRS).join(path.delimiter);
  env.PYTHONIOENCODING = 'utf-8';
  env.PYTHONUTF8 = '1';
  return env;
}

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

/** a/b/name.png -> a/b/name (2).png if it exists. */
function uniquePath(p) {
  if (!fs.existsSync(p)) return p;
  var ext = path.extname(p), base = p.slice(0, p.length - ext.length);
  for (var i = 2; ; i++) {
    var c = base + ' (' + i + ')' + ext;
    if (!fs.existsSync(c)) return c;
  }
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
  IS_WIN: IS_WIN,
  exeName: exeName,
  isFile: isFile,
  resolveTool: resolveTool,
  resolveTools: resolveTools,
  childEnv: childEnv,
  run: run,
  capture: capture,
  uniquePath: uniquePath,
  openFolder: openFolder
};
