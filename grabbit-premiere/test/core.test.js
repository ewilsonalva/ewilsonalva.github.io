/*
 * node --test test/
 * Unit tests always run. The end-to-end test runs when yt-dlp, ffmpeg and ffprobe
 * are installed: it serves a generated VP9 clip over local HTTP and runs the real
 * download -> probe -> encode pipeline the panel uses.
 */
'use strict';

var test = require('node:test');
var assert = require('node:assert');
var path = require('path');
var fs = require('fs');
var os = require('os');
var http = require('http');
var childProcess = require('child_process');
var core = require('../js/core.js');

test('parseTimecode', function () {
  assert.strictEqual(core.parseTimecode(''), null);
  assert.strictEqual(core.parseTimecode('0:00'), null);
  assert.strictEqual(core.parseTimecode('95'), 95);
  assert.strictEqual(core.parseTimecode('1:05'), 65);
  assert.strictEqual(core.parseTimecode('1:02:03.5'), 3723.5);
  assert.throws(function () { core.parseTimecode('1:2:3:4'); });
  assert.throws(function () { core.parseTimecode('abc'); });
});

test('sectionArg', function () {
  assert.strictEqual(core.sectionArg(null, null), null);
  assert.strictEqual(core.sectionArg(10, null), '*10-inf');
  assert.strictEqual(core.sectionArg(null, 30), '*0-30');
  assert.strictEqual(core.sectionArg(5, 7.5), '*5-7.5');
  assert.throws(function () { core.sectionArg(30, 10); });
});

test('looksLikeUrl', function () {
  assert.ok(core.looksLikeUrl('https://youtube.com/shorts/t3aLT1bwRsc?si=x'));
  assert.ok(core.looksLikeUrl('youtu.be/abc'));
  assert.ok(!core.looksLikeUrl('lofi hip hop'));
  assert.strictEqual(core.normalizeUrl('youtu.be/abc'), 'https://youtu.be/abc');
});

test('formatSelector prefers H.264 up to 1080p, resolution above', function () {
  assert.match(core.formatSelector('1080'), /^bv\*\[height<=1080\]\[vcodec\^=avc1\]\+ba\[ext=m4a\]/);
  assert.match(core.formatSelector('1080'), /\/b$/);
  assert.ok(core.formatSelector('2160').indexOf('avc1') < 0);
});

test('buildDownloadArgs', function () {
  var args = core.buildDownloadArgs({ url: 'https://x.test/v', outDir: '/tmp/o', maxHeight: '720', inSecs: 10, outSecs: 20, cookiesFromBrowser: 'chrome' },
    { ffmpeg: '/bin/ffmpeg', deno: '/bin/deno' });
  assert.strictEqual(args[args.length - 1], 'https://x.test/v');
  assert.deepStrictEqual(args.slice(args.indexOf('--download-sections'), args.indexOf('--download-sections') + 3), ['--download-sections', '*10-20', '--force-keyframes-at-cuts']);
  assert.ok(args.indexOf('--ffmpeg-location') > 0);
  assert.strictEqual(args[args.indexOf('--js-runtimes') + 1], 'deno:/bin/deno');
  assert.strictEqual(args[args.indexOf('--cookies-from-browser') + 1], 'chrome');
});

test('parseProgressLine', function () {
  var p = core.parseProgressLine('GRABBIT_PROGRESS 512 1024 NA 2048.5 3');
  assert.strictEqual(p.percent, 50);
  assert.strictEqual(p.speed, 2048.5);
  assert.strictEqual(p.eta, 3);
  var est = core.parseProgressLine('GRABBIT_PROGRESS 100 NA 400 NA NA');
  assert.strictEqual(est.percent, 25);
  assert.strictEqual(est.eta, null);
  assert.strictEqual(core.parseProgressLine('[download] Destination: x'), null);
});

test('needsEncode', function () {
  var h264 = { vcodec: 'h264', acodec: 'aac', pixFmt: 'yuv420p' };
  assert.strictEqual(core.needsEncode(h264, 'auto'), false);
  assert.strictEqual(core.needsEncode(h264, 'prores'), true);
  assert.strictEqual(core.needsEncode({ vcodec: 'vp9', acodec: 'opus', pixFmt: 'yuv420p' }, 'auto'), true);
  assert.strictEqual(core.needsEncode({ vcodec: 'h264', acodec: 'opus', pixFmt: 'yuv420p' }, 'auto'), true);
  assert.strictEqual(core.needsEncode({ vcodec: 'h264', acodec: 'aac', pixFmt: 'yuv420p10le' }, 'auto'), true);
  assert.strictEqual(core.needsEncode({ vcodec: 'av1', acodec: 'opus' }, 'never'), false);
});

test('mapSearchEntry', function () {
  var r = core.mapSearchEntry({ id: 'abc123', title: 'T', channel: 'C', duration: 61, url: 'https://www.youtube.com/watch?v=abc123', view_count: 5 });
  assert.strictEqual(r.thumbnail, 'https://i.ytimg.com/vi/abc123/mqdefault.jpg');
  assert.strictEqual(r.url, 'https://www.youtube.com/watch?v=abc123');
  assert.strictEqual(core.formatDuration(r.duration), '1:01');
  assert.strictEqual(core.formatDuration(3725), '1:02:05');
});

var tools = core.resolveTools(null);
var haveTools = !!(tools.ytdlp && tools.ffmpeg && tools.ffprobe);

test('end-to-end: download section, probe, encode VP9 -> H.264', { skip: !haveTools && 'yt-dlp/ffmpeg/ffprobe not installed', timeout: 120000 }, async function () {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grabbit-'));
  var src = path.join(dir, 'src.webm');
  childProcess.execFileSync(tools.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=12',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=12', '-c:v', 'libvpx-vp9', '-b:v', '300k', '-deadline', 'realtime', '-c:a', 'libopus', src]);

  var server = http.createServer(function (req, res) {
    var data = fs.readFileSync(src);
    var range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    if (range) {
      var start = +range[1], end = range[2] ? +range[2] : data.length - 1;
      res.writeHead(206, { 'Content-Type': 'video/webm', 'Content-Length': end - start + 1, 'Content-Range': 'bytes ' + start + '-' + end + '/' + data.length, 'Accept-Ranges': 'bytes' });
      return res.end(data.subarray(start, end + 1));
    }
    res.writeHead(200, { 'Content-Type': 'video/webm', 'Content-Length': data.length, 'Accept-Ranges': 'bytes' });
    res.end(data);
  });
  await new Promise(function (r) { server.listen(0, '127.0.0.1', r); });
  var url = 'http://127.0.0.1:' + server.address().port + '/My "Test" Clip.webm';

  try {
    var out = path.join(dir, 'out');
    var progress = [];
    var file = await core.download(tools, { url: url, outDir: out, maxHeight: '1080', inSecs: 2, outSecs: 6 },
      { onProgress: function (p) { progress.push(p); } }).promise;
    assert.ok(fs.existsSync(file), 'downloaded file exists: ' + file);
    assert.strictEqual(path.dirname(file), out);

    var info = await core.probe(tools, file);
    assert.strictEqual(info.vcodec, 'vp9');
    assert.ok(info.duration > 3 && info.duration < 5.5, 'section trimmed to ~4s, got ' + info.duration);
    assert.ok(core.needsEncode(info, 'auto'));

    var pct = [];
    var encoded = await core.encode(tools, file, 'h264', info, { onProgress: function (p) { pct.push(p.percent); } }, false).promise;
    var info2 = await core.probe(tools, encoded);
    assert.strictEqual(info2.vcodec, 'h264');
    assert.strictEqual(info2.acodec, 'aac');
    assert.strictEqual(info2.pixFmt, 'yuv420p');
    assert.ok(!fs.existsSync(file), 'original removed when keepOriginal=false');
    assert.ok(pct.length > 0 && pct[pct.length - 1] > 90, 'encode progress reported');
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cancel stops a running job', { skip: !tools.ffmpeg && 'ffmpeg not installed' }, async function () {
  var job = core.run(tools.ffmpeg, ['-v', 'error', '-re', '-f', 'lavfi', '-i', 'testsrc2=duration=60', '-f', 'null', '-']);
  setTimeout(job.cancel, 300);
  await assert.rejects(job.promise, function (e) { return e.cancelled === true; });
});
