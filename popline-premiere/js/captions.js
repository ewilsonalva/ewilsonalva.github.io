/*
 * Popline caption engine: words -> captions -> animated ASS subtitles / SRT / MOGRT placements.
 * Pure functions (no fs, no CEP) so everything here is unit tested in test/.
 *
 * Word:    { text, start, end, emph?, brk?, join?, look?, capLook?, capTpl?, src? }   times in seconds (timeline)
 *          emph    = always accent-coloured           brk/join = force / forbid a caption break after it
 *          look    = this word uses another look      capLook  = the whole caption uses another look
 *          capTpl  = the whole caption is placed as a Motion Graphics Template (id from mogrt.js)
 * Caption: { start, end, from, to }                   words[from..to] inclusive
 */
'use strict';

var LK = require('./looks.js');
var FONTS = LK.FONTS, ANIMS = LK.ANIMS, withDefaults = LK.withDefaults;

/* ------------------------------------------------------------- words */

var FILLERS = /^(um+|uh+|erm+|er|ah+|hmm+|mm+|uhm+|eh+)$/i;

/**
 * Clean raw transcriber tokens: join punctuation / word pieces onto the previous word,
 * drop [BLANK_AUDIO], (music) and similar non-speech markers.
 * raw: [{ text, start, end, src? }] where text keeps the transcriber's leading space for word starts.
 */
function normalizeWords(raw) {
  var out = [];
  (raw || []).forEach(function (t) {
    var txt = String(t.text == null ? '' : t.text);
    var trimmed = txt.trim();
    if (!trimmed) return;
    if (/^[\[(].*[\])]$/.test(trimmed) || /^\*.*\*$/.test(trimmed) || /^♪+$/.test(trimmed)) return;
    // Transcribers mark word starts with a leading space; a token without one continues the previous
    // word ("don" + "'t", "U" + ".S."), as long as it follows straight on from the same clip.
    var prev = out[out.length - 1];
    var sameSrc = prev && prev.src === t.src;
    var continues = prev && sameSrc && !/^\s/.test(txt) && +t.start - prev.end < 0.5;
    var isPunct = /^[.,!?;:%…"'”’)\]-]+$/.test(trimmed);
    if (prev && sameSrc && (continues || isPunct)) {
      prev.text += trimmed;
      prev.end = Math.max(prev.end, +t.end);
      return;
    }
    var w = { text: trimmed, start: +t.start, end: Math.max(+t.end, +t.start) };
    if (t.src !== undefined) w.src = t.src;
    out.push(w);
  });
  out.sort(function (a, b) { return a.start - b.start; });
  for (var i = 1; i < out.length; i++) {
    if (out[i].end < out[i].start) out[i].end = out[i].start;
  }
  return out;
}

/**
 * Whole-sequence transcription hears the same speech on several tracks (dual-system audio,
 * duplicated dialogue). Keep a word only if no already-kept word from another clip covers half of it.
 * Words must be sorted by start; earlier sources (lower tracks) win.
 */
function dedupeOverlaps(words) {
  var kept = [];
  words.slice().sort(function (a, b) { return a.start - b.start || (a.src || 0) - (b.src || 0); }).forEach(function (w) {
    var dur = Math.max(0.05, w.end - w.start);
    for (var j = kept.length - 1; j >= 0 && kept[j].end > w.start - 2; j--) {
      var k = kept[j];
      if (k.src === w.src) continue;
      var overlap = Math.min(k.end, w.end) - Math.max(k.start, w.start);
      if (overlap > dur * 0.5) return;
    }
    kept.push(w);
  });
  return kept;
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
      // A caption look / template starts and ends with the caption it was set on.
      var lookEdge = (w.capLook || w.capTpl || null) !== (prev.capLook || prev.capTpl || null);
      if (!prev.join && (prev.brk || lookEdge || cur.to - cur.from + 1 >= maxWords || chars + w.text.length > maxChars ||
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

function bare(t) { return String(t).toLowerCase().replace(/[^\w']/g, ''); }

/**
 * Apply an edited caption text. Same word count keeps every word's timing and look; otherwise the
 * caption's time span is shared out by word length and looks follow matching words.
 * "*word*" marks emphasis, a lone "|" forces a caption break. Returns a new words array.
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
  var capLook = old[0].capLook, capTpl = old[0].capTpl;
  if (fresh.length === old.length) {
    fresh.forEach(function (w, i) {
      w.start = old[i].start; w.end = old[i].end;
      if (old[i].join && !w.brk) w.join = true;
      if (old[i].look) w.look = old[i].look;
      if (old[i].src !== undefined) w.src = old[i].src;
    });
  } else if (fresh.length) {
    var weights = fresh.map(function (w) { return w.text.length + 2; });
    var total = weights.reduce(function (a, b) { return a + b; }, 0);
    var t = t0, used = {};
    fresh.forEach(function (w, i) {
      w.start = t;
      t += (t1 - t0) * weights[i] / total;
      w.end = i === fresh.length - 1 ? t1 : t;
      for (var j = 0; j < old.length; j++) {
        if (!used[j] && old[j].look && bare(old[j].text) === bare(w.text)) { w.look = old[j].look; used[j] = 1; break; }
      }
      if (old[0].src !== undefined) w.src = old[0].src;
    });
  }
  fresh.forEach(function (w) {
    if (capLook) w.capLook = capLook;
    if (capTpl) w.capTpl = capTpl;
    Object.keys(w).forEach(function (k) { if (w[k] === undefined) delete w[k]; });
  });
  return words.slice(0, cap.from).concat(fresh, words.slice(cap.to + 1));
}

/** Merge a caption into the previous one (sets join on the boundary, clears breaks inside). */
function mergeWithPrevious(words, caps, k) {
  if (k <= 0) return words;
  var out = words.map(function (w) { return Object.assign({}, w); });
  var prevLast = caps[k - 1].to;
  out[prevLast].join = true;
  delete out[prevLast].brk;
  // The merged words take the earlier caption's look / template.
  for (var i = caps[k].from; i <= caps[k].to; i++) {
    if (out[caps[k - 1].from].capLook) out[i].capLook = out[caps[k - 1].from].capLook; else delete out[i].capLook;
    if (out[caps[k - 1].from].capTpl) out[i].capTpl = out[caps[k - 1].from].capTpl; else delete out[i].capTpl;
  }
  return out;
}

/** Give words (indices) another look; null clears it. */
function setWordLook(words, indices, lookId) {
  var out = words.map(function (w) { return Object.assign({}, w); });
  indices.forEach(function (i) { if (lookId) out[i].look = lookId; else delete out[i].look; });
  return out;
}

/** Give a whole caption another look (capLook) or a template (capTpl); null clears both. */
function setCaptionLook(words, cap, lookId, tplId) {
  var out = words.map(function (w) { return Object.assign({}, w); });
  for (var i = cap.from; i <= cap.to; i++) {
    delete out[i].capLook; delete out[i].capTpl;
    if (lookId) out[i].capLook = lookId;
    if (tplId) out[i].capTpl = tplId;
  }
  // Keep the caption as one unit even if the look's spacing would regroup it.
  for (var j = cap.from; j < cap.to; j++) if (lookId || tplId) out[j].join = true;
  if (cap.to < out.length - 1 && (lookId || tplId)) out[cap.to].brk = true;
  return out;
}

function capLookId(words, cap) { return words[cap.from].capLook || null; }
function capTemplate(words, cap) { return words[cap.from].capTpl || null; }

/** Shift every word by `secs` (sync fix). */
function shiftWords(words, secs) {
  return words.map(function (w) { return Object.assign({}, w, { start: Math.max(0, w.start + secs), end: Math.max(0, w.end + secs) }); });
}

/* ------------------------------------------------------------- formats */

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

function hexByte(n) {
  var h = Math.round(Math.max(0, Math.min(255, n))).toString(16).toUpperCase();
  return h.length < 2 ? '0' + h : h;
}

function rgb(hex) {
  var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  var h = m ? m[1] : 'FFFFFF';
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** '#RRGGBB' -> ASS &HBBGGRR& */
function assColor(hex) {
  var c = rgb(hex);
  return '&H' + hexByte(c[2]) + hexByte(c[1]) + hexByte(c[0]) + '&';
}
function mixColor(a, b, k) {
  var x = rgb(a), y = rgb(b);
  return '&H' + hexByte(x[2] + (y[2] - x[2]) * k) + hexByte(x[1] + (y[1] - x[1]) * k) + hexByte(x[0] + (y[0] - x[0]) * k) + '&';
}
function assAlpha(opacityPct) {
  return '&H' + hexByte(255 * (1 - Math.max(0, Math.min(100, opacityPct)) / 100)) + '&';
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

/* ------------------------------------------------------------- animation */

function lerp(a, b, k) { return a + (b - a) * k; }

/** Animated property value at progress p (0..1). */
function valueAt(kfs, prop, p, rest) {
  var have = kfs.filter(function (k) { return k[prop] !== undefined; });
  if (!have.length) return rest;
  if (p <= have[0].p) return have[0][prop];
  for (var i = 1; i < have.length; i++) {
    if (p <= have[i].p) return lerp(have[i - 1][prop], have[i][prop], (p - have[i - 1].p) / (have[i].p - have[i - 1].p));
  }
  return have[have.length - 1][prop];
}

var PROPS = ['alpha', 'scale', 'sx', 'sy', 'blur', 'spacing', 'frx', 'fry', 'frz'];
var REST = { alpha: 0, scale: 100, sx: 100, sy: 100, blur: 0, spacing: 0, frx: 0, fry: 0, frz: 0 };

function r1(n) { return Math.round(n * 10) / 10; }

/** ASS override tags for a set of animated property values. */
function propTags(v, base) {
  var t = '';
  if (v.alpha !== undefined) t += '\\alpha&H' + hexByte(v.alpha) + '&';
  if (v.scale !== undefined) t += '\\fscx' + r1(v.scale) + '\\fscy' + r1(v.scale);
  if (v.sx !== undefined) t += '\\fscx' + r1(v.sx);
  if (v.sy !== undefined) t += '\\fscy' + r1(v.sy);
  if (v.blur !== undefined) t += '\\blur' + r1(v.blur + base.glow);
  if (v.spacing !== undefined) t += '\\fsp' + r1(v.spacing + base.spacing);
  if (v.frx !== undefined) t += '\\frx' + r1(v.frx);
  if (v.fry !== undefined) t += '\\fry' + r1(v.fry);
  if (v.frz !== undefined) t += '\\frz' + r1(v.frz);
  return t;
}

/**
 * Property tags (no position) for an animation that is `offMs` into its run (negative = not
 * started yet) inside an event lasting `lenMs`. Picks up exactly where an earlier event left off.
 */
function kfTags(kfs, durMs, offMs, lenMs, base, only) {
  var props = (only || PROPS).filter(function (pr) { return kfs.some(function (k) { return k[pr] !== undefined; }); });
  if (!props.length) return '';
  var p0 = durMs > 0 ? Math.max(0, Math.min(1, offMs / durMs)) : 1;
  var start = {};
  props.forEach(function (pr) { start[pr] = valueAt(kfs, pr, p0, REST[pr]); });
  var tags = propTags(start, base);
  for (var i = 1; i < kfs.length; i++) {
    var segStart = kfs[i - 1].p * durMs, segEnd = kfs[i].p * durMs;
    if (segEnd <= offMs) continue;
    var a = Math.max(0, Math.round(segStart - offMs)), b = Math.round(segEnd - offMs);
    if (a >= lenMs) break;
    var target = {};
    props.forEach(function (pr) { if (kfs[i][pr] !== undefined) target[pr] = kfs[i][pr]; });
    var tt = propTags(target, base);
    if (tt) tags += '\\t(' + a + ',' + Math.max(a + 1, b) + ',' + (i === kfs.length - 1 ? '0.6,' : '') + tt + ')';
  }
  return tags;
}

/**
 * Event-level tags for the caption's in-animation: position (\pos or \move) plus animated props.
 * Kept for compatibility with earlier callers/tests: animTags(name, durMs, offMs, lenMs, base, only)
 */
function animTags(name, durMs, offMs, lenMs, base, only) {
  var a = ANIMS[name] || ANIMS.none;
  var tags = a.perChar ? '' : kfTags(a.kf, durMs, offMs, lenMs, base, only);
  if (only) return tags;
  var kfs = a.kf, x = base.x, y = base.y;
  var p0 = durMs > 0 ? Math.max(0, Math.min(1, offMs / durMs)) : 1;
  var hasMove = !a.perChar && kfs.some(function (k) { return k.dx !== undefined || k.dy !== undefined; });
  if (hasMove && p0 < 1) {
    var k0 = base.scaleK;
    tags = '\\move(' + Math.round(x + valueAt(kfs, 'dx', p0, 0) * k0) + ',' + Math.round(y + valueAt(kfs, 'dy', p0, 0) * k0) + ',' +
      Math.round(x + valueAt(kfs, 'dx', 1, 0) * k0) + ',' + Math.round(y + valueAt(kfs, 'dy', 1, 0) * k0) + ',0,' + Math.max(1, Math.round(durMs - offMs)) + ')' + tags;
  } else {
    tags = '\\pos(' + Math.round(x) + ',' + Math.round(y) + ')' + tags;
  }
  return tags;
}

/** Per-letter delay for letter n of total letters. */
function charDelay(anim, n, total, durMs) {
  var st = anim.perChar.stagger;
  if (st === 'spread') return total > 1 ? n * durMs / total : 0;
  return n * st;
}

/* ------------------------------------------------------------- layout */

function wordStyle(words, i, capStyle, looks) {
  var id = words[i].look;
  var lk = id ? LK.lookById(id, looks) : null;
  return lk ? LK.overlayLook(capStyle, lk.style) : capStyle;
}

function captionLayout(words, cap, capStyle, frame, looks) {
  var scaleK = Math.min(frame.w, frame.h) / 1080;
  var lines = wrapLines(words, cap, capStyle);
  var widest = 0, letters = 0;
  lines.forEach(function (ln) {
    var wpx = 0;
    ln.forEach(function (i, n) {
      var ws = wordStyle(words, i, capStyle, looks);
      var size = ws.size * scaleK;
      var f = LK.fontFace(ws.font);
      var txt = displayText(words[i], ws);
      for (var c = 0; c < txt.length; c++) {
        var ch = txt[c];
        wpx += size * (ch === ch.toUpperCase() && ch !== ch.toLowerCase() ? f.width[0] : f.width[1]) * 1.12;
      }
      if (n) wpx += size * 0.28;
      wpx += ws.spacing * scaleK * txt.length;
      letters += txt.length;
    });
    widest = Math.max(widest, wpx);
  });
  // Shrink to fit 90% of the frame width (estimated from measured glyph widths).
  var fit = widest > frame.w * 0.9 ? (frame.w * 0.9) / widest : 1;
  return { lines: lines, fit: fit, scaleK: scaleK, width: Math.min(widest, frame.w * 0.9), letters: letters };
}

/* ------------------------------------------------------------- ASS output */

function styleLine(style, scaleK) {
  var f = LK.fontFace(style.font);
  function sc(hex, op) { return assAlpha(op == null ? 100 : op).replace(/&$/, '') + assColor(hex).replace(/^&H/, '').replace(/&$/, ''); }
  return 'Style: Cap,' + f.name + ',' + Math.round(style.size * scaleK) + ',' + sc(style.color) + ',' + sc(style.color) + ',' +
    sc(style.outlineColor, style.outlineOpacity) + ',' + sc(style.shadowColor, style.shadowOpacity) + ',' + (f.b ? -1 : 0) + ',' + (f.i ? -1 : 0) +
    ',0,0,100,100,' + r1(style.spacing * scaleK) + ',0,1,' + Math.round(style.outline * scaleK) + ',' + Math.round(style.shadow * scaleK) + ',5,0,0,0,1';
}

/**
 * Build a complete .ass file.
 * frame: { w, h }   offset: seconds subtracted from every time (overlay clip start on the timeline)
 * looks: extra (custom) looks [{id, style}] besides the built-in ones.
 * Captions placed as templates (capTpl) are left out: they are added as MOGRTs instead.
 */
function buildAss(words, caps, style, frame, offset, looks) {
  style = withDefaults(style);
  offset = offset || 0;
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
    styleLine(style, scaleK),
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'
  ];
  var events = [];
  caps.forEach(function (cap) {
    if (capTemplate(words, cap)) return;
    var lk = capLookId(words, cap) ? LK.lookById(capLookId(words, cap), looks) : null;
    var cs = lk ? LK.overlayLook(style, lk.style) : style;
    events.push.apply(events, captionEvents(words, cap, cs, frame, offset, looks));
  });
  return header.concat(events).join('\n') + '\n';
}

function captionEvents(words, cap, cs, frame, offset, looks) {
  var events = [];
  var lay = captionLayout(words, cap, cs, frame, looks);
  var scaleK = lay.scaleK;
  var anim = ANIMS[cs.anim] || ANIMS.none;
  var base = {
    x: frame.w / 2, y: frame.h * cs.posY / 100, scaleK: scaleK, fit: lay.fit,
    glow: cs.glow * scaleK, spacing: cs.spacing * scaleK
  };
  var t0 = cap.start - offset, t1 = cap.end - offset;
  var hl = cs.highlight;
  var perWord = hl !== 'none' && hl !== 'karaoke';
  var bounds = [t0];
  if (perWord) for (var i = cap.from + 1; i <= cap.to; i++) bounds.push(Math.min(t1, Math.max(t0, words[i].start - offset)));
  bounds.push(t1);
  var durMs = cs.animMs;

  for (var s = 0; s < bounds.length - 1; s++) {
    var a = bounds[s], b = bounds[s + 1];
    if (assTime(b) === assTime(a)) continue;
    var offMs = (a - t0) * 1000, lenMs = (b - a) * 1000;
    var tags = animTags(cs.anim, durMs, offMs, lenMs, base);
    var animHas = function (pr) { return anim.kf.some(function (k) { return k[pr] !== undefined; }); };
    if (cs.glow && (anim.perChar || !animHas('blur'))) tags += '\\blur' + r1(base.glow);
    if (anim.special === 'wipe') tags += wipeTags(base, lay, durMs, offMs, frame);
    if (cs.out === 'fade' && s === bounds.length - 2) tags += '\\t(' + Math.max(0, Math.round(lenMs - 160)) + ',' + Math.round(lenMs) + ',\\alpha&HFF&)';
    var active = perWord ? cap.from + s : -1;
    var ctx = {
      words: words, cap: cap, cs: cs, base: base, lay: lay, looks: looks, anim: anim, durMs: durMs,
      eventAbs: a + offset, offMs: offMs, lenMs: lenMs, active: active, letter: 0
    };
    var text = lay.lines.map(function (ln) {
      return ln.map(function (wi) { return wordMarkup(ctx, wi); }).join(' ');
    }).join('\\N');
    events.push('Dialogue: 1,' + assTime(a) + ',' + assTime(b) + ',Cap,,0,0,0,,{' + tags + '}' + text);
  }
  if (anim.special === 'glitch') events.push.apply(events, colorLayers(words, cap, cs, base, lay, t0, Math.min(t1, t0 + 0.45), true));
  if (anim.special === 'vhs') events.push.apply(events, colorLayers(words, cap, cs, base, lay, t0, t1, false));
  return events;
}

/** Left-to-right reveal (handwriting): an animated rectangular clip. */
function wipeTags(base, lay, durMs, offMs, frame) {
  var pad = 40 * base.scaleK;
  var x0 = Math.round(base.x - lay.width / 2 - pad), x1 = Math.round(base.x + lay.width / 2 + pad);
  var p0 = durMs > 0 ? Math.max(0, Math.min(1, offMs / durMs)) : 1;
  var cx = Math.round(lerp(x0, x1, p0));
  var t = '\\clip(' + x0 + ',0,' + cx + ',' + frame.h + ')';
  if (p0 < 1) t += '\\t(0,' + Math.round(durMs - offMs) + ',\\clip(' + x0 + ',0,' + x1 + ',' + frame.h + '))';
  return t;
}

/** Markup for one word inside a sub-event. */
function wordMarkup(ctx, wi) {
  var words = ctx.words, w = words[wi], cs = ctx.cs, base = ctx.base;
  var ws = wordStyle(words, wi, cs, ctx.looks);
  var face = LK.fontFace(ws.font);
  var hl = cs.highlight;
  var state = 'normal';
  if (wi === ctx.active) state = 'active';
  else if (hl === 'reveal' && ctx.active >= 0 && wi > ctx.active) state = 'hidden';
  var txt = escapeAss(displayText(w, ws));
  var idx = wi - ctx.cap.from;

  if (state === 'hidden') {
    ctx.letter += txt.length;
    return '{\\1a&HFF&\\3a&HFF&\\4a&HFF&}' + txt;
  }

  var px = ws.size * base.scaleK * base.fit;
  var color = ws.rainbow ? ws.palette[idx % ws.palette.length] : ws.color;
  if (w.emph) color = ws.accent;
  var bord = Math.round(ws.outline * base.scaleK), bordColor = ws.outlineColor, bordOp = ws.outlineOpacity, shad = Math.round(ws.shadow * base.scaleK);
  var extra = '';
  var fillAlpha = '00';
  if (hl === 'hollow') fillAlpha = 'FF';
  if (state === 'active') {
    if (hl === 'box') {
      bord += Math.round(cs.boxPad * base.scaleK);
      bordColor = cs.boxColor;
      bordOp = 100;
      shad = 0;
      if (!w.emph) color = ws.accent;
    } else if (hl === 'hollow') {
      fillAlpha = '00';
      color = ws.accent;
    } else {
      color = ws.accent;
    }
    if (hl === 'underline') extra += '\\u1';
    if (hl === 'bigger') px *= 1.25;
  }
  var t = '\\fn' + face.name + '\\fs' + r1(px) + '\\b' + face.b + '\\i' + face.i +
    '\\1c' + assColor(color) + '\\1a&H' + fillAlpha + '&\\3c' + assColor(bordColor) + '\\3a' + assAlpha(bordOp) +
    '\\4c' + assColor(ws.shadowColor) + '\\4a' + assAlpha(ws.shadowOpacity) + '\\bord' + bord + '\\shad' + shad + (hl === 'underline' && state !== 'active' ? '\\u0' : '') + extra;

  if (hl === 'karaoke') {
    // \kf sweeps from the secondary (base) colour to the primary (accent) colour while the word is spoken.
    var next = wi < ctx.cap.to ? words[wi + 1].start : w.end;
    var dur = Math.max(1, Math.round((Math.max(next, w.end) - Math.max(w.start, ctx.cap.start)) * 100));
    var lead = wi === ctx.cap.from ? Math.max(0, Math.round((w.start - ctx.cap.start) * 100)) : 0;
    t = t.replace('\\1c' + assColor(color), '\\1c' + assColor(w.emph ? ws.accent : cs.accent) + '\\2c' + assColor(ws.rainbow ? color : ws.color));
    return (lead ? '{\\k' + lead + '}' : '') + '{' + t + '\\kf' + dur + '}' + txt;
  }

  var restore = false;
  if (state === 'active' && hl === 'pop') {
    t += '\\fscx100\\fscy100\\t(0,90,\\fscx118\\fscy118)\\t(90,180,\\fscx108\\fscy108)';
    restore = true;
  }
  // A word with its own look: its spacing/glow, and its own animation keyed to when it is spoken.
  var wordAnim = null;
  if (w.look && ws !== cs) {
    t += '\\fsp' + r1(ws.spacing * base.scaleK) + '\\blur' + r1(ws.glow * base.scaleK);
    wordAnim = ANIMS[ws.anim] || null;
    restore = true;
  }
  var wordOff = (ctx.eventAbs - Math.max(w.start, ctx.cap.start)) * 1000;
  if (wordAnim && !wordAnim.perChar && wordAnim.kf.length) t += kfTags(wordAnim.kf, ws.animMs, wordOff, ctx.lenMs, { glow: ws.glow * base.scaleK, spacing: ws.spacing * base.scaleK });

  var perChar = (wordAnim && wordAnim.perChar) ? { anim: wordAnim, dur: ws.animMs, off: wordOff, base: { glow: ws.glow * base.scaleK, spacing: ws.spacing * base.scaleK }, first: 0, total: txt.length }
    : (ctx.anim.perChar && !(wordAnim && wordAnim.kf.length)) ? { anim: ctx.anim, dur: cs.animMs, off: ctx.offMs, base: base, first: ctx.letter, total: ctx.lay.letters } : null;
  var ramp = cs.fadeTail > 0 && state !== 'active' && !w.emph && !ws.rainbow;

  var body;
  if (perChar || ramp) {
    body = '';
    for (var c = 0; c < txt.length; c++) {
      var ct = '';
      if (perChar) {
        var n = perChar.first + c;
        var cd = perChar.anim.perChar.dur || perChar.dur;
        ct += kfTags(perChar.anim.kf, cd, perChar.off - charDelay(perChar.anim, n, perChar.total, perChar.dur), ctx.lenMs, perChar.base);
      }
      if (ramp) {
        var pos = (ctx.letter + c) / Math.max(1, ctx.lay.letters - 1);
        var k = Math.max(0, (pos - 0.35) / 0.65) * cs.fadeTail / 100;
        ct += '\\1c' + mixColor(color, cs.fadeColor, k);
      }
      body += (ct ? '{' + ct + '}' : '') + txt[c];
    }
  } else {
    body = txt;
  }
  ctx.letter += txt.length;

  var after = '';
  if (restore) {
    // Back to the caption's own (animated) state for the following words.
    after = '{\\fscx100\\fscy100\\frx0\\fry0\\frz0\\fsp' + r1(base.spacing) + '\\blur' + r1(base.glow) +
      (ctx.anim.perChar ? '\\alpha&H00&' : kfTags(ctx.anim.kf, ctx.durMs, ctx.offMs, ctx.lenMs, base)) + '}';
  }
  return '{' + t + '}' + body + after;
}

/** Red/cyan offset copies: snap together (glitch) or stay split for the whole caption (VHS). */
function colorLayers(words, cap, cs, base, lay, a, b, snap) {
  var text = lay.lines.map(function (ln) { return ln.map(function (wi) { return escapeAss(displayText(words[wi], cs)); }).join(' '); }).join('\\N');
  var face = LK.fontFace(cs.font);
  var d = Math.round((snap ? 14 : 6) * base.scaleK);
  var len = Math.round((b - a) * 1000);
  var px = r1(cs.size * base.scaleK * base.fit);
  function layer(col, dx, dy) {
    var mv = snap ? '\\move(' + Math.round(base.x + dx) + ',' + Math.round(base.y + dy) + ',' + Math.round(base.x) + ',' + Math.round(base.y) + ',0,' + len + ')'
      : '\\pos(' + Math.round(base.x + dx) + ',' + Math.round(base.y + dy) + ')';
    var fade = snap ? '\\alpha&H40&\\t(' + Math.round(len * 0.6) + ',' + len + ',\\alpha&HFF&)' : '\\alpha&HFF&\\t(0,' + Math.min(len, cs.animMs) + ',\\alpha&H70&)' + (cs.out === 'fade' ? '\\t(' + Math.max(0, len - 160) + ',' + len + ',\\alpha&HFF&)' : '');
    return 'Dialogue: 0,' + assTime(a) + ',' + assTime(b) + ',Cap,,0,0,0,,{' + mv + '\\fn' + face.name + '\\fs' + px + '\\b' + face.b + '\\i' + face.i +
      '\\bord0\\shad0\\blur' + (snap ? 0 : 1.5) + '\\1c' + assColor(col) + fade + '}' + text;
  }
  return [layer('#FF0040', -d, snap ? Math.round(d / 3) : 0), layer('#00F0FF', d, snap ? -Math.round(d / 3) : 0)];
}

/* ------------------------------------------------------------- templates (MOGRT) */

/** Split a caption's words over a template's text slots (contiguous, balanced by length). */
function splitIntoSlots(texts, slots) {
  if (slots <= 1) return [texts.join(' ')];
  if (texts.length <= slots) {
    var out = texts.slice();
    while (out.length < slots) out.push('');
    return out;
  }
  var total = texts.reduce(function (s, t) { return s + t.length + 1; }, 0);
  var res = [], cur = [], acc = 0, slot = 1;
  texts.forEach(function (t, i) {
    var remainingWords = texts.length - i, remainingSlots = slots - res.length;
    if (cur.length && res.length < slots - 1 && (acc >= total * slot / slots || remainingWords < remainingSlots + 0)) {
      res.push(cur.join(' ')); cur = []; slot++;
    }
    cur.push(t);
    acc += t.length + 1;
  });
  res.push(cur.join(' '));
  while (res.length < slots) res.push('');
  return res;
}

/**
 * MOGRT placements for every caption that has a template.
 * templates: { id: {path, slots, slotNames, scaleParam, comp:{w,h}} }   frame: sequence {w,h}
 * scalePct: user size (100 = the template's text spans the same share of the frame width as in its own comp).
 * Returns [{ path, start, end, texts, slotNames, scaleParam, scale }]
 */
function templateItems(words, caps, style, templates, frame, scalePct) {
  style = withDefaults(style);
  var items = [];
  caps.forEach(function (cap) {
    var id = capTemplate(words, cap);
    var tpl = id && templates[id];
    if (!tpl) return;
    var texts = [];
    for (var i = cap.from; i <= cap.to; i++) texts.push(displayText(words[i], style));
    var scale = null;
    if (frame && tpl.comp && tpl.comp.w) scale = Math.round(frame.w / tpl.comp.w * (scalePct || 100) * 10) / 10;
    items.push({ path: tpl.path, start: cap.start, end: cap.end, texts: splitIntoSlots(texts, tpl.slots || 1),
      slotNames: tpl.slotNames || [], scaleParam: tpl.scaleParam || null, scale: scale, name: tpl.name });
  });
  return items;
}

/* ------------------------------------------------------------- SRT / text */

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
  LOOKS: LK.LOOKS,
  PRESETS: LK.LOOKS,                 // older name
  presetById: function (id) { return LK.lookById(id); },
  lookById: LK.lookById,
  ANIM_NAMES: Object.keys(ANIMS),
  BASE_STYLE: LK.BASE_STYLE,
  withDefaults: withDefaults,
  normalizeWords: normalizeWords,
  dedupeOverlaps: dedupeOverlaps,
  removeFillers: removeFillers,
  groupCaptions: groupCaptions,
  captionEditText: captionEditText,
  applyCaptionEdit: applyCaptionEdit,
  mergeWithPrevious: mergeWithPrevious,
  setWordLook: setWordLook,
  setCaptionLook: setCaptionLook,
  capLookId: capLookId,
  capTemplate: capTemplate,
  shiftWords: shiftWords,
  wrapLines: wrapLines,
  assTime: assTime,
  srtTime: srtTime,
  assColor: assColor,
  animTags: animTags,
  kfTags: kfTags,
  buildAss: buildAss,
  splitIntoSlots: splitIntoSlots,
  templateItems: templateItems,
  buildSrt: buildSrt,
  plainText: plainText
};
