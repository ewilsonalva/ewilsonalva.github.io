/*
 * Smart Mix: give each caption a preset that fits what is being said.
 * Offline heuristics on the transcript: punctuation, vocabulary, numbers, speaking pace, position.
 * Deterministic for a given seed, so "shuffle" gives a new but still sensible mix.
 */
'use strict';

var LEX = {
  hype: /\b(insane|crazy|huge|massive|best|worst|never|always|million|billion|free|secret|viral|wow|omg|epic|literally|unbelievable|incredible|amazing|biggest|fastest|money|rich|win|winning|hack|instantly|guaranteed|boom|let'?s go|game.?changer)\b/i,
  serious: /\b(death|died|dead|fear|scared|warning|danger|dangerous|problem|mistake|truth|lie|lied|lost|lose|fail|failed|broke|stop|never again|serious|dark|cancer|war|crisis|pain|hurt|nobody|no one)\b/i,
  soft: /\b(love|loved|feel|feeling|heart|dream|dreams|beautiful|family|life|hope|remember|thank|thanks|grateful|peace|calm|gentle|soul|forever|together|mom|dad|wife|husband|baby|kids?)\b/i,
  tech: /\b(game|games|gaming|gamer|computer|code|coding|ai|robot|retro|pixel|internet|online|app|tech|software|80s|90s|level|boss|console|stream)\b/i,
  fun: /\b(funny|lol|haha|joke|party|fun|weird|cute|silly|dance|crazy|lmao|vibes?|bro|dude)\b/i,
  hook: /^(so|listen|look|okay|ok|here'?s|stop|wait|imagine|did you know|this is|you won'?t|nobody)\b/i
};

// Which preset categories fit each mood, best first.
var MOOD_CATS = {
  hook: ['Viral', 'Cinematic'],
  hype: ['Viral', 'Fun'],
  number: ['Viral', 'Cinematic'],
  question: ['Modern', 'Minimal', 'Viral'],
  serious: ['Cinematic', 'Modern'],
  soft: ['Elegant', 'Modern'],
  tech: ['Retro', 'Cinematic'],
  fun: ['Fun', 'Viral'],
  calm: ['Minimal', 'Modern', 'Elegant'],
  base: []
};

/** Classify one caption. Returns { mood, strength 0..1, reason } */
function moodOf(text, idx, durSec, wordCount) {
  var t = String(text);
  var rate = durSec > 0 ? wordCount / durSec : 3;
  if (idx === 0 && (LEX.hook.test(t) || /[!?]/.test(t))) return { mood: 'hook', strength: 1, reason: 'opening hook' };
  var m;
  if ((m = t.match(LEX.serious))) return { mood: 'serious', strength: 0.9, reason: '"' + m[0] + '"' };
  if (/[$€£%]|\b\d[\d,.]*\b|\b(one|two|three|ten|hundred|thousand|million)\b/i.test(t) && (m = t.match(/[$€£]?\d[\d,.]*%?|\b(hundred|thousand|million|billion)\b/i))) {
    return { mood: 'number', strength: 0.85, reason: 'number ' + m[0] };
  }
  if (/!/.test(t) || (m = t.match(LEX.hype)) || /\b[A-Z]{3,}\b/.test(t)) return { mood: 'hype', strength: 0.8, reason: m ? '"' + m[0] + '"' : 'exclamation' };
  if (/\?/.test(t)) return { mood: 'question', strength: 0.7, reason: 'question' };
  if ((m = t.match(LEX.soft))) return { mood: 'soft', strength: 0.7, reason: '"' + m[0] + '"' };
  if ((m = t.match(LEX.tech))) return { mood: 'tech', strength: 0.6, reason: '"' + m[0] + '"' };
  if ((m = t.match(LEX.fun))) return { mood: 'fun', strength: 0.6, reason: '"' + m[0] + '"' };
  if (rate < 1.8 && wordCount >= 3) return { mood: 'calm', strength: 0.5, reason: 'slow delivery' };
  return { mood: 'base', strength: 0, reason: '' };
}

function rng(seed) {
  var s = (seed >>> 0) || 1;
  return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/**
 * Plan a mix.
 * captions: [{ text, start, end, words }]
 * pool: [{ key: 'look:id' | 'tpl:id', label, cat }]   (the presets the user allows)
 * opts: { variety 0..100, seed, baseKey }   baseKey = preset used for plain captions (null = keep global style)
 * Returns [{ key|null, mood, reason }] one per caption.
 */
function plan(captions, pool, opts) {
  opts = opts || {};
  var variety = opts.variety == null ? 60 : opts.variety;
  var rand = rng(opts.seed || 7);
  var byCat = {};
  pool.forEach(function (p) { (byCat[p.cat] = byCat[p.cat] || []).push(p); });
  var prev = null, prevPrev = null;
  return captions.map(function (c, i) {
    var md = moodOf(c.text, i, c.end - c.start, c.words || String(c.text).split(/\s+/).length);
    // Plain captions keep the base look; mood captions get an accent if the variety roll allows it.
    // Variety 0 = one look everywhere; low values only accent the strongest moods (hooks, numbers, serious lines).
    var useAccent = variety > 0 && md.mood !== 'base' && (md.strength >= 0.85 || rand() * 100 < variety * (0.4 + md.strength * 0.6));
    if (!useAccent && variety > 0 && md.mood !== 'base' && rand() * 100 < variety * 0.15) useAccent = true;
    if (!useAccent) {
      if (md.mood === 'base' && variety >= 80 && pool.length && rand() < 0.35) {
        var any = pool[Math.floor(rand() * pool.length)];
        if (any.key !== prev) { prevPrev = prev; prev = any.key; return { key: any.key, mood: 'variety', reason: 'variety' }; }
      }
      prevPrev = prev; prev = opts.baseKey || null;
      return { key: opts.baseKey || null, mood: md.mood, reason: md.reason };
    }
    var cats = MOOD_CATS[md.mood] || [];
    var choices = [];
    cats.forEach(function (cat) { if (!choices.length && byCat[cat]) choices = byCat[cat]; });
    if (!choices.length) choices = pool;
    var fresh = choices.filter(function (p) { return p.key !== prev && p.key !== prevPrev; });
    if (fresh.length) choices = fresh;
    var pick = choices.length ? choices[Math.floor(rand() * choices.length)] : null;
    prevPrev = prev; prev = pick ? pick.key : null;
    return { key: pick ? pick.key : (opts.baseKey || null), mood: md.mood, reason: md.reason };
  });
}

module.exports = { moodOf: moodOf, plan: plan, MOOD_CATS: MOOD_CATS };
