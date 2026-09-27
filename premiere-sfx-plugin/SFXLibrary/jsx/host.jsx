/*
 * SFX Library - ExtendScript side.
 * Imports a sound into a "SFX Library" bin (once) and drops it on the
 * active sequence at the playhead, on the first audio track that is free.
 */

var SFX_BIN_NAME = "SFX Library";

function sfx_norm(p) {
    return String(p).replace(/\\/g, "/").toLowerCase();
}

function sfx_findBin(parent, name) {
    for (var i = 0; i < parent.children.numItems; i++) {
        var c = parent.children[i];
        if (c && c.type === ProjectItemType.BIN && c.name === name) return c;
    }
    return parent.createBin(name);
}

function sfx_findItem(parent, wanted) {
    for (var i = 0; i < parent.children.numItems; i++) {
        var c = parent.children[i];
        if (!c) continue;
        if (c.type === ProjectItemType.BIN) {
            var hit = sfx_findItem(c, wanted);
            if (hit) return hit;
        } else if (c.type === ProjectItemType.CLIP || c.type === ProjectItemType.FILE) {
            var mp = "";
            try { mp = c.getMediaPath(); } catch (e) {}
            if (mp && sfx_norm(mp) === wanted) return c;
        }
    }
    return null;
}

function sfx_trackIsFree(track, start, end) {
    try { if (track.isLocked()) return false; } catch (e) {}
    var clips = track.clips;
    for (var i = 0; i < clips.numItems; i++) {
        var c = clips[i];
        if (c.start.seconds < end - 0.0005 && c.end.seconds > start + 0.0005) return false;
    }
    return true;
}

function sfx_addAudioTrack(seq) {
    try {
        app.enableQE();
        var qs = qe.project.getActiveSequence();
        // (video tracks, after video idx, audio tracks, audio type 1 = stereo, after audio idx, submix tracks, submix type)
        qs.addTracks(0, 0, 1, 1, seq.audioTracks.numTracks, 0, 0);
    } catch (e) {
        return null;
    }
    seq = app.project.activeSequence;
    return seq.audioTracks[seq.audioTracks.numTracks - 1];
}

function sfx_pickTrack(seq, start, end, preferred) {
    var tracks = seq.audioTracks;
    if (preferred > 0 && preferred <= tracks.numTracks) {
        return tracks[preferred - 1];
    }
    for (var i = 0; i < tracks.numTracks; i++) {
        if (sfx_trackIsFree(tracks[i], start, end)) return tracks[i];
    }
    return sfx_addAudioTrack(seq);
}

/* Returns "ok|<track name>|<timecode seconds>" or "error|<message>". */
function sfx_apply(path, duration, preferredTrack, movePlayhead) {
    try {
        if (!app.project) return "error|No project is open.";
        var seq = app.project.activeSequence;
        if (!seq) return "error|Open a sequence in the Timeline first.";

        var file = new File(path);
        if (!file.exists) return "error|Sound file not found: " + path;
        var wanted = sfx_norm(file.fsName);

        var bin = sfx_findBin(app.project.rootItem, SFX_BIN_NAME);
        var item = sfx_findItem(bin, wanted);
        if (!item) {
            app.project.importFiles([file.fsName], true, bin, false);
            item = sfx_findItem(bin, wanted);
        }
        if (!item) return "error|Premiere could not import " + file.name;

        var start = seq.getPlayerPosition().seconds;
        var dur = parseFloat(duration) || 1;
        var track = sfx_pickTrack(seq, start, start + dur, parseInt(preferredTrack, 10) || 0);
        if (!track) return "error|No free audio track and a new one could not be added.";

        track.overwriteClip(item, start);

        if (movePlayhead === "true" || movePlayhead === true) {
            var t = new Time();
            t.seconds = start + dur;
            seq.setPlayerPosition(t.ticks);
        }
        return "ok|" + track.name + "|" + start;
    } catch (err) {
        return "error|" + err.toString();
    }
}

function sfx_ping() {
    return app.project && app.project.activeSequence ? "ok|" + app.project.activeSequence.name : "ok|";
}

/* ---------- your own sounds ----------
 * Added sounds are copied into a personal folder (Documents-level app data,
 * outside the plugin) so reinstalling or updating the plugin never loses them.
 *   Windows: %APPDATA%\SFXLibrary     Mac: ~/Library/Application Support/SFXLibrary
 */
function sfx_userDir() {
    var d = new Folder(Folder.userData.fsName + "/SFXLibrary");
    if (!d.exists) d.create();
    return d;
}

function sfx_isAudio(f) {
    return f instanceof Folder || /\.(mp3|wav|aif|aiff|m4a|aac|ogg|flac)$/i.test(f.name);
}

/* file picker; returns one absolute path per line */
function sfx_pickFiles() {
    var filter = $.os.indexOf("Windows") >= 0
        ? "Audio files:*.mp3;*.wav;*.aif;*.aiff;*.m4a;*.aac;*.ogg;*.flac,All files:*.*"
        : sfx_isAudio;
    var picked = File.openDialog("Choose sound effects to add", filter, true);
    if (!picked) return "";
    if (!(picked instanceof Array)) picked = [picked];
    var out = [];
    for (var i = 0; i < picked.length; i++) out.push(picked[i].fsName);
    return out.join("\n");
}

function sfx_safeName(s) {
    return String(s).replace(/[\\\/:*?"<>|]+/g, " ").replace(/^\s+|\s+$/g, "") || "Sound";
}

/* copy one file into <userDir>/sounds/<folder>/<name>.<ext>; returns "ok|<new path>" */
function sfx_importSound(srcPath, folder, name) {
    try {
        var src = new File(srcPath);
        if (!src.exists) return "error|File not found: " + srcPath;
        var ext = (/\.[^.]+$/.exec(src.name) || [".mp3"])[0].toLowerCase();
        var dir = new Folder(sfx_userDir().fsName + "/sounds/" + sfx_safeName(folder));
        if (!dir.exists) dir.create();
        var base = sfx_safeName(name), dest = new File(dir.fsName + "/" + base + ext), n = 2;
        while (dest.exists) dest = new File(dir.fsName + "/" + base + " " + (n++) + ext);
        if (!src.copy(dest.fsName)) return "error|Could not copy " + src.name;
        return "ok|" + dest.fsName;
    } catch (e) {
        return "error|" + e.toString();
    }
}

function sfx_deleteFile(path) {
    var f = new File(path);
    if (f.exists) f.remove();
    return "ok|";
}

/* the list of added sounds is stored as JSON text written by the panel */
function sfx_readUserLib() {
    var f = new File(sfx_userDir().fsName + "/library.json");
    if (!f.exists) return "";
    f.encoding = "UTF-8";
    f.open("r");
    var s = f.read();
    f.close();
    return s;
}

function sfx_writeUserLib(text) {
    var f = new File(sfx_userDir().fsName + "/library.json");
    f.encoding = "UTF-8";
    f.open("w");
    f.write(text);
    f.close();
    return "ok|";
}
