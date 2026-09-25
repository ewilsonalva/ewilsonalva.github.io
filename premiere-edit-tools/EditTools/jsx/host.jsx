/*
 * Edit Tools - ExtendScript side.
 * Every tool is reachable through et_run(id, arg) and returns
 * "ok|<message>", "choose|<message>" or "error|<message>".
 */

var ET_TICKS = 254016000000;
var ET_EPS = 0.02;              // seconds; "touching" / "aligned" tolerance

// ---------------------------------------------------------------- helpers
function et_seq() {
    if (!app.project) throw "No project is open.";
    var s = app.project.activeSequence;
    if (!s) throw "Open a sequence in the Timeline first.";
    return s;
}
function et_qseq() {
    app.enableQE();
    return qe.project.getActiveSequence();
}
function et_frame(seq) {
    return parseFloat(seq.timebase) / ET_TICKS;
}
function et_now(seq) {
    return seq.getPlayerPosition().seconds;
}
function et_selection(seq) {
    var out = [], s = seq.getSelection();
    for (var i = 0; i < s.length; i++) if (s[i] && s[i].mediaType) out.push(s[i]);
    return out;
}
function et_isVideo(ti) { return ti.mediaType === "Video"; }

/* find which track a TrackItem lives on */
function et_locate(seq, ti) {
    var groups = [[seq.videoTracks, true], [seq.audioTracks, false]];
    for (var g = 0; g < 2; g++) {
        var tracks = groups[g][0];
        for (var t = 0; t < tracks.numTracks; t++) {
            var clips = tracks[t].clips;
            for (var c = 0; c < clips.numItems; c++) {
                if (clips[c].nodeId === ti.nodeId) return { video: groups[g][1], track: t };
            }
        }
    }
    return null;
}
function et_track(seq, loc) {
    return loc.video ? seq.videoTracks[loc.track] : seq.audioTracks[loc.track];
}
function et_qtrack(qs, loc) {
    return loc.video ? qs.getVideoTrackAt(loc.track) : qs.getAudioTrackAt(loc.track);
}
/* the QE twin of a TrackItem (QE tracks also list empty gaps) */
function et_qitem(seq, ti) {
    var loc = et_locate(seq, ti);
    if (!loc) return null;
    var qt = et_qtrack(et_qseq(), loc);
    for (var i = 0; i < qt.numItems; i++) {
        var q = qt.getItemAt(i);
        if (!q || q.type === "Empty") continue;
        if (Math.abs(q.start.secs - ti.start.seconds) < ET_EPS) return q;
    }
    return null;
}
function et_clipAt(track, t) {
    for (var i = 0; i < track.clips.numItems; i++) {
        var c = track.clips[i];
        if (c.start.seconds <= t + 1e-4 && c.end.seconds > t + 1e-4) return c;
    }
    return null;
}
function et_locked(track) {
    try { return track.isLocked(); } catch (e) { return false; }
}
/* selected clips, or every clip under the playhead on unlocked tracks */
function et_targets(seq, videoOnly) {
    var sel = et_selection(seq);
    if (sel.length) return videoOnly ? et_filter(sel, et_isVideo) : sel;
    var t = et_now(seq), out = [], i, c;
    for (i = 0; i < seq.videoTracks.numTracks; i++) {
        if (et_locked(seq.videoTracks[i])) continue;
        c = et_clipAt(seq.videoTracks[i], t);
        if (c) out.push(c);
    }
    if (!videoOnly) {
        for (i = 0; i < seq.audioTracks.numTracks; i++) {
            if (et_locked(seq.audioTracks[i])) continue;
            c = et_clipAt(seq.audioTracks[i], t);
            if (c) out.push(c);
        }
    }
    return out;
}
/* the top-most video clip that should be edited: selected, else under playhead */
function et_topVideo(seq) {
    var v = et_targets(seq, true);
    if (!v.length) throw "Select a video clip (or park the playhead over one).";
    // nothing selected: only the top-most layer under the playhead, not every layer
    if (!et_selection(seq).length) v = [v[v.length - 1]];
    return v;
}
function et_filter(a, fn) { var o = []; for (var i = 0; i < a.length; i++) if (fn(a[i])) o.push(a[i]); return o; }
function et_withLinked(items) {
    var out = [], seen = {};
    function add(x) { if (!seen[x.nodeId]) { seen[x.nodeId] = 1; out.push(x); } }
    for (var i = 0; i < items.length; i++) {
        add(items[i]);
        try {
            var l = items[i].getLinkedItems();
            for (var j = 0; j < l.numItems; j++) add(l[j]);
        } catch (e) {}
    }
    return out;
}
function et_deselectAll(seq) {
    var groups = [seq.videoTracks, seq.audioTracks];
    for (var g = 0; g < 2; g++)
        for (var t = 0; t < groups[g].numTracks; t++)
            for (var c = 0; c < groups[g][t].clips.numItems; c++)
                groups[g][t].clips[c].setSelected(false, true);
}
function et_component(ti, name) {
    for (var i = 0; i < ti.components.numItems; i++) {
        var c = ti.components[i];
        if (c.displayName === name) return c;
    }
    return null;
}
function et_param(comp, name) {
    if (!comp) return null;
    for (var i = 0; i < comp.properties.numItems; i++) {
        if (comp.properties[i].displayName === name) return comp.properties[i];
    }
    return null;
}
/* Position, Scale, Rotation and (when Premiere exposes it) Time Remapping > Speed */
function et_keyParams(ti) {
    var m = et_component(ti, "Motion"), out = [];
    var names = ["Position", "Scale", "Rotation"];
    for (var i = 0; i < names.length; i++) {
        var p = et_param(m, names[i]);
        if (p) out.push(p);
    }
    var sp = et_param(et_component(ti, "Time Remapping"), "Speed");
    if (sp) out.push(sp);
    return out;
}
function et_tc(seq, seconds) {
    // QE wants a timecode string; build HH:MM:SS:FF from the sequence frame rate
    var fps = Math.round(1 / et_frame(seq));
    var frames = Math.round(seconds * fps);
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return p(Math.floor(frames / (3600 * fps))) + ":" + p(Math.floor(frames / (60 * fps)) % 60) + ":" +
        p(Math.floor(frames / fps) % 60) + ":" + p(frames % fps);
}
function et_razorTracks(seq, locs) {
    var qs = et_qseq(), tc = qs.CTI.timecode, done = {};
    for (var i = 0; i < locs.length; i++) {
        var k = (locs[i].video ? "v" : "a") + locs[i].track;
        if (done[k]) continue;
        done[k] = 1;
        et_qtrack(qs, locs[i]).razor(tc);
    }
}
function et_locsOf(seq, items) {
    var locs = [];
    for (var i = 0; i < items.length; i++) {
        var l = et_locate(seq, items[i]);
        if (l && !et_locked(et_track(seq, l))) locs.push(l);
    }
    return locs;
}

// ---------------------------------------------------------------- tools
var ET = {};

/* Link: pair each selected video with the selected audio sitting exactly under it */
ET.link = function () {
    var seq = et_seq(), sel = et_selection(seq);
    var vids = et_filter(sel, et_isVideo), auds = et_filter(sel, function (x) { return !et_isVideo(x); });
    if (!vids.length || !auds.length) throw "Select the video and audio clips you want to link.";
    var groups = [], used = {};
    for (var i = 0; i < vids.length; i++) {
        var v = vids[i], same = [], aligned = [];
        for (var j = 0; j < auds.length; j++) {
            var a = auds[j];
            if (used[a.nodeId]) continue;
            if (Math.abs(a.start.seconds - v.start.seconds) < ET_EPS && Math.abs(a.end.seconds - v.end.seconds) < ET_EPS) {
                aligned.push(a);
                try { if (a.projectItem.nodeId === v.projectItem.nodeId) same.push(a); } catch (e) {}
            }
        }
        var pick = same.length ? same : aligned;
        if (!pick.length) continue;
        for (var k = 0; k < pick.length; k++) used[pick[k].nodeId] = 1;
        groups.push([v].concat(pick));
    }
    if (!groups.length) throw "No audio clip lines up exactly with a selected video clip.";
    et_deselectAll(seq);
    for (var g = 0; g < groups.length; g++) {
        for (var n = 0; n < groups[g].length; n++) groups[g][n].setSelected(true, true);
        seq.linkSelection();
        for (n = 0; n < groups[g].length; n++) groups[g][n].setSelected(false, true);
    }
    for (i = 0; i < sel.length; i++) sel[i].setSelected(true, true);
    return "Linked " + groups.length + " clip" + (groups.length > 1 ? "s" : "") + " to its audio";
};

ET.unlink = function () {
    var seq = et_seq(), sel = et_selection(seq);
    if (!sel.length) throw "Select the clip you want to unlink.";
    seq.unlinkSelection();
    return "Unlinked";
};

/* Speed keys: turn on Time Remapping > Speed with a key at each end of the clip */
ET.speedkeys = function () {
    var seq = et_seq(), clips = et_topVideo(seq), n = 0;
    for (var i = 0; i < clips.length; i++) {
        var p = et_param(et_component(clips[i], "Time Remapping"), "Speed");
        if (!p) continue;
        et_keyBoth(seq, clips[i], p);
        clips[i].setSelected(true, true);
        n++;
    }
    if (!n) throw "Premiere did not expose Time Remapping for this clip.";
    return "Speed keyframes added. Drag the band between them to ramp";
};

ET.reverse = function () {
    var seq = et_seq(), items = et_withLinked(et_targets(seq, false)), n = 0;
    if (!items.length) throw "Select a clip (or park the playhead over one).";
    for (var i = 0; i < items.length; i++) {
        var q = et_qitem(seq, items[i]);
        if (!q) continue;
        var speed = Math.abs(items[i].getSpeed()) || 1;
        var reversed = !!items[i].isSpeedReversed();
        // QE setSpeed(speed, timecode, reverse, rippleEdit, maintainAudioPitch)
        q.setSpeed(speed, "", !reversed, false, false);
        n++;
    }
    if (!n) throw "Could not reverse the clip.";
    return "Reversed video and audio";
};

ET.mirror = function () {
    var seq = et_seq(), clips = et_topVideo(seq), n = 0;
    et_qseq();
    var fx = qe.project.getVideoEffectByName("Horizontal Flip");
    if (!fx) throw "The Horizontal Flip effect was not found.";
    var removed = 0;
    for (var i = 0; i < clips.length; i++) {
        var q = et_qitem(seq, clips[i]);
        if (!q) continue;
        var had = false;
        for (var c = q.numComponents - 1; c >= 0; c--) {
            var comp = q.getComponentAt(c);
            if (comp && comp.name === "Horizontal Flip") {
                try { comp.remove(); had = true; removed++; } catch (e) {}
            }
        }
        if (!had) { q.addVideoEffect(fx); n++; }
    }
    return removed && !n ? "Mirror removed" : "Mirrored";
};

ET.rotate = function () {
    var seq = et_seq(), clips = et_topVideo(seq);
    for (var i = 0; i < clips.length; i++) {
        var p = et_param(et_component(clips[i], "Motion"), "Rotation");
        if (!p) continue;
        if (p.isTimeVarying()) throw "Rotation has keyframes. Use Clear Keys first.";
        var v = (p.getValue() + 90) % 360;
        p.setValue(v, true);
    }
    return "Rotated 90°";
};

ET.fill = function () {
    var seq = et_seq(), clips = et_topVideo(seq), done = 0;
    var sw = seq.frameSizeHorizontal, sh = seq.frameSizeVertical;
    for (var i = 0; i < clips.length; i++) {
        var dims = et_frameSize(clips[i].projectItem);
        if (!dims) continue;
        var cw = dims[0], ch = dims[1];
        var rot = et_param(et_component(clips[i], "Motion"), "Rotation");
        if (rot && !rot.isTimeVarying() && Math.round(Math.abs(rot.getValue())) % 180 === 90) { var t = cw; cw = ch; ch = t; }
        var scale = Math.max(sw / cw, sh / ch) * 100;
        var m = et_component(clips[i], "Motion");
        var sp = et_param(m, "Scale"), pos = et_param(m, "Position");
        if (sp.isTimeVarying()) throw "Scale has keyframes. Use Clear Keys first.";
        var uni = et_param(m, "Uniform Scale");
        try { if (uni && !uni.getValue()) uni.setValue(true, true); } catch (e) {}
        sp.setValue(Math.ceil(scale * 100) / 100, true);
        try { if (pos && !pos.isTimeVarying()) pos.setValue([0.5, 0.5], true); } catch (e) {}
        done++;
    }
    if (!done) throw "Could not read the clip's frame size.";
    return "Scaled to fill " + sw + "×" + sh;
};
function et_frameSize(item) {
    try {
        var md = item.getProjectMetadata();
        var m = /VideoInfo>\s*(\d+)\s*x\s*(\d+)/.exec(md);
        if (m) return [parseInt(m[1], 10), parseInt(m[2], 10)];
    } catch (e) {}
    try {
        var fi = item.getFootageInterpretation();
        if (fi && fi.frameWidth) return [fi.frameWidth, fi.frameHeight];
    } catch (e2) {}
    return null;
}

/* keys at the first and last frame of the clip, holding the current value */
function et_keyBoth(seq, ti, p) {
    var a = ti.inPoint.seconds, b = ti.outPoint.seconds - et_frame(seq);
    var v = p.isTimeVarying() ? p.getValueAtTime(a) : p.getValue();
    var vb = p.isTimeVarying() ? p.getValueAtTime(b) : v;
    if (!p.isTimeVarying()) p.setTimeVarying(true);
    p.addKey(a);
    p.addKey(b);
    p.setValueAtKey(a, v, true);
    p.setValueAtKey(b, vb, true);
}
ET.fullkey = function () {
    var seq = et_seq(), clips = et_topVideo(seq), n = 0;
    for (var i = 0; i < clips.length; i++) {
        var ps = et_keyParams(clips[i]);
        for (var j = 0; j < ps.length; j++) {
            try { et_keyBoth(seq, clips[i], ps[j]); n++; } catch (e) {}
        }
    }
    if (!n) throw "Could not add keyframes to this clip.";
    return "Keyframes added at start and end (" + n + " properties)";
};

ET.clearkeys = function () {
    var seq = et_seq(), clips = et_topVideo(seq), n = 0;
    for (var i = 0; i < clips.length; i++) {
        var ps = et_keyParams(clips[i]);
        for (var j = 0; j < ps.length; j++) {
            try { if (ps[j].isTimeVarying()) { ps[j].setTimeVarying(false); n++; } } catch (e) {}
        }
    }
    return n ? "Cleared keyframes on " + n + " properties" : "No keyframes to clear";
};

/* Quick transition: arg = transition name (the panel remembers the last one used) */
ET.transition = function (name) {
    if (name) et_setPref("lastTransition", name);
    else name = et_getPref("lastTransition", "Cross Dissolve");
    var seq = et_seq(), qs = et_qseq();
    var fx = qe.project.getVideoTransitionByName(name);
    if (!fx) throw "Transition \"" + name + "\" not found.";
    var dur = et_tc(seq, 0.5);
    var sel = et_filter(et_selection(seq), et_isVideo), n = 0, i, q;
    if (sel.length) {
        for (i = 0; i < sel.length; i++) {
            q = et_qitem(seq, sel[i]);
            if (!q) continue;
            q.addTransition(fx, false, dur, "00:00:00:00", 0.5, false, true);
            n++;
        }
    } else {
        // no selection: nearest edit point to the playhead on the top-most clip
        var t = et_now(seq);
        for (i = seq.videoTracks.numTracks - 1; i >= 0 && !n; i--) {
            var c = et_clipAt(seq.videoTracks[i], t);
            if (!c) continue;
            q = et_qitem(seq, c);
            var atStart = (t - c.start.seconds) < (c.end.seconds - t);
            q.addTransition(fx, atStart, dur, "00:00:00:00", 0.5, false, true);
            n++;
        }
    }
    if (!n) throw "Select a clip, or park the playhead near a cut.";
    return name + " added";
};

/* Crossfade: two touching audio clips -> crossfade; one clip -> fade in / out / both */
ET.crossfade = function (mode) {
    var seq = et_seq(), qs = et_qseq();
    var auds = et_filter(et_selection(seq), function (x) { return !et_isVideo(x); });
    if (!auds.length) throw "Select one audio clip, or two touching audio clips.";
    var fx = qe.project.getAudioTransitionByName("Constant Power");
    if (!fx) throw "The Constant Power transition was not found.";
    var dur = et_tc(seq, 0.5), n = 0;
    auds.sort(function (a, b) { return a.start.seconds - b.start.seconds; });
    if (auds.length >= 2) {
        for (var i = 0; i < auds.length - 1; i++) {
            for (var j = i + 1; j < auds.length; j++) {
                if (Math.abs(auds[i].end.seconds - auds[j].start.seconds) < ET_EPS) {
                    et_qitem(seq, auds[i]).addTransition(fx, false, dur, "00:00:00:00", 0.5, false, true);
                    n++;
                }
            }
        }
        if (!n) throw "The selected audio clips don't touch.";
        return "Crossfade added";
    }
    if (!mode || mode === "auto") return "choose|Fade in, fade out or both?";
    var q = et_qitem(seq, auds[0]);
    if (mode === "in" || mode === "both") q.addTransition(fx, true, dur, "00:00:00:00", 0, true, true);
    if (mode === "out" || mode === "both") q.addTransition(fx, false, dur, "00:00:00:00", 1, true, true);
    return mode === "both" ? "Fade in and out added" : "Fade " + mode + " added";
};

/* Split / delete left / delete right at the playhead (CapCut style) */
function et_cutTargets(seq) {
    var items = et_withLinked(et_targets(seq, false));
    if (!items.length) throw "Park the playhead over a clip.";
    var t = et_now(seq);
    items = et_filter(items, function (c) { return c.start.seconds < t - 1e-4 && c.end.seconds > t + 1e-4; });
    if (!items.length) throw "The playhead is on a cut, nothing to split.";
    return et_locsOf(seq, items);
}
ET.split = function () {
    var seq = et_seq(), locs = et_cutTargets(seq);
    et_razorTracks(seq, locs);
    return "Split";
};
function et_deleteSide(left) {
    var seq = et_seq(), t = et_now(seq), locs = et_cutTargets(seq);
    et_razorTracks(seq, locs);
    var n = 0, land = t;
    for (var i = 0; i < locs.length; i++) {
        var tr = et_track(seq, locs[i]);
        for (var c = 0; c < tr.clips.numItems; c++) {
            var ci = tr.clips[c];
            var hit = left ? Math.abs(ci.end.seconds - t) < ET_EPS : Math.abs(ci.start.seconds - t) < ET_EPS;
            if (hit) {
                if (left) land = Math.min(land, ci.start.seconds);
                ci.remove(true, true);
                n++;
                break;
            }
        }
    }
    if (!n) throw "Nothing to delete at the playhead.";
    // after a ripple delete on the left, the rest of the clip starts where the removed part began
    if (left) seq.setPlayerPosition(String(Math.round(land * ET_TICKS)));
    return left ? "Deleted left of playhead" : "Deleted right of playhead";
}
ET.delleft = function () { return et_deleteSide(true); };
ET.delright = function () { return et_deleteSide(false); };

ET.freeze = function () {
    var seq = et_seq(), clips = et_topVideo(seq), t = et_now(seq), hold = 3;
    var v = clips[0], loc = et_locate(seq, v);
    if (!(v.start.seconds < t && v.end.seconds > t)) throw "Park the playhead inside the clip you want to freeze.";
    var qs = et_qseq();

    // 1. grab the frame under the playhead as a still
    var dir = new Folder((app.project.path ? new File(app.project.path).parent.fsName : Folder.temp.fsName) + "/Edit Tools Frames");
    if (!dir.exists) dir.create();
    var base = dir.fsName + "/freeze_" + new Date().getTime();
    qs.exportFramePNG(qs.CTI.timecode, base);
    var png = new File(base + ".png");
    if (!png.exists) png = new File(base);
    for (var w = 0; w < 40 && !png.exists; w++) { $.sleep(100); png = new File(base + ".png"); }
    if (!png.exists) throw "Could not export the freeze frame.";

    var bin = null, root = app.project.rootItem;
    for (var b = 0; b < root.children.numItems; b++)
        if (root.children[b].type === ProjectItemType.BIN && root.children[b].name === "Edit Tools Frames") bin = root.children[b];
    if (!bin) bin = root.createBin("Edit Tools Frames");
    app.project.importFiles([png.fsName], true, bin, false);
    var still = bin.children[bin.children.numItems - 1];
    try { still.setOutPoint(hold, 4); } catch (e) {}

    // 2. split every unlocked track at the playhead and push everything after it right
    var all = [], g, tr, c;
    var groups = [seq.videoTracks, seq.audioTracks];
    for (g = 0; g < 2; g++)
        for (tr = 0; tr < groups[g].numTracks; tr++)
            if (!et_locked(groups[g][tr])) all.push({ video: g === 0, track: tr });
    et_razorTracks(seq, all);
    var later = [];
    for (g = 0; g < 2; g++)
        for (tr = 0; tr < groups[g].numTracks; tr++) {
            if (et_locked(groups[g][tr])) continue;
            for (c = 0; c < groups[g][tr].clips.numItems; c++)
                if (groups[g][tr].clips[c].start.seconds >= t - 1e-4) later.push(groups[g][tr].clips[c]);
        }
    later.sort(function (a, b) { return b.start.seconds - a.start.seconds; });
    var shift = new Time();
    shift.seconds = hold;
    for (c = 0; c < later.length; c++) later[c].move(shift);

    // 3. drop the still into the gap
    et_track(seq, loc).overwriteClip(still, t);
    return "Freeze frame added (" + hold + "s)";
};

// ---------------------------------------------------------------- prefs
/* a small settings file so the panel and the shortcut commands share state */
function et_prefFile() {
    var dir = new Folder(Folder.userData.fsName + "/EditTools");
    if (!dir.exists) dir.create();
    return new File(dir.fsName + "/prefs.txt");
}
function et_getPref(key, fallback) {
    var f = et_prefFile();
    if (!f.exists) return fallback;
    f.open("r");
    var lines = f.read().split("\n");
    f.close();
    for (var i = 0; i < lines.length; i++) {
        var eq = lines[i].indexOf("=");
        if (eq > 0 && lines[i].substring(0, eq) === key) return lines[i].substring(eq + 1);
    }
    return fallback;
}
function et_setPref(key, value) {
    var f = et_prefFile(), out = [], lines = [];
    if (f.exists) { f.open("r"); lines = f.read().split("\n"); f.close(); }
    for (var i = 0; i < lines.length; i++)
        if (lines[i] && lines[i].indexOf(key + "=") !== 0) out.push(lines[i]);
    out.push(key + "=" + value);
    f.open("w");
    f.write(out.join("\n"));
    f.close();
    return "ok|";
}

// ---------------------------------------------------------------- entry
function et_run(id, arg) {
    try {
        if (!ET[id]) return "error|Unknown tool " + id;
        var r = ET[id](arg);
        return r.indexOf("choose|") === 0 ? r : "ok|" + r;
    } catch (e) {
        return "error|" + (e && e.message ? e.message : e);
    }
}
