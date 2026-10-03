/*
 * Popline title packs: find .mogrt files, read their definition.json + thumbnail without unpacking
 * the whole file (they are zip archives; the After Effects project inside can be large).
 */
'use strict';

var fs = require('fs');
var path = require('path');
var os = require('os');
var zlib = require('zlib');
var crypto = require('crypto');

/* ------------------------------------------------------------- tiny zip reader */

function readAt(fd, pos, len) {
  var buf = Buffer.alloc(len);
  var got = fs.readSync(fd, buf, 0, len, pos);
  return got === len ? buf : buf.subarray(0, got);
}

/** List zip entries: [{name, method, compSize, size, localOffset}] */
function zipEntries(fd, fileSize) {
  var tailLen = Math.min(fileSize, 65557);
  var tail = readAt(fd, fileSize - tailLen, tailLen);
  var eocd = -1;
  for (var i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file');
  var count = tail.readUInt16LE(eocd + 10);
  var cdSize = tail.readUInt32LE(eocd + 12);
  var cdOffset = tail.readUInt32LE(eocd + 16);
  var cd = readAt(fd, cdOffset, cdSize);
  var out = [], p = 0;
  for (var n = 0; n < count && p + 46 <= cd.length; n++) {
    if (cd.readUInt32LE(p) !== 0x02014b50) break;
    var nameLen = cd.readUInt16LE(p + 28), extraLen = cd.readUInt16LE(p + 30), commentLen = cd.readUInt16LE(p + 32);
    out.push({
      name: cd.toString('utf8', p + 46, p + 46 + nameLen),
      method: cd.readUInt16LE(p + 10),
      compSize: cd.readUInt32LE(p + 20),
      size: cd.readUInt32LE(p + 24),
      localOffset: cd.readUInt32LE(p + 42)
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function zipRead(fd, entry) {
  var lh = readAt(fd, entry.localOffset, 30);
  if (lh.readUInt32LE(0) !== 0x04034b50) throw new Error('bad zip entry ' + entry.name);
  var start = entry.localOffset + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
  var data = readAt(fd, start, entry.compSize);
  if (entry.method === 0) return data;
  if (entry.method === 8) return zlib.inflateRawSync(data);
  throw new Error('unsupported zip compression ' + entry.method);
}

/* ------------------------------------------------------------- .mogrt */

function localized(v) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (v.strDB && v.strDB.length) return v.strDB[0].str;
  if (v.en_US) return v.en_US;
  var k = Object.keys(v)[0];
  return k ? localized(v[k]) : '';
}

/**
 * Read one .mogrt: { id, path, name, slots, slotNames, fonts, app, thumb (cached file path), comp {w,h}, scaleParam }
 * cacheDir receives the extracted thumbnail.
 */
function readMogrt(file, cacheDir) {
  var st = fs.statSync(file);
  var id = crypto.createHash('sha1').update(file + '|' + st.size).digest('hex').slice(0, 12);
  var fd = fs.openSync(file, 'r');
  try {
    var entries = zipEntries(fd, st.size);
    var defE = entries.filter(function (e) { return /(^|\/)definition\.json$/i.test(e.name); })[0];
    if (!defE) throw new Error('no definition.json');
    var def = JSON.parse(zipRead(fd, defE).toString('utf8').replace(/^﻿/, ''));
    var controls = def.clientControls || [];
    // Text fields are controls of type 6; their names repeat on the group (type 10) that holds them.
    var texts = controls.filter(function (c) { return c.type === 6; });
    var slotNames = texts.map(function (c) { return localized(c.uiName); });
    var scaleC = controls.filter(function (c) { return c.type === 9 && /scale/i.test(localized(c.uiName)); })[0];
    var posC = controls.filter(function (c) { return c.type === 5 && /position/i.test(localized(c.uiName)); })[0];
    var comp = { w: 1920, h: 1080 };
    if (posC && posC.value && posC.value.x > 0) comp = { w: Math.round(posC.value.x * 2), h: Math.round(posC.value.y * 2) };
    var thumbE = entries.filter(function (e) { return /(^|\/)thumb\.(png|jpe?g|gif)$/i.test(e.name); })[0];
    var thumb = null;
    if (thumbE && cacheDir) {
      fs.mkdirSync(cacheDir, { recursive: true });
      thumb = path.join(cacheDir, id + path.extname(thumbE.name).toLowerCase());
      if (!fs.existsSync(thumb)) fs.writeFileSync(thumb, zipRead(fd, thumbE));
    }
    // Customisable controls: colours (type 4) and number sliders (type 2).
    var params = controls.filter(function (c) { return c.type === 4 || c.type === 2; }).map(function (c) {
      var v = c.value;
      if (c.type === 4 && Array.isArray(v)) {
        var hx = function (f) { var h = Math.round(Math.max(0, Math.min(1, f)) * 255).toString(16); return h.length < 2 ? '0' + h : h; };
        return { name: localized(c.uiName), type: 'color', value: '#' + hx(v[0]) + hx(v[1]) + hx(v[2]) };
      }
      return { name: localized(c.uiName), type: 'number', value: typeof v === 'number' ? v : 0, min: c.min, max: c.max };
    }).filter(function (p) { return p.name; });
    var fonts = def.usedFontsLocalized ? (def.usedFontsLocalized.en_US || def.usedFontsLocalized[Object.keys(def.usedFontsLocalized)[0]] || []) : [];
    var sample = texts.map(function (c) { return localized(c.value); }).filter(Boolean).join(' ');
    return {
      id: id,
      path: file,
      name: localized(def.capsuleNameLocalized) || def.capsuleName || path.basename(file, '.mogrt'),
      file: path.basename(file),
      group: path.basename(path.dirname(file)),
      slots: Math.max(1, texts.length),
      slotNames: slotNames,
      sample: sample,
      fonts: fonts,
      app: def.authorApp || (entries.some(function (e) { return /\.aegraphic$/i.test(e.name); }) ? 'aftereffects' : 'premiere'),
      comp: comp,
      thumb: thumb,
      params: params,
      scaleParam: scaleC ? localized(scaleC.uiName) : null
    };
  } finally {
    fs.closeSync(fd);
  }
}

/** All .mogrt files under dir (recursive, skips hidden/system folders). */
function findMogrts(dir, depth) {
  depth = depth == null ? 6 : depth;
  var out = [];
  var names;
  try { names = fs.readdirSync(dir); } catch (e) { return out; }
  names.forEach(function (n) {
    if (/^[.~]|^__MACOSX$/.test(n)) return;
    var p = path.join(dir, n);
    var st;
    try { st = fs.statSync(p); } catch (e) { return; }
    if (st.isDirectory() && depth > 0) out = out.concat(findMogrts(p, depth - 1));
    else if (st.isFile() && /\.mogrt$/i.test(n)) out.push(p);
  });
  return out.sort(function (a, b) { return a.localeCompare(b, undefined, { numeric: true }); });
}

/**
 * Folders that look like title packs: the extension's own packs/ folder plus anything in Downloads,
 * Documents or Desktop whose name mentions titles/presets/mogrt (e.g. "TITLES PRESETS-2026…").
 */
function discoverPackFolders(extRoot) {
  var found = [];
  if (extRoot) {
    var own = path.join(extRoot, 'packs');
    if (fs.existsSync(own)) found.push(own);
  }
  ['Downloads', 'Documents', 'Desktop'].forEach(function (d) {
    var base = path.join(os.homedir(), d);
    var names;
    try { names = fs.readdirSync(base); } catch (e) { return; }
    names.forEach(function (n) {
      if (!/title|preset|mogrt|text pack/i.test(n)) return;
      var p = path.join(base, n);
      try { if (fs.statSync(p).isDirectory() && findMogrts(p, 4).length) found.push(p); } catch (e) {}
    });
  });
  return found;
}

/** Scan folders -> templates (skips unreadable files, reports them in `errors`). */
function scanPacks(folders, cacheDir) {
  var templates = [], errors = [], seen = {};
  folders.forEach(function (dir) {
    findMogrts(dir).forEach(function (f) {
      try {
        var t = readMogrt(f, cacheDir);
        if (seen[t.id]) return;
        seen[t.id] = 1;
        t.pack = path.basename(dir);
        templates.push(t);
      } catch (e) {
        errors.push(path.basename(f) + ': ' + e.message);
      }
    });
  });
  return { templates: templates, errors: errors };
}

module.exports = {
  zipEntries: zipEntries,
  readMogrt: readMogrt,
  findMogrts: findMogrts,
  discoverPackFolders: discoverPackFolders,
  scanPacks: scanPacks
};
