/*
 * Popline preset library: the user's own folder of .mogrt templates plus per-template settings
 * (name, category, default text, colour/number overrides). Lives in ~/.popline/library so it
 * survives plugin updates and can be changed without admin rights.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var os = require('os');
var M = require('./mogrt.js');

function libDir() { return path.join(os.homedir(), '.popline', 'library'); }
function metaPath() { return path.join(os.homedir(), '.popline', 'library.json'); }
function thumbDir() { return path.join(os.homedir(), '.popline', 'thumbs'); }

function loadMeta() {
  try { return JSON.parse(fs.readFileSync(metaPath(), 'utf8')); } catch (e) { return { templates: {}, seeded: false }; }
}
function saveMeta(meta) {
  fs.mkdirSync(path.dirname(metaPath()), { recursive: true });
  fs.writeFileSync(metaPath(), JSON.stringify(meta, null, 1));
}

function uniqueIn(dir, name) {
  var base = name.replace(/\.mogrt$/i, ''), p = path.join(dir, base + '.mogrt');
  for (var i = 2; fs.existsSync(p); i++) p = path.join(dir, base + ' (' + i + ').mogrt');
  return p;
}

/** First run: copy the templates bundled with the plugin (extension packs/ folder) into the library. */
function seed(extRoot) {
  var meta = loadMeta();
  if (meta.seeded) return 0;
  var n = 0;
  var bundled = extRoot ? path.join(extRoot, 'packs') : null;
  if (bundled && fs.existsSync(bundled)) {
    M.findMogrts(bundled).forEach(function (f) {
      var rel = path.relative(bundled, f);
      var dest = path.join(libDir(), rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      if (!fs.existsSync(dest)) { fs.copyFileSync(f, dest); n++; }
    });
  }
  meta.seeded = true;
  saveMeta(meta);
  return n;
}

/** Copy .mogrt files (paths) into the library. Returns the copied paths; skips non-mogrt files. */
function importFiles(files, group) {
  var dir = group ? path.join(libDir(), group) : libDir();
  fs.mkdirSync(dir, { recursive: true });
  var out = [];
  files.forEach(function (f) {
    if (!/\.mogrt$/i.test(f)) return;
    if (path.dirname(path.resolve(f)) === path.resolve(dir)) { out.push(f); return; }
    var dest = uniqueIn(dir, path.basename(f));
    fs.copyFileSync(f, dest);
    M.readMogrt(dest, thumbDir());   // validate: throws on a broken file
    out.push(dest);
  });
  return out;
}

/** Save a dropped file (bytes) into the library. */
function importBuffer(name, buf) {
  fs.mkdirSync(libDir(), { recursive: true });
  var dest = uniqueIn(libDir(), path.basename(name));
  fs.writeFileSync(dest, buf);
  try { M.readMogrt(dest, thumbDir()); } catch (e) { fs.unlinkSync(dest); throw new Error(name + ' is not a valid .mogrt (' + e.message + ')'); }
  return dest;
}

/** Is this template a file the library owns (so deleting removes the file)? */
function owns(tpl) {
  return path.resolve(tpl.path).indexOf(path.resolve(libDir()) + path.sep) === 0;
}

/**
 * Delete a template. Library files are removed from disk; templates that live in an outside folder
 * are hidden instead (the original file is left alone).
 */
function remove(tpl) {
  var meta = loadMeta();
  if (owns(tpl)) {
    try { fs.unlinkSync(tpl.path); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (tpl.thumb) { try { fs.unlinkSync(tpl.thumb); } catch (e2) {} }
    delete meta.templates[tpl.id];
  } else {
    meta.hidden = (meta.hidden || []).concat([tpl.path]);
  }
  saveMeta(meta);
}

function unhideAll() {
  var meta = loadMeta();
  meta.hidden = [];
  saveMeta(meta);
}

/** Per-template settings: { label, cat, text, params: {name: value} } */
function settings(id) {
  var meta = loadMeta();
  return meta.templates[id] || {};
}
function saveSettings(id, s) {
  var meta = loadMeta();
  meta.templates[id] = s;
  saveMeta(meta);
}

/** Library + extra folders -> templates with their saved settings applied. */
function list(extraFolders) {
  var meta = loadMeta();
  var folders = [libDir()].concat(extraFolders || []);
  fs.mkdirSync(libDir(), { recursive: true });
  var r = M.scanPacks(folders, thumbDir());
  var hidden = meta.hidden || [];
  r.templates = r.templates.filter(function (t) { return hidden.indexOf(t.path) < 0; }).map(function (t) {
    var s = meta.templates[t.id] || {};
    t.owned = owns(t);
    t.pack = t.owned ? (path.dirname(t.path) === libDir() ? 'My presets' : path.basename(path.dirname(t.path))) : t.pack;
    if (s.label) t.name = s.label;
    t.cat = s.cat || guessCategory(t);
    t.text = s.text || '';
    t.overrides = s.params || {};
    return t;
  });
  r.hiddenCount = hidden.length;
  return r;
}

/** Category from the template's name/fonts (used by Smart Mix until the user sets one). */
function guessCategory(t) {
  var s = (t.name + ' ' + t.file + ' ' + (t.fonts || []).join(' ')).toLowerCase();
  if (/glitch|error|vhs|cine|film|blur|trailer|epic/.test(s)) return 'Cinematic';
  if (/elegant|serif|script|hand|luxury|gold|wedding|signature|money/.test(s)) return 'Elegant';
  if (/neon|retro|80s|arcade|pixel|8bit/.test(s)) return 'Retro';
  if (/comic|fun|bounce|rebote|cartoon|emoji|wave|trippy|rainbow/.test(s)) return 'Fun';
  if (/minimal|clean|simple|lower.?third|subtitle/.test(s)) return 'Minimal';
  if (/pop|viral|bold|hype|punch|karaoke/.test(s)) return 'Viral';
  return 'Modern';
}

module.exports = {
  libDir: libDir,
  thumbDir: thumbDir,
  seed: seed,
  importFiles: importFiles,
  importBuffer: importBuffer,
  owns: owns,
  remove: remove,
  unhideAll: unhideAll,
  settings: settings,
  saveSettings: saveSettings,
  list: list,
  guessCategory: guessCategory
};
