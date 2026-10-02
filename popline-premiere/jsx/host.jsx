/*
 * Popline host script (ExtendScript, runs inside Premiere Pro). ES3 only.
 * Every public function returns a JSON string: {"ok":true,...} or {"ok":false,"error":"..."}.
 * Arrays/objects arrive as JS literals (the panel passes JSON, which is valid ES3).
 */

function pl_q(s) {
    return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t') + '"';
}

function pl_json(v) {
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'number') return isFinite(v) ? String(v) : 'null';
    if (typeof v === 'boolean') return String(v);
    if (typeof v === 'string') return pl_q(v);
    var parts = [], k;
    if (v instanceof Array) {
        for (k = 0; k < v.length; k++) parts.push(pl_json(v[k]));
        return '[' + parts.join(',') + ']';
    }
    for (k in v) if (v.hasOwnProperty(k)) parts.push(pl_q(k) + ':' + pl_json(v[k]));
    return '{' + parts.join(',') + '}';
}

function pl_err(e) {
    return pl_json({ ok: false, error: String(e) + (e && e.line ? ' (host.jsx line ' + e.line + ')' : '') });
}

function pl_time(sec) {
    var t = new Time();
    t.seconds = sec;
    return t;
}

function popline_ping() {
    return pl_json({ ok: true, version: app.version });
}

/** Active sequence: size, frame rate, playhead, in/out, and where the project lives. */
function popline_sequenceInfo() {
    try {
        var seq = app.project ? app.project.activeSequence : null;
        if (!seq) return pl_json({ ok: false, error: 'Open a sequence first.' });
        var fps = 30;
        try {
            var fr = seq.getSettings().videoFrameRate;
            if (fr && fr.seconds) fps = 1 / fr.seconds;
        } catch (e1) {}
        var inS = 0, outS = 0;
        try { inS = seq.getInPointAsTime().seconds; outS = seq.getOutPointAsTime().seconds; } catch (e2) {}
        var vt = [], at = [], i;
        for (i = 0; i < seq.videoTracks.numTracks; i++) vt.push(seq.videoTracks[i].name);
        for (i = 0; i < seq.audioTracks.numTracks; i++) at.push(seq.audioTracks[i].name);
        return pl_json({
            ok: true,
            name: seq.name,
            id: seq.sequenceID,
            width: seq.frameSizeHorizontal,
            height: seq.frameSizeVertical,
            fps: fps,
            playhead: seq.getPlayerPosition().seconds,
            inPoint: inS,
            outPoint: outS,
            end: pl_seqEnd(seq),
            videoTracks: vt,
            audioTracks: at,
            projectPath: app.project.path || ''
        });
    } catch (e) {
        return pl_err(e);
    }
}

function pl_seqEnd(seq) {
    var end = 0, groups = [seq.videoTracks, seq.audioTracks], g, t, c;
    for (g = 0; g < groups.length; g++) {
        for (t = 0; t < groups[g].numTracks; t++) {
            var clips = groups[g][t].clips;
            for (c = 0; c < clips.numItems; c++) if (clips[c].end.seconds > end) end = clips[c].end.seconds;
        }
    }
    return end;
}

function pl_clipInfo(ti) {
    var pi = ti.projectItem;
    if (!pi) return null;
    var media = '';
    try { media = pi.getMediaPath(); } catch (e) {}
    if (!media) return null;
    var speed = 1;
    try { if (ti.getSpeed) speed = ti.getSpeed(); } catch (e2) {}
    return {
        name: ti.name,
        mediaPath: media,
        inSec: ti.inPoint.seconds,
        startSec: ti.start.seconds,
        endSec: ti.end.seconds,
        speed: speed
    };
}

/**
 * Clips to transcribe.
 * scope "selected": selected clips (audio preferred; linked video/audio counted once)
 * scope "track":    every clip on audio track `trackIndex` (0 = A1)
 * If limitToInOut, clips are trimmed to the sequence in/out range.
 */
function popline_sources(scope, trackIndex, limitToInOut) {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return pl_json({ ok: false, error: 'Open a sequence first.' });
        var list = [], i, info;
        if (scope === 'selected') {
            var sel = seq.getSelection();
            var audio = [], video = [];
            for (i = 0; i < sel.length; i++) {
                info = pl_clipInfo(sel[i]);
                if (!info) continue;
                if (sel[i].mediaType === 'Audio') audio.push(info); else video.push(info);
            }
            list = audio.length ? audio : video;
            if (!list.length) return pl_json({ ok: false, error: 'Select the clips to caption on the timeline (or switch Source to an audio track).' });
        } else {
            var tr = seq.audioTracks[trackIndex || 0];
            if (!tr) return pl_json({ ok: false, error: 'That audio track does not exist.' });
            for (i = 0; i < tr.clips.numItems; i++) {
                info = pl_clipInfo(tr.clips[i]);
                if (info) list.push(info);
            }
            if (!list.length) return pl_json({ ok: false, error: 'No clips on ' + tr.name + '.' });
        }
        // De-duplicate (same media at the same place) and sort by time.
        var seen = {}, out = [];
        for (i = 0; i < list.length; i++) {
            var key = list[i].mediaPath + '@' + Math.round(list[i].startSec * 100);
            if (seen[key]) continue;
            seen[key] = true;
            out.push(list[i]);
        }
        if (limitToInOut) {
            var a = seq.getInPointAsTime().seconds, b = seq.getOutPointAsTime().seconds;
            var trimmed = [];
            for (i = 0; i < out.length; i++) {
                var c = out[i];
                if (c.endSec <= a || c.startSec >= b) continue;
                if (c.startSec < a) { c.inSec += (a - c.startSec) * c.speed; c.startSec = a; }
                if (c.endSec > b) c.endSec = b;
                trimmed.push(c);
            }
            out = trimmed;
        }
        out.sort(function (x, y) { return x.startSec - y.startSec; });
        return pl_json({ ok: true, sources: out });
    } catch (e) {
        return pl_err(e);
    }
}

function popline_seek(sec) {
    try {
        var seq = app.project.activeSequence;
        if (seq) seq.setPlayerPosition(String(Math.round(sec * 254016000000)));
        return pl_json({ ok: true });
    } catch (e) {
        return pl_err(e);
    }
}

function pl_bin(name) {
    var root = app.project.rootItem;
    for (var i = 0; i < root.children.numItems; i++) {
        var c = root.children[i];
        if (c && c.type === ProjectItemType.BIN && c.name === name) return c;
    }
    return root.createBin(name);
}

function pl_norm(p) { return String(p).replace(/\\/g, '/').toLowerCase(); }

/** Find a project item by media path anywhere in the project. */
function pl_findItem(parent, mediaPath) {
    var want = pl_norm(mediaPath);
    for (var i = 0; i < parent.children.numItems; i++) {
        var c = parent.children[i];
        if (!c) continue;
        if (c.type === ProjectItemType.BIN) {
            var r = pl_findItem(c, mediaPath);
            if (r) return r;
        } else if (c.type === ProjectItemType.CLIP || c.type === ProjectItemType.FILE) {
            try { if (pl_norm(c.getMediaPath()) === want) return c; } catch (e) {}
        }
    }
    return null;
}

function pl_import(filePath, binName) {
    var f = new File(filePath);
    if (!f.exists) throw new Error('File not found: ' + filePath);
    var bin = pl_bin(binName || 'Popline Captions');
    var item = pl_findItem(bin, f.fsName);
    if (!item) {
        app.project.importFiles([f.fsName], true, bin, false);
        item = pl_findItem(bin, f.fsName);
    }
    if (!item) throw new Error('Imported, but could not find ' + f.name + ' in the project.');
    return item;
}

function pl_trackBusy(track, from, to) {
    for (var c = 0; c < track.clips.numItems; c++) {
        var clip = track.clips[c];
        if (clip.start.seconds < to - 0.001 && clip.end.seconds > from + 0.001) return true;
    }
    return false;
}

/** Topmost video track that is free over [from, to); adds a track (QE) if every track is busy. */
function pl_captionTrack(seq, from, to) {
    var i, top = -1;
    for (i = seq.videoTracks.numTracks - 1; i >= 0; i--) {
        var tr = seq.videoTracks[i];
        var locked = false;
        try { locked = tr.isLocked(); } catch (e) {}
        if (locked) continue;
        if (!pl_trackBusy(tr, from, to)) top = i;
        else break; // stay above existing content
    }
    if (top >= 0) return top;
    try {
        app.enableQE();
        var qs = qe.project.getActiveSequence();
        qs.addTracks(1, seq.videoTracks.numTracks, 0);
        if (!pl_trackBusy(seq.videoTracks[seq.videoTracks.numTracks - 1], from, to)) return seq.videoTracks.numTracks - 1;
    } catch (e2) {}
    return seq.videoTracks.numTracks - 1;
}

/** Import the rendered overlay and put it on the top free video track at startSec. */
function popline_placeOverlay(filePath, startSec, durSec, binName) {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return pl_json({ ok: false, error: 'Open a sequence first.' });
        var item = pl_import(filePath, binName);
        var idx = pl_captionTrack(seq, startSec, startSec + durSec);
        var track = seq.videoTracks[idx];
        track.overwriteClip(item, pl_time(startSec));
        return pl_json({ ok: true, track: track.name, clip: item.name });
    } catch (e) {
        return pl_err(e);
    }
}

/** Point the existing overlay at a freshly rendered file; every use on the timeline updates. */
function popline_relinkOverlay(oldPath, newPath) {
    try {
        var item = pl_findItem(app.project.rootItem, oldPath);
        if (!item) return pl_json({ ok: false, notFound: true, error: 'The previous caption overlay is no longer in the project.' });
        if (!item.canChangeMediaPath()) return pl_json({ ok: false, error: 'Premiere will not relink ' + item.name + '.' });
        var ok = item.changeMediaPath(new File(newPath).fsName, true);
        if (!ok) return pl_json({ ok: false, error: 'Relink failed.' });
        try { item.name = new File(newPath).name; } catch (e2) {}
        return pl_json({ ok: true, clip: item.name });
    } catch (e) {
        return pl_err(e);
    }
}

/** Import an .srt and turn it into a Premiere caption track (editable in the Text panel). */
function popline_importCaptions(srtPath, binName) {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return pl_json({ ok: false, error: 'Open a sequence first.' });
        var item = pl_import(srtPath, binName);
        if (typeof seq.createCaptionTrack !== 'function') return pl_json({ ok: false, error: 'This Premiere version cannot create caption tracks from scripts. The .srt was imported into the bin; drag it onto the timeline.' });
        var format = (typeof Sequence !== 'undefined' && Sequence.CAPTION_FORMAT_SUBTITLE) ? Sequence.CAPTION_FORMAT_SUBTITLE : 'Subtitle';
        seq.createCaptionTrack(item, 0, format);
        return pl_json({ ok: true, clip: item.name });
    } catch (e) {
        return pl_err(e);
    }
}

/** Find the first text parameter of a MOGRT instance. */
function pl_mgtTextParam(comp) {
    var props = comp.properties;
    var i, p, fallback = null;
    for (i = 0; i < props.numItems; i++) {
        p = props[i];
        var dn = String(p.displayName || '');
        var v = null;
        try { v = p.getValue(); } catch (e) {}
        if (typeof v !== 'string') continue;
        if (/text/i.test(dn) || v.indexOf('textEditValue') >= 0) return p;
        if (!fallback) fallback = p;
    }
    return fallback;
}

function pl_setMgtText(p, text) {
    var v = p.getValue();
    if (typeof v === 'string' && v.indexOf('textEditValue') >= 0) {
        var nv = v.replace(/"textEditValue"\s*:\s*"(?:[^"\\]|\\.)*"/, '"textEditValue":' + pl_q(text));
        p.setValue(nv, true);
    } else {
        p.setValue(text, true);
    }
}

/**
 * One MOGRT instance per caption on the top free track. items: [{start, end, text}] (sequence seconds).
 * The template's own animation plays; the text stays editable in Essential Graphics.
 */
function popline_placeMogrt(mogrtPath, items) {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return pl_json({ ok: false, error: 'Open a sequence first.' });
        if (!new File(mogrtPath).exists) return pl_json({ ok: false, error: 'MOGRT not found: ' + mogrtPath });
        if (!items.length) return pl_json({ ok: false, error: 'No captions.' });
        var idx = pl_captionTrack(seq, items[0].start, items[items.length - 1].end);
        var placed = 0, textSet = 0;
        for (var i = 0; i < items.length; i++) {
            var it = items[i];
            var ticks = String(Math.round(it.start * 254016000000));
            var ti = seq.importMGT(mogrtPath, ticks, idx, 0);
            if (!ti) continue;
            placed++;
            try { ti.end = pl_time(it.end); } catch (e1) {}
            try {
                var comp = ti.getMGTComponent();
                var p = comp ? pl_mgtTextParam(comp) : null;
                if (p) { pl_setMgtText(p, it.text); textSet++; }
            } catch (e2) {}
        }
        return pl_json({ ok: true, placed: placed, textSet: textSet, track: seq.videoTracks[idx].name });
    } catch (e) {
        return pl_err(e);
    }
}
