/*
 * Seamless Wipes - ExtendScript side.
 *
 * Rebuilds the "adjustment layer method" panoramic transition (the DILEN Classic
 * Panoramic presets) at the cut nearest the playhead, in one call:
 *
 *   Transform    picture at 50%, placed in the top-left quarter
 *   Mirror  x2   mirror it right and down -> a 2x2 tile whose edges always match
 *   Offset       slide the tile 3-4 frame widths, easing in and out   (keyed)
 *   Crop         keep the top-left quarter with Zoom on -> full frame again
 *   Gaussian Blur  blur that peaks at the cut to hide the switch      (keyed)
 *
 * At the start and end of the move the Offset is a whole number of tiles, so the
 * picture is exactly the untouched frame: the wipe enters and leaves seamlessly.
 *
 * Where it goes:
 *   - project has an Adjustment Layer -> placed on a free track above the cut,
 *     trimmed to the transition, effects on the layer (the tutorial's method);
 *   - otherwise -> the transition part of each clip is split off and the effects go
 *     on those two short pieces (end of the first clip, start of the second).
 *
 * Every function returns "ok|<message>" or "error|<message>".
 */

var SW_TICKS = 254016000000;
var SW_DURATIONS = { fast: 0.6, medium: 1.0, slow: 1.6 };          // whole transition, seconds
var SW_DIRS = {                                                     // Offset travel in frame widths / heights
    right: [3, 0], left: [-3, 0], down: [0, 4], up: [0, -4],
    upright: [3, -4], downright: [3, 4], upleft: [-3, -4], downleft: [-3, 4]
};
var SW_NAMES = {
    right: "Right", left: "Left", down: "Down", up: "Up",
    upright: "Up + Right", downright: "Down + Right", upleft: "Up + Left", downleft: "Down + Left"
};
var SW_BLUR = 120;                                                  // Gaussian Blur peak at the cut
var SW_TAG = "SW ";                                                 // prefix on everything we create

// ------------------------------------------------------------------ basics
function sw_seq() {
    if (!app.project) throw "No project is open.";
    var s = app.project.activeSequence;
    if (!s) throw "Open a sequence in the Timeline first.";
    return s;
}
function sw_frame(seq) { return parseFloat(seq.timebase) / SW_TICKS; }
function sw_ticksTime(sec) { var t = new Time(); t.ticks = String(Math.round(sec * SW_TICKS)); return t; }
function sw_locked(track) { try { return track.isLocked(); } catch (e) { return false; } }
function sw_lc(x) { return String(x || "").toLowerCase(); }
function sw_err(e) { return (e && e.message ? e.message : String(e)); }
function sw_step(label, fn) {
    try { return fn(); } catch (e) { throw label + ": " + sw_err(e); }
}
function sw_near(a, b, eps) { return Math.abs(a - b) < (eps || 0.01); }

function sw_clipAt(track, start) {
    for (var i = 0; i < track.clips.numItems; i++)
        if (sw_near(track.clips[i].start.seconds, start)) return track.clips[i];
    return null;
}
function sw_fresh() { return app.project.activeSequence; }

/* the cut nearest the playhead on the top-most unlocked video track (a selected clip wins) */
function sw_findCut(seq) {
    var t = seq.getPlayerPosition().seconds, f = sw_frame(seq), reach = 3;
    var sel = seq.getSelection(), selIds = {};
    for (var s = 0; s < sel.length; s++) if (sel[s] && sel[s].mediaType === "Video") selIds[sel[s].nodeId] = 1;
    for (var i = seq.videoTracks.numTracks - 1; i >= 0; i--) {
        var tr = seq.videoTracks[i];
        if (sw_locked(tr)) continue;
        var clips = tr.clips, best = null;
        for (var c = 0; c < clips.numItems - 1; c++) {
            var a = clips[c], b = clips[c + 1];
            if (Math.abs(a.end.seconds - b.start.seconds) > f / 2) continue;           // not touching
            if (sw_isOurs(a) || sw_isOurs(b)) continue;                                // a wipe already sits here
            var d = Math.abs(a.end.seconds - t);
            if (selIds[a.nodeId] || selIds[b.nodeId]) d -= 1000;
            if (d <= reach && (!best || d < best.d)) best = { a: a, b: b, d: d, track: i, cut: a.end.seconds };
        }
        if (best) return best;
    }
    throw "Park the playhead near a cut between two touching video clips.";
}
function sw_isOurs(item) { return String(item.name).indexOf(SW_TAG) === 0; }

/* QE razor at an exact time on one track (moves the playhead there, then restores it) */
function sw_razor(isVideo, trackIndex, sec) {
    var seq = sw_fresh(), keep = seq.getPlayerPosition().ticks;
    seq.setPlayerPosition(String(Math.round(sec * SW_TICKS)));
    app.enableQE();
    var qs = qe.project.getActiveSequence();
    var qt = isVideo ? qs.getVideoTrackAt(trackIndex) : qs.getAudioTrackAt(trackIndex);
    qt.razor(qs.CTI.timecode);
    seq.setPlayerPosition(keep);
}
function sw_qeItem(trackIndex, start) {
    app.enableQE();
    var qt = qe.project.getActiveSequence().getVideoTrackAt(trackIndex);
    for (var i = 0; i < qt.numItems; i++) {
        var q = qt.getItemAt(i);
        if (q && q.type !== "Empty" && sw_near(q.start.secs, start)) return q;
    }
    throw "Could not reach the clip at " + start.toFixed(2) + "s.";
}

// ------------------------------------------------------------------ adjustment layer
function sw_findAdjustmentLayer(bin) {
    for (var i = 0; i < bin.children.numItems; i++) {
        var it = bin.children[i];
        if (!it) continue;
        if (it.type === ProjectItemType.BIN) {
            var hit = sw_findAdjustmentLayer(it);
            if (hit) return hit;
        } else if (it.type === ProjectItemType.CLIP) {
            if (/adjustment\s*layer/i.test(it.name)) return it;          // Premiere's default name
        }
    }
    return null;
}
function sw_trackFree(track, a, b) {
    for (var c = 0; c < track.clips.numItems; c++) {
        var ci = track.clips[c];
        if (ci.start.seconds < b - 1e-4 && ci.end.seconds > a + 1e-4) return false;
    }
    return !sw_locked(track);
}
function sw_trackAbove(seq, below, a, b) {
    for (var i = below + 1; i < seq.videoTracks.numTracks; i++)
        if (sw_trackFree(seq.videoTracks[i], a, b)) return i;
    try {
        app.enableQE();
        qe.project.getActiveSequence().addTracks(1, seq.videoTracks.numTracks, 0, 1, 0, 0, 0);
    } catch (e) {
        throw "No free video track above the cut, and a new one could not be added.";
    }
    return sw_fresh().videoTracks.numTracks - 1;
}
/* lay the adjustment layer over [a, b] and return its track index */
function sw_placeLayer(seq, layer, cut, a, b) {
    var ti = sw_trackAbove(seq, cut.track, a, b);
    sw_step("Placing the adjustment layer", function () { sw_fresh().videoTracks[ti].overwriteClip(layer, a); });
    var tr = sw_fresh().videoTracks[ti], item = sw_clipAt(tr, a);
    if (!item) throw "The adjustment layer did not land on the timeline.";
    if (item.end.seconds > b + 1e-3) {                           // longer than the wipe: cut off the tail
        sw_razor(true, ti, b);
        var tail = sw_clipAt(sw_fresh().videoTracks[ti], b);
        if (tail) tail.remove(false, true);
    }
    return ti;
}

// ------------------------------------------------------------------ effects
function sw_prop(comp, fragments, index) {
    if (!comp) return null;
    var props = comp.properties;
    for (var i = 0; i < props.numItems; i++) {
        var n = sw_lc(props[i].displayName);
        for (var k = 0; k < fragments.length; k++) if (n.indexOf(fragments[k]) >= 0) return props[i];
    }
    return index !== null && index < props.numItems ? props[index] : null;
}
function sw_set(p, v) { if (p) { try { p.setValue(v, true); } catch (e) {} } }

/* key helpers: add every key, then write values through the keys Premiere stored */
function sw_keySec(k) { return typeof k === "number" ? k : k.seconds; }
function sw_addKey(p, sec) { try { p.addKey(sw_ticksTime(sec)); return; } catch (e) {} p.addKey(sec); }
function sw_keyAt(p, sec) {
    var keys = p.getKeys(), best = null, bd = 1e9;
    for (var i = 0; keys && i < keys.length; i++) {
        var d = Math.abs(sw_keySec(keys[i]) - sec);
        if (d < bd) { bd = d; best = keys[i]; }
    }
    return best;
}
function sw_setKey(p, sec, v) {
    var k = sw_keyAt(p, sec);
    if (k === null) throw "no keyframe at " + sec.toFixed(3) + "s";
    try { p.setValueAtKey(k, v, true); } catch (e) { p.setValueAtKey(sw_keySec(k), v, true); }
    try { p.setInterpolationTypeAtKey(k, 0, true); } catch (e2) {}          // linear: the curve is in the keys
}
function sw_trimKeys(p, a, b, f) {
    try {
        var keys = p.getKeys();
        for (var i = 0; keys && i < keys.length; i++) {
            var s = sw_keySec(keys[i]);
            if (s < a - f / 2 || s > b + f / 2) p.removeKey(keys[i]);
        }
    } catch (e) {}
}

/* ease in-out (cubic) and its normalised speed, peaking at 1 in the middle */
function sw_ease(u) { return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; }
function sw_speed(u) { return (u < 0.5 ? 12 * u * u : 12 * (1 - u) * (1 - u)) / 3; }

/*
 * Build the stack on one track item and key the part of the move that falls on it.
 * [fullA, fullB): the whole transition in sequence time; the item covers part or all of it.
 */
function sw_buildStack(trackIndex, itemStart, dirKey, fullA, fullB) {
    var seq = sw_fresh(), f = sw_frame(seq), dir = SW_DIRS[dirKey];
    var q = sw_qeItem(trackIndex, itemStart);
    var names = ["Transform", "Mirror", "Mirror", "Offset", "Crop", "Gaussian Blur"];
    var fx = [];
    for (var n = 0; n < names.length; n++) {
        var e = qe.project.getVideoEffectByName(names[n]);
        if (!e) throw "Premiere's " + names[n] + " effect was not found.";
        fx.push(e);
    }
    var item = sw_clipAt(sw_fresh().videoTracks[trackIndex], itemStart);
    var before = item.components.numItems;
    sw_step("Adding effects", function () { for (var i = 0; i < fx.length; i++) q.addVideoEffect(fx[i]); });
    item = sw_clipAt(sw_fresh().videoTracks[trackIndex], itemStart);
    var comps = item.components;
    if (comps.numItems < before + 6) throw "Premiere added only " + (comps.numItems - before) + " of the 6 effects.";
    var cT = comps[before], cM1 = comps[before + 1], cM2 = comps[before + 2], cO = comps[before + 3], cC = comps[before + 4], cB = comps[before + 5];

    sw_step("Setting up Transform", function () {
        var anchor = sw_prop(cT, ["anchor"], 0), pos = sw_prop(cT, ["position"], 1);
        var p0 = pos.getValue(), px = p0 && p0[0] > 2;                       // normalised or pixels
        var W = px ? seq.frameSizeHorizontal : 1, H = px ? seq.frameSizeVertical : 1;
        sw_set(sw_prop(cT, ["uniform"], 2), true);
        sw_set(anchor, [0.5 * W, 0.5 * H]);
        sw_set(pos, [0.25 * W, 0.25 * H]);
        sw_set(sw_prop(cT, ["scale height", "scale"], 3), 50);
        sw_set(sw_prop(cT, ["scale width"], 4), 50);
    });
    sw_step("Setting up Mirror", function () {
        var W = seq.frameSizeHorizontal, H = seq.frameSizeVertical;
        var c1 = sw_prop(cM1, ["center", "centre"], 0), c2 = sw_prop(cM2, ["center", "centre"], 0);
        var px = c1.getValue() && c1.getValue()[0] > 2;
        sw_set(c1, px ? [0.4997 * W, 0.5 * H] : [0.4997, 0.5]);
        sw_set(sw_prop(cM1, ["angle"], 1), 0);
        sw_set(c2, px ? [0.5 * W, 0.4995 * H] : [0.5, 0.4995]);
        sw_set(sw_prop(cM2, ["angle"], 1), 90);
    });
    sw_step("Setting up Crop", function () {
        sw_set(sw_prop(cC, ["right"], 2), 50);
        sw_set(sw_prop(cC, ["bottom"], 3), 50);
        sw_set(sw_prop(cC, ["zoom"], 4), true);
    });
    var shift = sw_prop(cO, ["shift", "center", "centre"], 0);
    var blur = sw_prop(cB, ["blurriness"], 0);
    sw_step("Setting up Blur", function () {
        sw_set(sw_prop(cB, ["dimension"], 1), dir[0] && dir[1] ? 0 : (dir[0] ? 1 : 2));   // both / horizontal / vertical
        sw_set(sw_prop(cB, ["repeat edge"], 2), true);
    });
    if (!shift || !blur) throw "Could not find Offset / Blur settings on the new effects.";

    // one key per frame of this item's share of the move
    var s0 = shift.getValue(), spx = s0 && s0[0] > 2;
    var W2 = spx ? seq.frameSizeHorizontal : 1, H2 = spx ? seq.frameSizeVertical : 1;
    var K = Math.max(2, Math.round((fullB - fullA) / f));                     // frames in the whole move
    var mediaIn = item.inPoint.seconds, iA = item.start.seconds, iB = item.end.seconds;
    var plan = [];
    for (var k = 0; k < K; k++) {
        var t = fullA + k * f;
        if (t < iA - f / 4 || t > iB - f + f / 4) continue;                   // not on this item
        var u = k / (K - 1), e2 = sw_ease(u);
        plan.push({
            sec: mediaIn + Math.max(0, t - iA),
            pos: [(0.5 + dir[0] * e2) * W2, (0.5 + dir[1] * e2) * H2],
            blur: Math.round(SW_BLUR * sw_speed(u) * 10) / 10
        });
    }
    if (!plan.length) throw "The transition does not overlap this clip.";
    var i;
    sw_step("Turning on keyframes", function () { shift.setTimeVarying(true); blur.setTimeVarying(true); });
    sw_step("Adding keyframes", function () {
        for (i = 0; i < plan.length; i++) { sw_addKey(shift, plan[i].sec); sw_addKey(blur, plan[i].sec); }
    });
    sw_step("Setting the slide", function () { for (i = 0; i < plan.length; i++) sw_setKey(shift, plan[i].sec, plan[i].pos); });
    sw_step("Setting the blur", function () { for (i = 0; i < plan.length; i++) sw_setKey(blur, plan[i].sec, plan[i].blur); });
    sw_trimKeys(shift, plan[0].sec, plan[plan.length - 1].sec, f);
    sw_trimKeys(blur, plan[0].sec, plan[plan.length - 1].sec, f);
    try { item.name = SW_TAG + "Pan " + SW_NAMES[dirKey]; } catch (e3) {}
    return item;
}

// ------------------------------------------------------------------ sound
function sw_bin(name) {
    var root = app.project.rootItem;
    for (var i = 0; i < root.children.numItems; i++)
        if (root.children[i].type === ProjectItemType.BIN && root.children[i].name === name) return root.children[i];
    return root.createBin(name);
}
function sw_importOnce(bin, path) {
    var want = sw_lc(new File(path).fsName).replace(/\\/g, "/");
    function find() {
        for (var i = 0; i < bin.children.numItems; i++) {
            var mp = "";
            try { mp = bin.children[i].getMediaPath(); } catch (e) {}
            if (sw_lc(mp).replace(/\\/g, "/") === want) return bin.children[i];
        }
        return null;
    }
    var it = find();
    if (!it) { app.project.importFiles([new File(path).fsName], true, bin, false); it = find(); }
    return it;
}
function sw_placeSound(path, cut, peak, dur) {
    var f = new File(path);
    if (!f.exists) throw "Sound file not found: " + path;
    var item = sw_importOnce(sw_bin("Seamless Wipes SFX"), path);
    if (!item) throw "Premiere could not import the sound.";
    var start = Math.max(0, cut - peak), end = start + dur, seq = sw_fresh();
    var tracks = seq.audioTracks, ti = -1;
    for (var i = 0; i < tracks.numTracks && ti < 0; i++) if (sw_trackFree(tracks[i], start, end)) ti = i;
    if (ti < 0) {
        try {
            app.enableQE();
            qe.project.getActiveSequence().addTracks(0, 0, 1, 1, tracks.numTracks, 0, 0);
            ti = sw_fresh().audioTracks.numTracks - 1;
        } catch (e) { throw "No free audio track for the sound."; }
    }
    sw_fresh().audioTracks[ti].overwriteClip(item, start);
    var placed = null, at = sw_fresh().audioTracks[ti];
    for (var c = 0; c < at.clips.numItems; c++) if (sw_near(at.clips[c].start.seconds, start)) placed = at.clips[c];
    if (placed) { try { placed.name = SW_TAG + placed.name; } catch (e2) {} }
    return "A" + (ti + 1);
}

// ------------------------------------------------------------------ entry points
/* soundJSON: "" for none, or {"path":..., "peak":secs, "duration":secs}; useLayer: "true"/"false" */
function sw_apply(dirKey, speed, soundJSON, useLayer) {
    var seq, keepPos;
    try {
        seq = sw_seq();
        keepPos = seq.getPlayerPosition().ticks;
        if (!SW_DIRS[dirKey] || !SW_DURATIONS[speed]) return "error|Unknown wipe " + dirKey + " / " + speed;
        var cut = sw_findCut(seq), f = sw_frame(seq);
        var half = Math.round(SW_DURATIONS[speed] / 2 / f) * f;
        var a = Math.max(0, cut.cut - half), b = cut.cut + half, where;

        var layer = useLayer === "false" ? null : sw_findAdjustmentLayer(app.project.rootItem);
        if (layer) {
            var ti = sw_placeLayer(seq, layer, cut, a, b);
            sw_buildStack(ti, a, dirKey, a, b);
            where = "adjustment layer on V" + (ti + 1);
        } else {
            // no adjustment layer: split off the transition part of each clip and build on those
            a = Math.max(a, cut.a.start.seconds + f);
            b = Math.min(b, cut.b.end.seconds - f);
            var tIdx = cut.track;
            sw_step("Splitting the clips", function () {
                if (a > cut.a.start.seconds + f / 2) sw_razor(true, tIdx, a);
                if (b < cut.b.end.seconds - f / 2) sw_razor(true, tIdx, b);
            });
            sw_buildStack(tIdx, a, dirKey, a, b);
            sw_buildStack(tIdx, cut.cut, dirKey, a, b);
            where = "clips on V" + (tIdx + 1);
        }

        var msg = "Pan " + SW_NAMES[dirKey] + " (" + speed + ") on " + where;
        if (soundJSON) {
            var s = eval("(" + soundJSON + ")");
            try { msg += " + sound on " + sw_placeSound(s.path, cut.cut, s.peak || 0, s.duration || 1); }
            catch (se) { msg += " (sound skipped: " + sw_err(se) + ")"; }
        }
        sw_fresh().setPlayerPosition(keepPos);
        return "ok|" + msg;
    } catch (e) {
        try { if (keepPos) sw_fresh().setPlayerPosition(keepPos); } catch (e2) {}
        return "error|" + sw_err(e);
    }
}

function sw_hasLayer() {
    try {
        if (!app.project) return "ok|";
        var l = sw_findAdjustmentLayer(app.project.rootItem);
        return "ok|" + (l ? l.name : "");
    } catch (e) { return "ok|"; }
}

/* take the wipe back off at the cut nearest the playhead: our layer, our effects, our sound */
function sw_remove() {
    try {
        var seq = sw_seq(), t = seq.getPlayerPosition().seconds, n = 0, i, c;
        var FX = { "transform": 1, "mirror": 1, "offset": 1, "crop": 1, "gaussian blur": 1 };
        for (i = 0; i < seq.videoTracks.numTracks; i++) {
            var tr = seq.videoTracks[i];
            for (c = tr.clips.numItems - 1; c >= 0; c--) {
                var it = tr.clips[c];
                if (!sw_isOurs(it) || it.end.seconds < t - 3 || it.start.seconds > t + 3) continue;
                if (sw_findAdjustmentLayer(app.project.rootItem) && it.projectItem &&
                    it.projectItem.nodeId === sw_findAdjustmentLayer(app.project.rootItem).nodeId) {
                    it.remove(false, true); n++;
                    continue;
                }
                // a split-off clip piece: strip our effects and restore its name
                var q = sw_qeItem(i, it.start.seconds);
                for (var k = q.numComponents - 1; k >= 0; k--) {
                    var comp = q.getComponentAt(k);
                    if (comp && FX[sw_lc(comp.name)]) { try { comp.remove(); n++; } catch (e) {} }
                }
                try { it.name = it.projectItem.name; } catch (e2) {}
            }
        }
        for (i = 0; i < seq.audioTracks.numTracks; i++) {
            var at = seq.audioTracks[i];
            for (c = at.clips.numItems - 1; c >= 0; c--) {
                var ai = at.clips[c];
                if (sw_isOurs(ai) && ai.end.seconds > t - 3 && ai.start.seconds < t + 3) { ai.remove(false, true); n++; }
            }
        }
        return n ? "ok|Wipe removed" : "error|No wipe near the playhead. Ctrl/Cmd+Z also undoes it.";
    } catch (e) {
        return "error|" + sw_err(e);
    }
}
