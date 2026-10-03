/*
 * Popline transcription: pull the audio of timeline clips with ffmpeg, then get word timings from
 * whisper.cpp (local, offline) or the OpenAI transcription API.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var os = require('os');
var util = require('./util.js');

// whisper.cpp ggml models (https://huggingface.co/ggerganov/whisper.cpp)
var MODELS = [
  { id: 'tiny', label: 'Tiny (75 MB, fastest)', file: 'ggml-tiny.bin' },
  { id: 'base', label: 'Base (142 MB, fast)', file: 'ggml-base.bin' },
  { id: 'small', label: 'Small (466 MB, accurate)', file: 'ggml-small.bin' },
  { id: 'large-v3-turbo-q5_0', label: 'Large v3 Turbo (547 MB, best)', file: 'ggml-large-v3-turbo-q5_0.bin' },
  { id: 'base.en', label: 'Base English-only (142 MB)', file: 'ggml-base.en.bin' },
  { id: 'small.en', label: 'Small English-only (466 MB)', file: 'ggml-small.en.bin' }
];
var MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/';

function modelDirs(extRoot) {
  var dirs = [];
  if (extRoot) dirs.push(path.join(extRoot, 'models'));
  dirs.push(path.join(os.homedir(), '.popline', 'models'));
  return dirs;
}

/** Models already on disk: [{id, label, path}] */
function installedModels(extRoot) {
  var found = [];
  modelDirs(extRoot).forEach(function (d) {
    var names;
    try { names = fs.readdirSync(d); } catch (e) { return; }
    names.filter(function (n) { return /^ggml-.*\.bin$/.test(n); }).forEach(function (n) {
      var known = MODELS.filter(function (m) { return m.file === n; })[0];
      if (found.some(function (f) { return path.basename(f.path) === n; })) return;
      found.push({ id: known ? known.id : n.replace(/^ggml-|\.bin$/g, ''), label: known ? known.label : n, path: path.join(d, n) });
    });
  });
  return found;
}

/** Download a whisper model with progress. Resolves to the saved path. */
function downloadModel(id, extRoot, onProgress) {
  var m = MODELS.filter(function (x) { return x.id === id; })[0];
  if (!m) return Promise.reject(new Error('Unknown model ' + id));
  var dir = modelDirs(extRoot)[extRoot ? 0 : 1];
  try { fs.mkdirSync(dir, { recursive: true }); fs.accessSync(dir, fs.constants.W_OK); } catch (e) { dir = modelDirs(null)[0]; fs.mkdirSync(dir, { recursive: true }); }
  var dest = path.join(dir, m.file), part = dest + '.part';
  return new Promise(function (resolve, reject) {
    (function get(url, hops) {
      require('https').get(url, { headers: { 'User-Agent': 'Popline' } }, function (res) {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops < 8) {
          res.resume();
          return get(new URL(res.headers.location, url).toString(), hops + 1);
        }
        if (res.statusCode !== 200) { res.resume(); return reject(new Error('Model download failed: HTTP ' + res.statusCode)); }
        var total = parseInt(res.headers['content-length'], 10) || 0, done = 0;
        var ws = fs.createWriteStream(part);
        res.on('data', function (c) { done += c.length; if (onProgress && total) onProgress(done / total * 100, done, total); });
        res.pipe(ws);
        ws.on('finish', function () { fs.renameSync(part, dest); resolve(dest); });
        ws.on('error', reject);
        res.on('error', reject);
      }).on('error', reject);
    })(MODEL_URL + m.file, 0);
  });
}

/**
 * Cut a clip's used range out of its media as 16 kHz mono WAV (what whisper wants).
 * src: { mediaPath, inSec, durSec }
 */
function extractAudio(tools, src, outWav) {
  var args = ['-hide_banner', '-v', 'error', '-y', '-ss', String(Math.max(0, src.inSec || 0))];
  if (src.durSec) args.push('-t', String(src.durSec));
  args.push('-i', src.mediaPath, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', outWav);
  return util.run(tools.ffmpeg, args).promise.then(function () { return outWav; });
}

function whisperArgs(modelPath, wav, outBase, opts) {
  opts = opts || {};
  var args = ['-m', modelPath, '-f', wav, '-oj', '-of', outBase,
    '-ml', '1', '-sow',            // one word per segment -> word timings
    '-pp',                          // progress lines
    '-l', opts.language || 'auto',
    '-t', String(opts.threads || Math.max(2, Math.min(8, os.cpus().length - 1)))];
  if (opts.translate) args.push('-tr');
  if (opts.prompt) args.push('--prompt', opts.prompt);
  return args;
}

/** whisper.cpp -oj JSON -> raw tokens [{text, start, end}] (seconds) */
function parseWhisperJson(json) {
  var data = typeof json === 'string' ? JSON.parse(json) : json;
  return (data.transcription || []).map(function (seg) {
    var from = seg.offsets ? seg.offsets.from : 0, to = seg.offsets ? seg.offsets.to : from;
    return { text: seg.text, start: from / 1000, end: to / 1000 };
  }).filter(function (t) { return t.text && t.text.trim(); });
}

/** Parse "progress = 37%" style lines from whisper.cpp -pp */
function parseWhisperProgress(line) {
  var m = /progress\s*=\s*(\d+)%/.exec(line);
  return m ? parseInt(m[1], 10) : null;
}

/** Run whisper.cpp on a wav. Returns {promise -> raw tokens (seconds, relative to the wav), cancel} */
function whisperLocal(tools, modelPath, wav, opts, hooks) {
  hooks = hooks || {};
  if (!tools.whisper) return { promise: Promise.reject(new Error('whisper.cpp (whisper-cli) not found. Run the installer or put it in bin/.')), cancel: function () {} };
  if (!modelPath || !util.isFile(modelPath)) return { promise: Promise.reject(new Error('No whisper model selected. Download one in the Transcribe tab.')), cancel: function () {} };
  var outBase = wav.replace(/\.wav$/i, '');
  var job = util.run(tools.whisper, whisperArgs(modelPath, wav, outBase, opts), function (line) {
    var p = parseWhisperProgress(line);
    if (p != null) { if (hooks.onProgress) hooks.onProgress(p); return; }
    if (hooks.onLine && /error|warning|failed/i.test(line)) hooks.onLine(line);
  });
  return {
    cancel: job.cancel,
    promise: job.promise.then(function () {
      return parseWhisperJson(fs.readFileSync(outBase + '.json', 'utf8'));
    })
  };
}

/* ------------------------------------------------------------ OpenAI API */

/** Compress for upload (API limit 25 MB): mono 16 kHz MP3 ~ 2 hours fits. */
function toUploadAudio(tools, wav) {
  var mp3 = wav.replace(/\.wav$/i, '.mp3');
  return util.run(tools.ffmpeg, ['-hide_banner', '-v', 'error', '-y', '-i', wav, '-c:a', 'libmp3lame', '-b:a', '24k', mp3]).promise.then(function () { return mp3; });
}

function multipart(fields, file) {
  var boundary = '----popline' + Date.now().toString(16);
  var chunks = [];
  Object.keys(fields).forEach(function (k) {
    [].concat(fields[k]).forEach(function (v) {
      chunks.push(Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="' + k + '"\r\n\r\n' + v + '\r\n'));
    });
  });
  chunks.push(Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="' + path.basename(file) + '"\r\nContent-Type: audio/mpeg\r\n\r\n'));
  chunks.push(fs.readFileSync(file));
  chunks.push(Buffer.from('\r\n--' + boundary + '--\r\n'));
  return { body: Buffer.concat(chunks), type: 'multipart/form-data; boundary=' + boundary };
}

/** OpenAI whisper-1 response (verbose_json, word granularity) -> raw tokens */
function parseOpenAIWords(resp) {
  return (resp.words || []).map(function (w) { return { text: ' ' + w.word, start: w.start, end: w.end }; });
}

function whisperOpenAI(tools, apiKey, wav, opts) {
  if (!apiKey) return Promise.reject(new Error('Enter your OpenAI API key in the Transcribe tab.'));
  return toUploadAudio(tools, wav).then(function (mp3) {
    var fields = { model: 'whisper-1', response_format: 'verbose_json', 'timestamp_granularities[]': 'word' };
    if (opts && opts.language && opts.language !== 'auto') fields.language = opts.language;
    if (opts && opts.prompt) fields.prompt = opts.prompt;
    var mp = multipart(fields, mp3);
    var endpoint = opts && opts.translate ? 'translations' : 'transcriptions';
    return new Promise(function (resolve, reject) {
      var req = require('https').request({
        method: 'POST', host: 'api.openai.com', path: '/v1/audio/' + endpoint,
        headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': mp.type, 'Content-Length': mp.body.length }
      }, function (res) {
        var buf = '';
        res.setEncoding('utf8');
        res.on('data', function (c) { buf += c; });
        res.on('end', function () {
          var j;
          try { j = JSON.parse(buf); } catch (e) { return reject(new Error('OpenAI: unexpected reply (HTTP ' + res.statusCode + ')')); }
          if (res.statusCode !== 200) return reject(new Error('OpenAI: ' + ((j.error && j.error.message) || 'HTTP ' + res.statusCode)));
          resolve(parseOpenAIWords(j));
        });
      });
      req.on('error', reject);
      req.end(mp.body);
    });
  });
}

/* ------------------------------------------------------------ whole job */

/**
 * Transcribe timeline clips and return words in sequence time.
 * sources: [{ mediaPath, inSec, startSec, endSec, speed }] from host.jsx
 * opts: { engine: 'local'|'openai', modelPath, apiKey, language, translate, prompt, workDir }
 * hooks: { onStatus(text), onProgress(pct), onLine(text) }
 */
function transcribeSources(tools, sources, opts, hooks) {
  hooks = hooks || {};
  var cancelled = false, current = null;
  var all = [];
  fs.mkdirSync(opts.workDir, { recursive: true });
  var chain = sources.reduce(function (p, src, i) {
    return p.then(function () {
      if (cancelled) throw Object.assign(new Error('Cancelled.'), { cancelled: true });
      var speed = src.speed && src.speed > 0 ? src.speed : 1;
      var dur = (src.endSec - src.startSec) * speed;
      var wav = path.join(opts.workDir, 'audio-' + (i + 1) + '.wav');
      if (hooks.onStatus) hooks.onStatus('Extracting audio ' + (i + 1) + '/' + sources.length + '…');
      return extractAudio(tools, { mediaPath: src.mediaPath, inSec: src.inSec, durSec: dur }, wav).then(function () {
        if (hooks.onStatus) hooks.onStatus('Transcribing ' + (i + 1) + '/' + sources.length + ' (' + Math.round(dur) + 's of audio)…');
        if (opts.engine === 'openai') return whisperOpenAI(tools, opts.apiKey, wav, opts);
        current = whisperLocal(tools, opts.modelPath, wav, opts, {
          onLine: hooks.onLine,
          onProgress: function (pct) { if (hooks.onProgress) hooks.onProgress((i + pct / 100) / sources.length * 100); }
        });
        return current.promise;
      }).then(function (tokens) {
        // Clip-relative -> sequence time (accounting for speed changes).
        tokens.forEach(function (t) {
          all.push({ text: t.text, start: src.startSec + t.start / speed, end: src.startSec + t.end / speed, src: i });
        });
      });
    });
  }, Promise.resolve());
  return {
    cancel: function () { cancelled = true; if (current) current.cancel(); },
    promise: chain.then(function () {
      all.sort(function (a, b) { return a.start - b.start; });
      return all;
    })
  };
}

module.exports = {
  MODELS: MODELS,
  installedModels: installedModels,
  downloadModel: downloadModel,
  extractAudio: extractAudio,
  whisperArgs: whisperArgs,
  parseWhisperJson: parseWhisperJson,
  parseWhisperProgress: parseWhisperProgress,
  whisperLocal: whisperLocal,
  parseOpenAIWords: parseOpenAIWords,
  multipart: multipart,
  transcribeSources: transcribeSources
};
