/*
 * node --test test/
 * Caption engine unit tests, plus ffmpeg-backed tests of audio extraction, the transcription
 * pipeline (with a stand-in whisper-cli that writes whisper.cpp's JSON format) and overlay rendering.
 */
'use strict';

var test = require('node:test');
var assert = require('node:assert');
var path = require('path');
var fs = require('fs');
var os = require('os');
var childProcess = require('child_process');
var C = require('../js/captions.js');
var LK = require('../js/looks.js');
var M = require('../js/mogrt.js');
var SM = require('../js/smart.js');
var T = require('../js/transcribe.js');
var R = require('../js/render.js');
var U = require('../js/util.js');

var ROOT = path.join(__dirname, '..');

function W(list, gap) {
  return list.map(function (t, i) { return { text: t, start: i * (gap || 0.4), end: i * (gap || 0.4) + 0.3 }; });
}

test('normalizeWords joins pieces and punctuation, drops non-speech', function () {
  var out = C.normalizeWords([
    { text: ' Hello', start: 0, end: 0.3 }, { text: ',', start: 0.3, end: 0.3 }, { text: ' I', start: 0.4, end: 0.5 },
    { text: ' don', start: 0.5, end: 0.6 }, { text: "'t", start: 0.6, end: 0.7 }, { text: ' [BLANK_AUDIO]', start: 1, end: 2 },
    { text: ' (music)', start: 2, end: 2.1 }, { text: ' know.', start: 2.2, end: 2.5 }
  ]);
  assert.deepStrictEqual(out.map(function (w) { return w.text; }), ['Hello,', 'I', "don't", 'know.']);
  assert.strictEqual(out[2].end, 0.7);
});

test('removeFillers', function () {
  var out = C.removeFillers(W(['So', 'um,', 'this', 'uh', 'works', 'Umbrella']));
  assert.deepStrictEqual(out.map(function (w) { return w.text; }), ['So', 'this', 'works', 'Umbrella']);
});

test('groupCaptions: word limit, sentence end, pause, char limit, manual break/join', function () {
  var words = W(['one', 'two', 'three', 'four.', 'five', 'six']);
  var caps = C.groupCaptions(words, { maxWords: 3, maxChars: 30, lines: 1 });
  assert.deepStrictEqual(caps.map(function (c) { return [c.from, c.to]; }), [[0, 2], [3, 3], [4, 5]]);
  // pause
  var p = W(['a', 'b', 'c']); p[2].start = 5; p[2].end = 5.3;
  assert.strictEqual(C.groupCaptions(p, { maxWords: 5 }).length, 2);
  // chars
  var long = W(['extraordinary', 'circumstances', 'happen']);
  assert.strictEqual(C.groupCaptions(long, { maxWords: 5, maxChars: 16, lines: 1 }).length, 3);
  // brk forces a break; join (from "merge") keeps words together even past the word limit
  var b = W(['a', 'b', 'c', 'd']); b[0].brk = true; b[2].join = true;
  assert.deepStrictEqual(C.groupCaptions(b, { maxWords: 2 }).map(function (c) { return [c.from, c.to]; }), [[0, 0], [1, 3]]);
  // timing: never overlaps the next caption
  caps.forEach(function (c, k) { if (caps[k + 1]) assert.ok(c.end <= caps[k + 1].start + 1e-9); assert.ok(c.end > c.start); });
});

test('applyCaptionEdit keeps timing, redistributes, marks emphasis and breaks', function () {
  var words = W(['helo', 'world', 'again']);
  var cap = { from: 0, to: 1 };
  var same = C.applyCaptionEdit(words, cap, 'hello *world*');
  assert.strictEqual(same[0].text, 'hello');
  assert.strictEqual(same[0].start, 0);
  assert.strictEqual(same[1].emph, true);
  assert.strictEqual(same[1].end, words[1].end);
  var more = C.applyCaptionEdit(words, cap, 'hello big | world');
  assert.strictEqual(more.length, 4);
  assert.strictEqual(more[1].brk, true);
  assert.strictEqual(more[0].start, 0);
  assert.ok(Math.abs(more[2].end - words[1].end) < 1e-9);
  assert.ok(more[1].start >= more[0].end - 1e-9);
  var del = C.applyCaptionEdit(words, cap, '');
  assert.deepStrictEqual(del.map(function (w) { return w.text; }), ['again']);
  assert.strictEqual(C.captionEditText(same, cap), 'hello *world*');
});

test('times and colours', function () {
  assert.strictEqual(C.assTime(3725.456), '1:02:05.46');
  assert.strictEqual(C.srtTime(3725.456), '01:02:05,456');
  assert.strictEqual(C.assColor('#FF8000'), '&H0080FF&');
});

test('animTags picks up mid-animation with no jump', function () {
  var base = { x: 540, y: 1380, fit: 1, scaleK: 1, glow: 0, spacing: 0 };
  var start = C.animTags('fade', 200, 0, 1000, base);
  assert.match(start, /\\alpha&HFF&\\t\(0,200,0\.6,\\alpha&H00&\)/);
  var mid = C.animTags('fade', 200, 100, 1000, base);
  assert.match(mid, /\\alpha&H80&\\t\(0,100,/);
  var done = C.animTags('fade', 200, 400, 1000, base);
  assert.ok(!/\\t/.test(done), 'no transform once finished: ' + done);
  var slide = C.animTags('slideUp', 200, 0, 500, base);
  assert.match(slide, /^\\move\(540,1440,540,1380,0,200\)/);
});

test('buildAss: every preset produces valid, time-ordered events', function () {
  var words = C.normalizeWords(W([' This', ' is', ' how', ' you', ' make', ' captions', ' go', ' viral.']));
  var frame = { w: 1080, h: 1920 };
  C.PRESETS.forEach(function (p) {
    var caps = C.groupCaptions(words, p.style);
    var ass = C.buildAss(words, caps, p.style, frame, 0);
    assert.match(ass, /PlayResX: 1080/);
    assert.ok(ass.indexOf('Style: Cap,' + LK.fontFace(p.style.font).name + ',') >= 0, p.id + ' style line');
    var ev = ass.split('\n').filter(function (l) { return /^Dialogue:/.test(l); });
    assert.ok(ev.length >= caps.length, p.id + ' has events');
    ev.forEach(function (l) {
      var m = /^Dialogue: \d,([^,]+),([^,]+),/.exec(l);
      assert.ok(m[1] < m[2] || m[1].length < m[2].length, p.id + ' start < end: ' + l);
      assert.strictEqual((l.match(/\{/g) || []).length, (l.match(/\}/g) || []).length, 'balanced braces');
    });
  });
});

test('buildAss: offset, uppercase, highlight states', function () {
  var words = W(['hey', 'you', 'there']);
  var s = C.withDefaults({ highlight: 'reveal', anim: 'none', maxWords: 3, uppercase: true });
  var ass = C.buildAss(words, C.groupCaptions(words, s), s, { w: 1920, h: 1080 }, 0);
  var ev = ass.split('\n').filter(function (l) { return /^Dialogue:/.test(l); });
  assert.strictEqual(ev.length, 3, 'one event per spoken word');
  assert.match(ev[0], /HEY.*\\1a&HFF&.*YOU/, 'future words hidden while the first is spoken');
  assert.match(ev[0], /^Dialogue: 1,0:00:00\.00,0:00:00\.40,/);
  // Offset = where the overlay clip starts on the timeline.
  var shifted = W(['hey', 'you', 'there']).map(function (w) { return Object.assign(w, { start: w.start + 10, end: w.end + 10 }); });
  var off = C.buildAss(shifted, C.groupCaptions(shifted, s), s, { w: 1920, h: 1080 }, 10);
  assert.match(off.split('\n').filter(function (l) { return /^Dialogue:/.test(l); })[0], /^Dialogue: 1,0:00:00\.00,0:00:00\.40,/);
  assert.match(ev[0], /\\pos\(960,778\)/, 'centred at posY 72%');
  // Braces typed by the user can't inject override tags.
  var evil = [{ text: '{\\fs200}x', start: 0, end: 1 }];
  assert.ok(!/\{\\fs200\}/.test(C.buildAss(evil, C.groupCaptions(evil, s), s, { w: 1920, h: 1080 }, 0)));
});

test('buildSrt', function () {
  var words = W(['hello', 'there', 'friend.']);
  var st = { maxWords: 2, uppercase: false };
  assert.strictEqual(C.buildSrt(words, C.groupCaptions(words, st), st),
    '1\n00:00:00,000 --> 00:00:00,800\nhello there\n\n2\n00:00:00,800 --> 00:00:01,350\nfriend.\n');
  var two = C.withDefaults({ maxWords: 6, maxChars: 11, lines: 2, uppercase: true });
  assert.match(C.buildSrt(words, C.groupCaptions(words, two), two), /HELLO THERE\nFRIEND\./);
});

test('whisper.cpp JSON + progress parsing', function () {
  var json = { transcription: [{ offsets: { from: 0, to: 320 }, text: ' Hello' }, { offsets: { from: 320, to: 400 }, text: ',' }, { offsets: { from: 500, to: 900 }, text: ' world' }] };
  assert.deepStrictEqual(T.parseWhisperJson(json), [{ text: ' Hello', start: 0, end: 0.32 }, { text: ',', start: 0.32, end: 0.4 }, { text: ' world', start: 0.5, end: 0.9 }]);
  assert.strictEqual(T.parseWhisperProgress('whisper_print_progress_callback: progress =  45%'), 45);
  assert.strictEqual(T.parseWhisperProgress('nothing'), null);
  var args = T.whisperArgs('/m.bin', '/a.wav', '/a', { language: 'es', translate: true, prompt: 'Popline' });
  assert.ok(args.indexOf('-ml') > 0 && args.indexOf('-sow') > 0 && args.indexOf('-tr') > 0);
  assert.strictEqual(args[args.indexOf('-l') + 1], 'es');
  assert.deepStrictEqual(T.parseOpenAIWords({ words: [{ word: 'Hi', start: 0, end: 0.2 }] }), [{ text: ' Hi', start: 0, end: 0.2 }]);
});

test('multipart body', function () {
  var tmp = path.join(os.tmpdir(), 'popline-mp.mp3');
  fs.writeFileSync(tmp, 'ID3');
  var mp = T.multipart({ model: 'whisper-1', 'timestamp_granularities[]': 'word' }, tmp);
  var body = mp.body.toString();
  assert.match(mp.type, /^multipart\/form-data; boundary=/);
  assert.match(body, /name="model"\r\n\r\nwhisper-1\r\n/);
  assert.match(body, /filename="popline-mp.mp3"\r\nContent-Type: audio\/mpeg\r\n\r\nID3\r\n--/);
});

var tools = U.resolveTools(null);

/** A stand-in for whisper-cli: writes whisper.cpp's -oj JSON for a fixed sentence, prints progress. */
function fakeWhisper(dir) {
  var js = path.join(dir, 'fake-whisper.js');
  fs.writeFileSync(js, [
    "var a = process.argv.slice(2), fs = require('fs');",
    "var of = a[a.indexOf('-of') + 1], f = a[a.indexOf('-f') + 1];",
    "if (!fs.existsSync(f)) { console.error('error: input not found'); process.exit(1); }",
    "var words = [' So', ' here', \"'s\", ' the', ' thing', ',', ' um', ' captions', ' matter.'];",
    "var t = 200, out = words.map(function (w) { var s = { offsets: { from: t, to: t + 300 }, text: w }; t += w[0] === ' ' ? 350 : 0; return s; });",
    "[25, 50, 100].forEach(function (p) { console.error('whisper_print_progress_callback: progress = ' + p + '%'); });",
    "fs.writeFileSync(of + '.json', JSON.stringify({ transcription: out, args: a }));"
  ].join('\n'));
  var bin = path.join(dir, 'whisper-cli');
  fs.writeFileSync(bin, '#!/bin/sh\nexec node "' + js + '" "$@"\n');
  fs.chmodSync(bin, 0o755);
  return bin;
}

test('transcribeSources: extract audio, run whisper, map to sequence time', { skip: !tools.ffmpeg || U.IS_WIN }, async function () {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'popline-tx-'));
  var media = path.join(dir, 'talk.mp4');
  childProcess.execFileSync(tools.ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:d=8', '-f', 'lavfi', '-i', 'sine=d=8', '-shortest', '-c:v', 'libx264', '-c:a', 'aac', media]);
  var model = path.join(dir, 'ggml-base.bin');
  fs.writeFileSync(model, 'x');
  var t = { ffmpeg: tools.ffmpeg, whisper: fakeWhisper(dir) };
  var progress = [];
  // Clip uses source 2s..6s, placed at 10s on the timeline; second clip at 30s at 2x speed.
  var sources = [{ mediaPath: media, inSec: 2, startSec: 10, endSec: 14, speed: 1 }, { mediaPath: media, inSec: 0, startSec: 30, endSec: 32, speed: 2 }];
  try {
    var raw = await T.transcribeSources(t, sources, { engine: 'local', modelPath: model, language: 'en', workDir: path.join(dir, 'w') }, { onProgress: function (p) { progress.push(p); } }).promise;
    var wav = path.join(dir, 'w', 'audio-1.wav');
    var info = JSON.parse(childProcess.execFileSync(tools.ffmpeg.replace(/ffmpeg$/, 'ffprobe'), ['-v', 'error', '-show_entries', 'stream=sample_rate,channels:format=duration', '-of', 'json', wav]));
    assert.strictEqual(info.streams[0].sample_rate, '16000');
    assert.strictEqual(info.streams[0].channels, 1);
    assert.ok(Math.abs(parseFloat(info.format.duration) - 4) < 0.05, 'clip range cut: ' + info.format.duration);
    assert.ok(Math.abs(parseFloat(JSON.parse(childProcess.execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', path.join(dir, 'w', 'audio-2.wav')])).format.duration) - 4) < 0.05, '2x clip uses 4s of source');
    var words = C.removeFillers(C.normalizeWords(raw));
    assert.deepStrictEqual(words.slice(0, 6).map(function (w) { return w.text; }), ["So", "here's", 'the', 'thing,', 'captions', 'matter.']);
    assert.ok(Math.abs(words[0].start - 10.2) < 1e-9, 'offset by clip start');
    var second = words.filter(function (w) { return w.start >= 30; });
    assert.ok(Math.abs(second[0].start - 30.1) < 1e-9, 'speed-adjusted: ' + second[0].start);
    assert.deepStrictEqual(progress.slice(-1), [100]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('render: overlay is transparent ProRes 4444 at sequence size/rate; previews render', { skip: !tools.ffmpeg, timeout: 120000 }, async function () {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'popline-r-'));
  try {
    R.ensureFonts(ROOT, dir);
    assert.ok(fs.existsSync(path.join(dir, 'fonts', 'Montserrat-Black.ttf')));
    var words = C.normalizeWords(W([' captions', ' that', ' pop', ' off', ' the', ' screen']));
    var frame = { w: 720, h: 1280, fps: 29.97 };
    var s = C.presetById('bold-pop').style;
    fs.writeFileSync(path.join(dir, 'c.ass'), C.buildAss(words, C.groupCaptions(words, s), s, frame, 0));
    var out = await R.renderOverlay(tools, dir, 'c.ass', frame, 3, path.join(dir, 'o.mov')).promise;
    var p = JSON.parse(childProcess.execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,profile,pix_fmt,width,height,r_frame_rate', '-of', 'json', out])).streams[0];
    assert.strictEqual(p.codec_name, 'prores');
    assert.match(p.pix_fmt, /^yuva444p/);
    assert.strictEqual(p.width, 720);
    assert.strictEqual(p.r_frame_rate, '30000/1001');
    // Text pixels exist mid-caption, and the corners are fully transparent.
    var px = childProcess.execFileSync('ffmpeg', ['-v', 'error', '-ss', '0.5', '-i', out, '-frames:v', '1', '-vf', 'alphaextract,format=gray', '-f', 'rawvideo', '-'], { maxBuffer: 1e8 });
    assert.strictEqual(px[0], 0, 'corner transparent');
    var maxA = 0;
    for (var i = 0; i < px.length; i++) if (px[i] > maxA) maxA = px[i];
    assert.ok(maxA > 200, 'captions drawn');
    var still = await R.renderPreviewFrame(tools, dir, 'c.ass', frame, 0.6, null, 'f.png', 360);
    assert.ok(fs.statSync(still).size > 1000);
    var clip = await R.renderPreviewClip(tools, dir, 'c.ass', frame, 0, 1, null, 'p.webm', 240);
    assert.ok(fs.statSync(clip).size > 1000);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('every bundled font file exists and has a licence', function () {
  Object.keys(C.FONTS).forEach(function (name) {
    assert.ok(fs.existsSync(path.join(ROOT, 'fonts', C.FONTS[name].file)), name);
  });
  assert.ok(fs.readdirSync(path.join(ROOT, 'fonts', 'licenses')).length >= 25);
});

/* ------------------------------------------------------------ v2: looks, per-word looks, templates, library, smart mix */

test('50+ looks, each referencing a real font, animation and highlight', function () {
  assert.ok(LK.LOOKS.length >= 50, 'got ' + LK.LOOKS.length);
  var ids = {};
  LK.LOOKS.forEach(function (l) {
    assert.ok(!ids[l.id], 'unique id ' + l.id); ids[l.id] = 1;
    assert.ok(LK.FONTS[l.style.font], l.id + ' font');
    assert.ok(LK.ANIMS[l.style.anim], l.id + ' anim');
    assert.ok(LK.HIGHLIGHTS[l.style.highlight], l.id + ' highlight');
    assert.ok(LK.CATEGORIES.indexOf(l.cat) >= 0, l.id + ' category');
  });
});

test('per-word and per-caption looks render with their own font; templates are left out of the ASS', function () {
  var words = C.normalizeWords(' You will NOT believe what happened next'.split(/(?= )/).map(function (t, i) { return { text: t, start: i * 0.3, end: i * 0.3 + 0.25 }; }));
  var st = Object.assign({}, LK.lookById('bold-pop').style, { maxWords: 4 });
  words = C.setWordLook(words, [2], 'handwritten');
  var caps = C.groupCaptions(words, st);
  words = C.setCaptionLook(words, caps[1], 'modern-text');
  caps = C.groupCaptions(words, st);
  var ass = C.buildAss(words, caps, st, { w: 1080, h: 1920 }, 0);
  assert.match(ass, /\\fnSatisfy[^}]*\}NOT/, 'word look font');
  assert.match(ass, /\\fnInter\\[^}]*\\i1[^}]*\}(\{[^}]*\})?b/i, 'caption look font (Inter Bold Italic)');
  // gradient tail: the modern look ramps the colour across letters
  assert.ok((ass.match(/\\1c&H/g) || []).length > 20);
  // template captions are not drawn
  var w2 = C.setCaptionLook(words, caps[0], null, 'tpl1');
  var c2 = C.groupCaptions(w2, st);
  var ass2 = C.buildAss(w2, c2, st, { w: 1080, h: 1920 }, 0);
  assert.ok(!/YOU/.test(ass2.split('[Events]')[1]), 'templated caption skipped');
  var items = C.templateItems(w2, c2, st, { tpl1: { path: '/x/T.mogrt', slots: 3, slotNames: ['Text 01', 'Text 02', 'Text 03'], scaleParam: 'S', comp: { w: 3840, h: 2160 } } }, { w: 1080, h: 1920 }, 100);
  assert.strictEqual(items.length, 1);
  assert.deepStrictEqual(items[0].texts, ['YOU', 'WILL', 'NOT']);
  assert.strictEqual(items[0].scale, 28.1);
});

test('edits keep word looks; new animations and highlights build', function () {
  var words = [{ text: 'big', start: 0, end: 0.3, look: 'glitch' }, { text: 'deal', start: 0.3, end: 0.6 }];
  var out = C.applyCaptionEdit(words, { from: 0, to: 1 }, 'a big deal');
  assert.strictEqual(out[1].look, 'glitch');
  ['cascade', 'wave', 'typewriter', 'wipe', 'vhs', 'shake', 'flip', 'stretch'].forEach(function (a) {
    ['karaoke', 'hollow', 'underline', 'bigger'].forEach(function (h) {
      var s = C.withDefaults({ anim: a, highlight: h, maxWords: 4 });
      var ass = C.buildAss(words, C.groupCaptions(words, s), s, { w: 1920, h: 1080 }, 0);
      assert.ok(!/NaN|undefined/.test(ass), a + '/' + h);
    });
  });
});

test('splitIntoSlots and dedupeOverlaps', function () {
  assert.deepStrictEqual(C.splitIntoSlots(['A', 'B', 'C', 'D', 'E'], 3), ['A B', 'C D', 'E']);
  assert.deepStrictEqual(C.splitIntoSlots(['HI'], 3), ['HI', '', '']);
  var w = [{ text: 'a', start: 0, end: 0.4, src: 0 }, { text: 'a', start: 0.05, end: 0.4, src: 1 }, { text: 'b', start: 0.5, end: 0.8, src: 1 }];
  assert.deepStrictEqual(C.dedupeOverlaps(w).map(function (x) { return x.src + x.text; }), ['0a', '1b']);
});

test('mogrt reader: definition, text slots, params, thumbnail (bundled packs/)', { skip: !fs.existsSync(path.join(ROOT, 'packs', 'Text Presets')) && 'no bundled packs' }, function () {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'popline-th-'));
  var r = M.scanPacks([path.join(ROOT, 'packs')], dir);
  assert.strictEqual(r.errors.length, 0, r.errors.join('; '));
  assert.ok(r.templates.length >= 5);
  var t1 = r.templates.filter(function (t) { return /01/.test(t.name); })[0];
  assert.strictEqual(t1.slots, 3);
  assert.deepStrictEqual(t1.slotNames, ['Text 01', 'Text 02', 'Text 03']);
  assert.deepStrictEqual(t1.comp, { w: 3840, h: 2160 });
  assert.ok(t1.params.some(function (p) { return p.type === 'color'; }));
  assert.ok(fs.statSync(t1.thumb).size > 1000);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('library: seed, import, customise, delete (temp home)', { skip: !fs.existsSync(path.join(ROOT, 'packs', 'Text Presets')) && 'no bundled packs' }, function () {
  var home = fs.mkdtempSync(path.join(os.tmpdir(), 'popline-home-'));
  var old = process.env.HOME;
  process.env.HOME = home;
  try {
    delete require.cache[require.resolve('../js/library.js')];
    var LIB = require('../js/library.js');
    assert.strictEqual(LIB.seed(ROOT), 5);
    assert.strictEqual(LIB.seed(ROOT), 0, 'only once');
    var list = LIB.list([]).templates;
    assert.strictEqual(list.length, 5);
    var src = path.join(ROOT, 'packs', 'Text Presets', 'Text_Preset_02.mogrt');
    var added = LIB.importFiles([src]);
    assert.ok(/Text_Preset_02 \(2\)\.mogrt$/.test(added[0]) || /Text_Preset_02\.mogrt$/.test(added[0]));
    var buf = LIB.importBuffer('Dropped.mogrt', fs.readFileSync(src));
    assert.ok(fs.existsSync(buf));
    assert.throws(function () { LIB.importBuffer('broken.mogrt', Buffer.from('nope')); });
    list = LIB.list([]).templates;
    assert.strictEqual(list.length, 7);
    var t = list[0];
    LIB.saveSettings(t.id, { label: 'My Title', cat: 'Elegant', params: { 'Start Color': '#ff0000' } });
    var again = LIB.list([]).templates.filter(function (x) { return x.id === t.id; })[0];
    assert.strictEqual(again.name, 'My Title');
    assert.strictEqual(again.cat, 'Elegant');
    LIB.remove(again);
    assert.ok(!fs.existsSync(again.path));
    assert.strictEqual(LIB.list([]).templates.length, 6);
  } finally {
    process.env.HOME = old;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('smart mix: context picks fitting categories, base lines keep the main look, no back-to-back repeats', function () {
  var lines = ['So here is the thing', 'I made $10,000 in one week', 'and it was INSANE!', 'but I was scared', 'that I would lose everything', 'what would you do?', 'I love my family', 'we went to the store'];
  var caps = lines.map(function (t, i) { return { text: t, start: i * 2, end: i * 2 + 1.5 }; });
  var pool = LK.LOOKS.map(function (l) { return { key: 'look:' + l.id, label: l.label, cat: l.cat }; });
  var plan = SM.plan(caps, pool, { variety: 100, seed: 5 });
  var cat = function (k) { return k ? LK.lookById(k.slice(5)).cat : null; };
  assert.strictEqual(plan[0].mood, 'hook');
  assert.strictEqual(plan[1].mood, 'number');
  assert.strictEqual(plan[2].mood, 'hype');
  assert.strictEqual(plan[3].mood, 'serious');
  assert.ok(['Cinematic', 'Modern'].indexOf(cat(plan[3].key)) >= 0);
  assert.strictEqual(plan[5].mood, 'question');
  assert.strictEqual(plan[6].mood, 'soft');
  assert.ok(['Elegant', 'Modern'].indexOf(cat(plan[6].key)) >= 0);
  for (var i = 1; i < plan.length; i++) if (plan[i].key) assert.notStrictEqual(plan[i].key, plan[i - 1].key);
  assert.strictEqual(SM.plan(caps, pool, { variety: 0, seed: 5 }).filter(function (p) { return p.key; }).length, 0, 'variety 0 = one look');
  var low = SM.plan(caps, pool, { variety: 5, seed: 5 });
  low.forEach(function (p) { if (p.key) assert.ok(['hook', 'number', 'serious'].indexOf(p.mood) >= 0, 'low variety only strong moods: ' + p.mood); });
  assert.deepStrictEqual(SM.plan(caps, pool, { variety: 60, seed: 9 }), SM.plan(caps, pool, { variety: 60, seed: 9 }), 'deterministic');
});
