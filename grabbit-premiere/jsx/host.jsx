/*
 * Grabbit host script (ExtendScript, runs inside Premiere Pro).
 * ES3: no JSON object guaranteed, no Array.prototype.indexOf, etc.
 * Every public function returns a JSON string: {"ok":true,...} or {"ok":false,"error":"..."}
 */

function grabbit_q(s) {
    s = String(s);
    return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t') + '"';
}

function grabbit_result(fields) {
    var parts = [];
    for (var k in fields) {
        if (!fields.hasOwnProperty(k)) continue;
        var v = fields[k];
        var out;
        if (v === null || v === undefined) out = 'null';
        else if (typeof v === 'boolean' || typeof v === 'number') out = String(v);
        else out = grabbit_q(v);
        parts.push(grabbit_q(k) + ':' + out);
    }
    return '{' + parts.join(',') + '}';
}

function grabbit_ping() {
    return grabbit_result({ ok: true, version: app.version });
}

/** Where the project lives, so downloads can sit next to it. */
function grabbit_projectInfo() {
    try {
        var p = app.project ? app.project.path : '';
        var seq = app.project ? app.project.activeSequence : null;
        return grabbit_result({
            ok: true,
            projectPath: p || '',
            projectName: app.project ? app.project.name : '',
            sequenceName: seq ? seq.name : ''
        });
    } catch (e) {
        return grabbit_result({ ok: false, error: e.toString() });
    }
}

function grabbit_findOrCreateBin(name) {
    var root = app.project.rootItem;
    for (var i = 0; i < root.children.numItems; i++) {
        var c = root.children[i];
        if (c && c.type === ProjectItemType.BIN && c.name === name) return c;
    }
    return root.createBin(name);
}

function grabbit_normPath(p) {
    return String(p).replace(/\\/g, '/').toLowerCase();
}

function grabbit_findByMediaPath(bin, mediaPath) {
    var want = grabbit_normPath(mediaPath);
    for (var i = bin.children.numItems - 1; i >= 0; i--) {
        var c = bin.children[i];
        if (!c || c.type !== ProjectItemType.CLIP) continue;
        try {
            if (grabbit_normPath(c.getMediaPath()) === want) return c;
        } catch (e) {}
    }
    return null;
}

/** End time (seconds) of the last clip on any video or audio track. */
function grabbit_sequenceEnd(seq) {
    var end = 0;
    var groups = [seq.videoTracks, seq.audioTracks];
    for (var g = 0; g < groups.length; g++) {
        for (var t = 0; t < groups[g].numTracks; t++) {
            var clips = groups[g][t].clips;
            for (var c = 0; c < clips.numItems; c++) {
                var s = clips[c].end.seconds;
                if (s > end) end = s;
            }
        }
    }
    return end;
}

/** First targeted, unlocked video track; else first unlocked one; else V1. */
function grabbit_pickVideoTrack(seq) {
    var i, tr;
    for (i = 0; i < seq.videoTracks.numTracks; i++) {
        tr = seq.videoTracks[i];
        try { if (tr.isTargeted() && !tr.isLocked()) return tr; } catch (e) {}
    }
    for (i = 0; i < seq.videoTracks.numTracks; i++) {
        tr = seq.videoTracks[i];
        try { if (!tr.isLocked()) return tr; } catch (e) {}
    }
    return seq.videoTracks[0];
}

/** True if any clip on the track overlaps [from, to). */
function grabbit_trackBusy(track, from, to) {
    var clips = track.clips;
    for (var c = 0; c < clips.numItems; c++) {
        if (clips[c].start.seconds < to && clips[c].end.seconds > from) return true;
    }
    return false;
}

/** Lowest unlocked video track above `base` with room at [from, to); else the top track. */
function grabbit_pickFreeTrackAbove(seq, base, from, to) {
    var baseIdx = 0, i;
    for (i = 0; i < seq.videoTracks.numTracks; i++) {
        if (seq.videoTracks[i] === base || seq.videoTracks[i].name === base.name) { baseIdx = i; break; }
    }
    for (i = baseIdx + 1; i < seq.videoTracks.numTracks; i++) {
        var tr = seq.videoTracks[i];
        var locked = false;
        try { locked = tr.isLocked(); } catch (e) {}
        if (!locked && !grabbit_trackBusy(tr, from, to)) return tr;
    }
    return seq.videoTracks[seq.videoTracks.numTracks - 1];
}

/**
 * Import a file into the project (in the given bin) and place it.
 * mode: "insert" (ripple at playhead), "overwrite" (at playhead), "append" (end of sequence), "project" (bin only)
 * atSeconds: optional explicit time instead of the playhead (used to lay several files back to back).
 * still: true for images; they go on the first free track above the target track (overwrite) so
 *        nothing underneath is cut or rippled.
 */
function grabbit_importAndPlace(filePath, mode, binName, atSeconds, still) {
    try {
        if (!app.project) return grabbit_result({ ok: false, error: 'No project open.' });
        var f = new File(filePath);
        if (!f.exists) return grabbit_result({ ok: false, error: 'File not found: ' + filePath });

        var bin = grabbit_findOrCreateBin(binName || 'Grabbit');
        var item = grabbit_findByMediaPath(bin, f.fsName);
        if (!item) {
            var imported = app.project.importFiles([f.fsName], true, bin, false);
            if (!imported) return grabbit_result({ ok: false, error: 'Premiere refused to import the file.' });
            item = grabbit_findByMediaPath(bin, f.fsName);
        }
        if (!item) return grabbit_result({ ok: false, error: 'Imported, but could not find the clip in the "' + bin.name + '" bin.' });

        if (mode === 'project') {
            return grabbit_result({ ok: true, placed: 'project', clip: item.name, bin: bin.name });
        }

        var seq = app.project.activeSequence;
        if (!seq) {
            // No sequence open: make one that matches the clip, which also places it.
            seq = app.project.createNewSequenceFromClips(item.name, [item], bin);
            if (seq) app.project.openSequence(seq.sequenceID);
            return grabbit_result({ ok: true, placed: 'new-sequence', clip: item.name, sequence: seq ? seq.name : '', end: null });
        }

        var at;
        if (atSeconds !== null && atSeconds !== undefined && atSeconds !== '') at = Number(atSeconds);
        else if (mode === 'append') at = grabbit_sequenceEnd(seq);
        else at = seq.getPlayerPosition().seconds;

        var track = grabbit_pickVideoTrack(seq);
        var t = new Time();
        t.seconds = at;
        var placed = mode;
        if (still && mode !== 'append') {
            track = grabbit_pickFreeTrackAbove(seq, track, at, at + 5);
            track.overwriteClip(item, t);
            placed = 'still';
        } else if (mode === 'overwrite' || mode === 'append') {
            track.overwriteClip(item, t); // nothing after the end, so overwrite == append
        } else {
            track.insertClip(item, t);
        }

        // Report where the new clip ends so the caller can place the next one after it.
        var end = null;
        for (var c = track.clips.numItems - 1; c >= 0; c--) {
            var clip = track.clips[c];
            if (Math.abs(clip.start.seconds - at) < 0.01) { end = clip.end.seconds; break; }
        }

        return grabbit_result({ ok: true, placed: placed, clip: item.name, sequence: seq.name, at: at, end: end, track: track.name });
    } catch (e) {
        return grabbit_result({ ok: false, error: e.toString() + (e.line ? ' (host.jsx line ' + e.line + ')' : '') });
    }
}

/**
 * Export the frame under the playhead of the active sequence as a PNG (at sequence resolution).
 * Uses the QE DOM; Premiere writes the file asynchronously, so the panel waits for it to appear.
 * Returns the base path; Premiere may or may not append ".png" depending on version.
 */
function grabbit_exportFrame(basePath) {
    try {
        var seq = app.project ? app.project.activeSequence : null;
        if (!seq) return grabbit_result({ ok: false, error: 'Open a sequence first.' });
        app.enableQE();
        var qeSeq = qe.project.getActiveSequence();
        if (!qeSeq) return grabbit_result({ ok: false, error: 'Could not reach the sequence through QE.' });
        var pos = seq.getPlayerPosition();
        var tc = seq.CTI.timecode;
        var folder = new Folder(new File(basePath).path);
        if (!folder.exists) folder.create();
        qeSeq.exportFramePNG(tc, basePath);
        return grabbit_result({ ok: true, sequence: seq.name, timecode: tc, seconds: pos.seconds, width: seq.frameSizeHorizontal, height: seq.frameSizeVertical });
    } catch (e) {
        return grabbit_result({ ok: false, error: e.toString() + (e.line ? ' (host.jsx line ' + e.line + ')' : '') });
    }
}
