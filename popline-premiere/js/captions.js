/*
 * Popline caption engine: words -> captions -> animated ASS subtitles / SRT.
 * Pure functions (no fs, no CEP) so everything here is unit tested in test/.
 *
 * Word:    { text, start, end, emph?, brk?, join? }   times in seconds (timeline time)
 *          emph = always accent-coloured, brk = force a new caption after it, join = never break after it
 * Caption: { start, end, from, to }                   words[from..to] inclusive
 */
'use strict';

/* ------------------------------------------------------------- fonts */

// Bundled fonts (fonts/ folder). width = average advance per character as a fraction of font size
// [UPPERCASE, lowercase], measured from the font files; used to keep long lines inside the frame.
var FONTS = {
  'Montserrat Black': { file: 'Montserrat-Black.ttf', width: [0.429, 0.363] },
  'Montserrat ExtraBold': { file: 'Montserrat-ExtraBold.ttf', width: [0.424, 0.356] },
  'Montserrat SemiBold': { file: 'Montserrat-SemiBold.ttf', width: [0.416, 0.343] },
  'Poppins Black': { file: 'Poppins-Black.ttf', width: [0.342, 0.302] },
  'Poppins ExtraBold': { file: 'Poppins-ExtraBold.ttf', width: [0.34, 0.299] },
  'Poppins SemiBold': { file: 'Poppins-SemiBold.ttf', width: [0.334, 0.294] },
  'Anton': { file: 'Anton-Regular.ttf', width: [0.246, 0.239] },
  'Bebas Neue': { file: 'BebasNeue-Regular.ttf', width: [0.267, 0.267] },
  'Archivo Black': { file: 'ArchivoBlack-Regular.ttf', width: [0.514, 0.417] },
  'Luckiest Guy': { file: 'LuckiestGuy-Regular.ttf', width: [0.421, 0.427] },
  'Bangers': { file: 'Bangers-Regular.ttf', width: [0.216, 0.216] },
  'DM Serif Display': { file: 'DMSerifDisplay-Italic.ttf', width: [0.394, 0.321], italic: true },
  'Great Vibes': { file: 'GreatVibes-Regular.ttf', width: [0.454, 0.163] }
};

/* ------------------------------------------------------------- presets */

var BASE_STYLE = {
  font: 'Montserrat Black',
  size: 100,              // px on a 1080-wide (or 1080-tall) frame; scaled to the sequence
  uppercase: true,
  spacing: 0,             // letter spacing px
  color: '#FFFFFF',
  accent: '#FFE600',      // active / emphasised word
  outlineColor: '#000000',
  outline: 6,
  shadow: 0,
  shadowColor: '#000000',
  shadowOpacity: 60,      // %
  glow: 0,                // edge blur
  highlight: 'color',     // none | color | box | pop | reveal
  boxColor: '#7C3AED',
  boxPad: 14,
  rainbow: false,
  palette: ['#FFE600', '#39FF14', '#00E5FF', '#FF4FD8', '#FF8A00'],
  anim: 'pop',            // none | pop | fade | blur | slideUp | slideDown | rightIn | zoomIn | zoomOut | spread | glitch | bounce
  animMs: 220,
  out: 'none',            // none | fade
  posY: 72,               // % from top (centre of the caption)
  maxWords: 3,
  maxChars: 16,           // per line
  lines: 1,
  maxGap: 0.6,            // seconds of silence that forces a new caption
  breakOnPunct: true
};

function preset(name, label, over) {
  var s = {};
  Object.keys(BASE_STYLE).forEach(function (k) { s[k] = BASE_STYLE[k]; });
  Object.keys(over).forEach(function (k) { s[k] = over[k]; });
  return { id: name, label: label, style: s };
}

var PRESETS = [
  preset('bold-pop', 'Bold Pop', {}),
  preset('beast', 'Beast', { font: 'Luckiest Guy', size: 120, outline: 8, shadow: 5, shadowOpacity: 90, accent: '#39FF14', highlight: 'pop', anim: 'pop', maxWords: 2, maxChars: 14 }),
  preset('box', 'Box Highlight', { font: 'Poppins ExtraBold', size: 96, outline: 0, highlight: 'box', boxColor: '#7C3AED', accent: '#FFFFFF', anim: 'slideUp', maxWords: 3, maxChars: 18 }),
  preset('karaoke', 'Karaoke Reveal', { font: 'Montserrat ExtraBold', size: 84, outline: 5, highlight: 'reveal', accent: '#00E5FF', anim: 'fade', maxWords: 7, maxChars: 20, lines: 2 }),
  preset('one-word', 'One Word Punch', { font: 'Anton', size: 170, outline: 7, highlight: 'none', anim: 'zoomOut', animMs: 160, maxWords: 1, maxChars: 14 }),
  preset('striking', 'Blur Reveal', { font: 'Bebas Neue', size: 170, color: '#FF2D2D', accent: '#FFFFFF', outline: 0, shadow: 6, shadowColor: '#000000', shadowOpacity: 70, highlight: 'none', anim: 'blur', animMs: 420, out: 'fade', maxWords: 2, maxChars: 14 }),
  preset('smooth-opacity', 'Smooth Opacity', { font: 'Bebas Neue', size: 150, color: '#7FE7FF', accent: '#FFFFFF', outline: 3, outlineColor: '#0A6C8C', glow: 6, highlight: 'none', anim: 'spread', animMs: 520, out: 'fade', maxWords: 3, maxChars: 16 }),
  preset('smooth-up', 'Smooth Up', { font: 'Great Vibes', size: 150, uppercase: false, outline: 0, shadow: 4, shadowOpacity: 70, highlight: 'none', accent: '#F5D27A', anim: 'slideUp', animMs: 420, out: 'fade', maxWords: 3, maxChars: 20 }),
  preset('elegant', 'Elegant Serif', { font: 'DM Serif Display', size: 120, uppercase: false, outline: 0, shadow: 4, shadowOpacity: 70, accent: '#F5C542', highlight: 'color', anim: 'blur', animMs: 360, maxWords: 4, maxChars: 20 }),
  preset('clean', 'Clean Minimal', { font: 'Poppins SemiBold', size: 72, uppercase: false, outline: 0, shadow: 3, shadowOpacity: 80, highlight: 'none', anim: 'fade', animMs: 160, maxWords: 8, maxChars: 26, lines: 2 }),
  preset('glitch', 'Glitch', { font: 'Archivo Black', size: 104, outline: 5, accent: '#FF3355', highlight: 'color', anim: 'glitch', animMs: 300, maxWords: 2, maxChars: 14 }),
  preset('neon', 'Neon', { font: 'Montserrat ExtraBold', size: 100, outline: 5, outlineColor: '#FF00E6', glow: 8, accent: '#FF9CF5', highlight: 'color', anim: 'fade', maxWords: 3, maxChars: 16 }),
  preset('comic', 'Comic', { font: 'Bangers', size: 140, spacing: 2, outline: 7, shadow: 4, shadowOpacity: 100, rainbow: true, highlight: 'pop', anim: 'bounce', maxWords: 3, maxChars: 16 })
];

function presetById(id) {
  for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].id === id) return PRESETS[i];
  return null;
}

function withDefaults(style) {
  var s = {};
  Object.keys(BASE_STYLE).forEach(function (k) { s[k] = style && style[k] !== undefined ? style[k] : BASE_STYLE[k]; });
  return s;
}

/* ------------------------------------------------------------- words */

var FILLERS = /^(um+|uh+|erm+|er|ah+|hmm+|mm+|uhm+|eh+)$/i;

/**
 * Clean raw transcriber tokens: join punctuation / word pieces onto the previous word,
 * drop [BLANK_AUDIO], (music) and similar non-speech markers.
 * raw: [{ text, start, end }] where text keeps the transcriber's leading space for word starts.
 */
function normalizeWords(raw) {
  var out = [];
  (raw || []).forEach(function (t) {
    var txt = String(t.text == null ? '' : t.text);
    var trimmed = txt.trim();
    if (!trimmed) return;
    if (/^[\[(].*[\])]$/.test(trimmed) || /^\*.*\*$/.test(trimmed) || /^♪+$/.test(trimmed)) return;
    // Transcribers mark word starts with a leading space; a token without one continues the previous
    // word ("don" + "'t", "U" + ".S."), as long as it follows straight on.
    var prevW = out[out.length - 1];
    var continues = prevW && !/^\s/.test(txt) && +t.start - prevW.end < 0.5;
    var isPunct = /^[.,!?;:%…"'”’)\]-]+$/.test(trimmed);
    if (prevW && (continues || isPunct)) {
      var prev = out[out.length - 1];
      prev.text += trimmed;
      prev.end = Math.max(prev.end, +t.end);
      return;
    }
    out.push({ text: trimmed, start: +t.start, end: Math.max(+t.end, +t.start) });
  });
  // Keep times monotonic.
  for (var i = 1; i < out.length; i++) {
    if (out[i].start < out[i - 1].start) out[i].start = out[i - 1].start;
    if (out[i].end < out[i].start) out[i].end = out[i].start;
  }
  return out;
}

function removeFillers(words) {
  return words.filter(function (w) { return !FILLERS.test(w.text.replace(/[^\w]/g, '')); });
}

function endsSentence(text) {
  return /[.!?…]["”’)]*$/.test(text);
}

/** Group words into captions. */
function groupCaptions(words, style) {
  style = withDefaults(style);
  var maxWords = Math.max(1, style.maxWords | 0);
  var maxChars = Math.max(4, style.maxChars | 0) * Math.max(1, style.lines | 0);
  var caps = [];
  var cur = null;
  function close() { if (cur) caps.push(cur); cur = null; }
  for (var i = 0; i < words.length; i++) {
    var w = words[i];
    if (cur) {
      var prev = words[i - 1];
      var chars = 0;
      for (var j = cur.from; j <= cur.to; j++) chars += words[j].text.length + 1;
      var forced = prev.brk;
      var glued = prev.join;
      if (!glued && (forced || cur.to - cur.from + 1 >= maxWords || chars + w.text.length > maxChars ||
          w.start - prev.end > style.maxGap || (style.breakOnPunct && endsSentence(prev.text)))) {
        close();
      }
    }
    if (!cur) cur = { from: i, to: i };
    else cur.to = i;
  }
  close();
  // Timing: start at the first word, hold until the next caption (max 0.6s after the last word).
  caps.forEach(function (c, k) {
    c.start = words[c.from].start;
    var lastEnd = words[c.to].end;
    var next = caps[k + 1] ? words[caps[k + 1].from].start : Infinity;
    c.end = Math.min(Math.max(lastEnd + 0.25, c.start + 0.3), next, lastEnd + 0.6);
    if (c.end <= c.start) c.end = c.start + 0.1;
  });
  return caps;
}

/** Text a caption is edited as: words joined, *emphasised* words starred. */
function captionEditText(words, cap) {
  var out = [];
  for (var i = cap.from; i <= cap.to; i++) out.push(words[i].emph ? '*' + words[i].text + '*' : words[i].text);
  return out.join(' ');
}

/**
 * Apply an edited caption text. Same word count keeps every word's timing; otherwise the caption's
 * time span is shared out by word length. "*word*" marks emphasis, a lone "|" forces a caption break.
 * Returns a new words array.
 */
function applyCaptionEdit(words, cap, text) {
  var tokens = String(text || '').trim().split(/\s+/).filter(Boolean);
  var fresh = [];
  tokens.forEach(function (tok) {
    if (tok === '|') { if (fresh.length) fresh[fresh.length - 1].brk = true; return; }
    var emph = /^\*.+\*$/.test(tok);
    fresh.push({ text: emph ? tok.slice(1, -1) : tok, emph: emph || undefined });
  });
  var old = words.slice(cap.from, cap.to + 1);
  var t0 = old[0].start, t1 = old[old.length - 1].end;
  if (fresh.length === old.length) {
    fresh.forEach(function (w, i) { w.start = old[i].start; w.end = old[i].end; if (old[i].join && !w.brk) w.join = true; });
  } else if (fresh.length) {
    var weights = fresh.map(function (w) { return w.text.length + 2; });
    var total = weights.reduce(function (a, b) { return a + b; }, 0);
    var t = t0;
    fresh.forEach(function (w, i) {
      w.start = t;
      t += (t1 - t0) * weights[i] / total;
      w.end = i === fresh.length - 1 ? t1 : t;
    });
  }
  fresh.forEach(function (w) { Object.keys(w).forEach(function (k) { if (w[k] === undefined) delete w[k]; }); });
  return words.slice(0, cap.from).concat(fresh, words.slice(cap.to + 1));
}

/** Merge a caption into the previous one (sets join on the boundary, clears breaks inside). */
function mergeWithPrevious(words, caps, k) {
  if (k <= 0) return words;
  var out = words.map(function (w) { return Object.assign({}, w); });
  var prevLast = caps[k - 1].to;
  out[prevLast].join = true;
  delete out[prevLast].brk;
  return out;
}

/** Shift every word by `secs` (sync fix). */
function shiftWords(words, secs) {
  return words.map(function (w) { return Object.assign({}, w, { start: Math.max(0, w.start + secs), end: Math.max(0, w.end + secs) }); });
}

/* ------------------------------------------------------------- ASS output */

function pad2(n) { return (n < 10 ? '0' : '') + n; }

/** seconds -> h:mm:ss.cc */
function assTime(secs) {
  var cs = Math.max(0, Math.round(secs * 100));
  var h = Math.floor(cs / 360000); cs -= h * 360000;
  var m = Math.floor(cs / 6000); cs -= m * 6000;
  var s = Math.floor(cs / 100); cs -= s * 100;
  return h + ':' + pad2(m) + ':' + pad2(s) + '.' + pad2(cs);
}

/** seconds -> hh:mm:ss,mmm */
function srtTime(secs) {
  var ms = Math.max(0, Math.round(secs * 1000));
  var h = Math.floor(ms / 3600000); ms -= h * 3600000;
  var m = Math.floor(ms / 60000); ms -= m * 60000;
  var s = Math.floor(ms / 1000); ms -= s * 1000;
  return pad2(h) + ':' + pad2(m) + ':' + pad2(s) + ',' + (ms < 10 ? '00' : ms < 100 ? '0' : '') + ms;
}

/** '#RRGGBB' (+ opacity 0..100) -> ASS &HAABBGGRR& pieces */
function assColor(hex) {
  var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  var h = m ? m[1] : 'FFFFFF';
  return '&H' + h.slice(4, 6) + h.slice(2, 4) + h.slice(0, 2) + '&';
}
function assAlpha(opacityPct) {
  var a = Math.round(255 * (1 - Math.max(0, Math.min(100, opacityPct)) / 100));
  var hx = a.toString(16).toUpperCase();
  return '&H' + (hx.length < 2 ? '0' : '') + hx + '&';
}

/** Style-line colour: &HAABBGGRR (no trailing &). */
function styleColor(hex, opacityPct) {
  return assAlpha(opacityPct == null ? 100 : opacityPct).replace(/&$/, '') + assColor(hex).replace(/^&H/, '').replace(/&$/, '');
}

function escapeAss(text) {
  return String(text).replace(/\\/g, '/').replace(/\{/g, '(').replace(/\}/g, ')').replace(/\r?\n/g, ' ');
}

function displayText(w, style) {
  return style.uppercase ? w.text.toUpperCase() : w.text;
}

/** Greedy line wrap of a caption's words: returns array of arrays of word indices. */
function wrapLines(words, cap, style) {
  var lines = [[]], len = 0;
  var maxLines = Math.max(1, style.lines | 0);
  for (var i = cap.from; i <= cap.to; i++) {
    var l = words[i].text.length;
    if (lines[lines.length - 1].length && len + 1 + l > style.maxChars && lines.length < maxLines) {
      lines.push([]);
      len = 0;
    }
    lines[lines.length - 1].push(i);
    len += (len ? 1 : 0) + l;
  }
  return lines;
}

/**
 * Animation keyframes. Each prop: value at progress 0..1 of the in-animation.
 * alpha: 0 = opaque .. 255 = invisible, scale: %, blur, spacing (extra px), dx/dy: px offset.
 */
var ANIMS = {
  none: [],
  fade: [{ p: 0, alpha: 255 }, { p: 1, alpha: 0 }],
  pop: [{ p: 0, alpha: 255, scale: 70 }, { p: 0.6, alpha: 0, scale: 110 }, { p: 1, alpha: 0, scale: 100 }],
  bounce: [{ p: 0, alpha: 255, scale: 40 }, { p: 0.45, alpha: 0, scale: 118 }, { p: 0.75, alpha: 0, scale: 94 }, { p: 1, alpha: 0, scale: 100 }],
  blur: [{ p: 0, alpha: 255, blur: 22, scale: 108 }, { p: 1, alpha: 0, blur: 0, scale: 100 }],
  slideUp: [{ p: 0, alpha: 255, dy: 60 }, { p: 1, alpha: 0, dy: 0 }],
  slideDown: [{ p: 0, alpha: 255, dy: -60 }, { p: 1, alpha: 0, dy: 0 }],
  rightIn: [{ p: 0, alpha: 255, dx: 120 }, { p: 1, alpha: 0, dx: 0 }],
  zoomIn: [{ p: 0, alpha: 255, scale: 50 }, { p: 1, alpha: 0, scale: 100 }],
  zoomOut: [{ p: 0, alpha: 120, scale: 160 }, { p: 1, alpha: 0, scale: 100 }],
  spread: [{ p: 0, alpha: 255, spacing: 26, blur: 6 }, { p: 1, alpha: 0, spacing: 0, blur: 0 }],
  glitch: [{ p: 0, alpha: 255 }, { p: 0.25, alpha: 0 }, { p: 1, alpha: 0 }]
};
var ANIM_NAMES = Object.keys(ANIMS);

function lerp(a, b, k) { return a + (b - a) * k; }

/** Animated property value at progress p (0..1). */
function valueAt(kfs, prop, p, rest) {
  var have = kfs.filter(function (k) { return k[prop] !== undefined; });
  if (!have.length) return rest;
  if (p <= have[0].p) return have[0][prop];
  for (var i = 1; i < have.length; i++) {
    if (p <= have[i].p) {
      var k = (p - have[i - 1].p) / (have[i].p - have[i - 1].p);
      return lerp(have[i - 1][prop], have[i][prop], k);
    }
  }
  return have[have.length - 1][prop];
}

function hexByte(n) {
  var h = Math.round(Math.max(0, Math.min(255, n))).toString(16).toUpperCase();
  return h.length < 2 ? '0' + h : h;
}

/** ASS override tags for a set of animated property values. */
function propTags(v, base) {
  var t = '';
  if (v.alpha !== undefined) t += '\\alpha&H' + hexByte(v.alpha) + '&';
  if (v.scale !== undefined) { var s = Math.round(v.scale * base.fit * 10) / 10; t += '\\fscx' + s + '\\fscy' + s; }
  if (v.blur !== undefined) t += '\\blur' + Math.round((v.blur + base.glow) * 10) / 10;
  if (v.spacing !== undefined) t += '\\fsp' + Math.round((v.spacing + base.spacing) * 10) / 10;
  return t;
}

/**
 * Tags for one sub-event that starts `offMs` into the caption's in-animation and lasts `lenMs`.
 * Starting mid-animation picks up exactly where the previous sub-event left off.
 */
function animTags(name, durMs, offMs, lenMs, base, only) {
  var kfs = ANIMS[name] || [];
  var props = only || ['alpha', 'scale', 'blur', 'spacing'];
  var p0 = durMs > 0 ? Math.min(1, offMs / durMs) : 1;
  var rest = { alpha: 0, scale: 100, blur: 0, spacing: 0 };
  var start = {};
  props.forEach(function (pr) {
    if (kfs.some(function (k) { return k[pr] !== undefined; })) start[pr] = valueAt(kfs, pr, p0, rest[pr]);
  });
  var tags = propTags(start, base);
  // \t for every keyframe segment still ahead.
  for (var i = 1; i < kfs.length; i++) {
    var segStart = kfs[i - 1].p * durMs, segEnd = kfs[i].p * durMs;
    if (segEnd <= offMs) continue;
    var a = Math.max(0, Math.round(segStart - offMs)), b = Math.round(segEnd - offMs);
    if (a >= lenMs) break;
    var target = {};
    props.forEach(function (pr) { if (kfs[i][pr] !== undefined) target[pr] = kfs[i][pr]; });
    var tt = propTags(target, base);
    if (tt) tags += '\\t(' + a + ',' + b + ',' + (i === kfs.length - 1 ? '0.6,' : '') + tt + ')';
  }
  if (only) return tags;
  // Position (only first->last keyframe, \move supports a single segment).
  var x = base.x, y = base.y;
  var hasMove = kfs.some(function (k) { return k.dx !== undefined || k.dy !== undefined; });
  if (hasMove && p0 < 1) {
    var dx0 = valueAt(kfs, 'dx', p0, 0), dy0 = valueAt(kfs, 'dy', p0, 0);
    var dx1 = valueAt(kfs, 'dx', 1, 0), dy1 = valueAt(kfs, 'dy', 1, 0);
    tags = '\\move(' + Math.round(x + dx0 * base.scaleK) + ',' + Math.round(y + dy0 * base.scaleK) + ',' + Math.round(x + dx1 * base.scaleK) + ',' +
      Math.round(y + dy1 * base.scaleK) + ',0,' + Math.max(1, Math.round(durMs - offMs)) + ')' + tags;
  } else {
    tags = '\\pos(' + Math.round(x) + ',' + Math.round(y) + ')' + tags;
  }
  return tags;
}

/** Tags for one word. state: 'normal' | 'active' | 'hidden' | 'done' (reveal mode, already spoken) */
function wordTags(w, idx, state, style, base) {
  var color = style.color;
  if (style.rainbow) color = style.palette[idx % style.palette.length];
  if (w.emph) color = style.accent;
  var bord = base.outline, bordColor = style.outlineColor, shad = base.shadow;
  var t = '';
  if (state === 'hidden') return '{\\1a&HFF&\\3a&HFF&\\4a&HFF&}';
  if (state === 'active') {
    if (style.highlight === 'box') {
      bord = base.outline + base.boxPad;
      bordColor = style.boxColor;
      shad = 0;
      if (style.accent && !w.emph) color = style.accent;
    } else if (style.highlight !== 'none') {
      color = style.accent;
    }
  }
  t += '\\1c' + assColor(color) + '\\3c' + assColor(bordColor) + '\\bord' + bord + '\\shad' + shad;
  if (state === 'active' && style.highlight === 'pop') {
    var s = Math.round(100 * base.fit), s2 = Math.round(118 * base.fit);
    t += '\\fscx' + s + '\\fscy' + s + '\\t(0,90,\\fscx' + s2 + '\\fscy' + s2 + ')\\t(90,180,\\fscx' + Math.round(108 * base.fit) + '\\fscy' + Math.round(108 * base.fit) + ')';
  }
  return '{' + t + '}';
}

function captionLayout(words, cap, style, frame) {
  var scaleK = Math.min(frame.w, frame.h) / 1080;
  var size = style.size * scaleK;
  var lines = wrapLines(words, cap, style);
  // Shrink to fit 90% of the frame width (estimated from measured glyph widths).
  var f = FONTS[style.font] || { width: [0.45, 0.38] };
  var widest = 0;
  lines.forEach(function (ln) {
    var wpx = 0;
    ln.forEach(function (i, n) {
      var txt = displayText(words[i], style);
      for (var c = 0; c < txt.length; c++) {
        var ch = txt[c];
        wpx += size * (ch === ch.toUpperCase() && ch !== ch.toLowerCase() ? f.width[0] : f.width[1]) * 1.12;
      }
      if (n) wpx += size * 0.28;
      wpx += style.spacing * scaleK * txt.length;
    });
    widest = Math.max(widest, wpx);
  });
  var fit = widest > frame.w * 0.9 ? (frame.w * 0.9) / widest : 1;
  return { lines: lines, size: size, fit: fit, scaleK: scaleK };
}

/**
 * Build a complete .ass file.
 * frame: { w, h }    offset: seconds subtracted from every time (overlay clip start on the timeline)
 */
function buildAss(words, caps, style, frame, offset) {
  style = withDefaults(style);
  offset = offset || 0;
  var font = FONTS[style.font];
  var scaleK = Math.min(frame.w, frame.h) / 1080;
  var header = [
    '[Script Info]',
    '; Generated by Popline',
    'ScriptType: v4.00+',
    'PlayResX: ' + frame.w,
    'PlayResY: ' + frame.h,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: None',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: Cap,' + style.font + ',' + Math.round(style.size * scaleK) + ',' + styleColor(style.color) + ',&H00FFFFFF,' +
      styleColor(style.outlineColor) + ',' + styleColor(style.shadowColor, style.shadowOpacity) + ',0,' + (font && font.italic ? -1 : 0) +
      ',0,0,100,100,' + (style.spacing * scaleK) + ',0,1,' + Math.round(style.outline * scaleK) + ',' + Math.round(style.shadow * scaleK) + ',5,0,0,0,1',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'
  ];
  var events = [];
  var perWord = style.highlight !== 'none';

  caps.forEach(function (cap) {
    var lay = captionLayout(words, cap, style, frame);
    var base = {
      x: frame.w / 2, y: frame.h * style.posY / 100, fit: lay.fit, scaleK: scaleK,
      outline: Math.round(style.outline * scaleK), shadow: Math.round(style.shadow * scaleK),
      boxPad: Math.round(style.boxPad * scaleK), glow: style.glow * scaleK, spacing: style.spacing * scaleK,
      shadowAlpha: assAlpha(style.shadowOpacity), revealMode: style.highlight === 'reveal'
    };
    var cs = cap.start - offset, ce = cap.end - offset;
    var bounds = [cs];
    if (perWord) for (var i = cap.from + 1; i <= cap.to; i++) bounds.push(Math.min(ce, Math.max(cs, words[i].start - offset)));
    bounds.push(ce);
    var animMs = style.animMs;
    for (var sIdx = 0; sIdx < bounds.length - 1; sIdx++) {
      var a = bounds[sIdx], b = bounds[sIdx + 1];
      if (assTime(b) === assTime(a)) continue;
      var offMs = (a - cs) * 1000, lenMs = (b - a) * 1000;
      var tags = animTags(style.anim, animMs, offMs, lenMs, base);
      if (lay.fit < 1 && !(ANIMS[style.anim] || []).some(function (k) { return k.scale !== undefined; })) {
        tags += '\\fscx' + Math.round(lay.fit * 1000) / 10 + '\\fscy' + Math.round(lay.fit * 1000) / 10;
      }
      if (style.glow && !(ANIMS[style.anim] || []).some(function (k) { return k.blur !== undefined; })) tags += '\\blur' + base.glow;
      if (style.out === 'fade' && sIdx === bounds.length - 2) {
        tags += '\\t(' + Math.max(0, Math.round(lenMs - 160)) + ',' + Math.round(lenMs) + ',\\alpha&HFF&)';
      }
      var active = perWord ? cap.from + sIdx : -1;
      var text = lay.lines.map(function (ln) {
        return ln.map(function (wi) {
          var state = 'normal';
          if (wi === active) state = 'active';
          else if (style.highlight === 'reveal' && active >= 0 && wi > active) state = 'hidden';
          var prefix = wordTags(words[wi], wi - cap.from, state, style, base);
          // A popped word changed the scale; restore the line's (animated) scale for the next word.
          var after = (wi === active && style.highlight === 'pop') ? '{' + animScaleRestore(style, animMs, offMs, lenMs, base, lay) + '}' : '';
          return prefix + escapeAss(displayText(words[wi], style)) + after;
        }).join(' ');
      }).join('\\N');
      events.push('Dialogue: 1,' + assTime(a) + ',' + assTime(b) + ',Cap,,0,0,0,,{' + tags + '}' + text);
    }
    if (style.anim === 'glitch') events.push.apply(events, glitchLayers(words, cap, style, base, lay, cs, Math.min(ce, cs + 0.45)));
  });
  return header.concat(events).join('\n') + '\n';
}

/** Re-emit the line's animated scale after a popped word so later words aren't stuck at 100%. */
function animScaleRestore(style, animMs, offMs, lenMs, base, lay) {
  var kfs = ANIMS[style.anim] || [];
  if (!kfs.some(function (k) { return k.scale !== undefined; })) {
    var s = Math.round(lay.fit * 1000) / 10;
    return '\\fscx' + s + '\\fscy' + s;
  }
  return animTags(style.anim, animMs, offMs, lenMs, base, ['scale']);
}

/** Red/cyan offset copies that snap into place: the "error" glitch look. */
function glitchLayers(words, cap, style, base, lay, a, b) {
  var text = lay.lines.map(function (ln) { return ln.map(function (wi) { return escapeAss(displayText(words[wi], style)); }).join(' '); }).join('\\N');
  var d = Math.round(14 * base.scaleK);
  var len = Math.round((b - a) * 1000);
  var fit = lay.fit < 1 ? '\\fscx' + Math.round(lay.fit * 1000) / 10 + '\\fscy' + Math.round(lay.fit * 1000) / 10 : '';
  function layer(col, dx, dy) {
    return 'Dialogue: 0,' + assTime(a) + ',' + assTime(b) + ',Cap,,0,0,0,,{\\move(' + Math.round(base.x + dx) + ',' + Math.round(base.y + dy) + ',' +
      Math.round(base.x) + ',' + Math.round(base.y) + ',0,' + len + ')' + fit + '\\bord0\\shad0\\1c' + assColor(col) + '\\alpha&H40&\\t(' + Math.round(len * 0.6) + ',' + len + ',\\alpha&HFF&)}' + text;
  }
  return [layer('#FF0040', -d, Math.round(d / 3)), layer('#00F0FF', d, -Math.round(d / 3))];
}

/* ------------------------------------------------------------- SRT */

function buildSrt(words, caps, style) {
  style = withDefaults(style);
  return caps.map(function (cap, k) {
    var lines = wrapLines(words, cap, style).map(function (ln) {
      return ln.map(function (i) { return displayText(words[i], style); }).join(' ');
    });
    return (k + 1) + '\n' + srtTime(cap.start) + ' --> ' + srtTime(cap.end) + '\n' + lines.join('\n') + '\n';
  }).join('\n');
}

/** Plain transcript with paragraph breaks at sentence ends after long pauses. */
function plainText(words) {
  var out = '';
  words.forEach(function (w, i) {
    if (i) out += (words[i - 1] && w.start - words[i - 1].end > 1.2 && endsSentence(words[i - 1].text)) ? '\n\n' : ' ';
    out += w.text;
  });
  return out;
}

module.exports = {
  FONTS: FONTS,
  PRESETS: PRESETS,
  ANIM_NAMES: ANIM_NAMES,
  BASE_STYLE: BASE_STYLE,
  presetById: presetById,
  withDefaults: withDefaults,
  normalizeWords: normalizeWords,
  removeFillers: removeFillers,
  groupCaptions: groupCaptions,
  captionEditText: captionEditText,
  applyCaptionEdit: applyCaptionEdit,
  mergeWithPrevious: mergeWithPrevious,
  shiftWords: shiftWords,
  wrapLines: wrapLines,
  assTime: assTime,
  srtTime: srtTime,
  assColor: assColor,
  animTags: animTags,
  buildAss: buildAss,
  buildSrt: buildSrt,
  plainText: plainText
};
