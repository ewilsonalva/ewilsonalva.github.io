/*
 * Seamless Wipes - ExtendScript side.
 *
 * sw_apply(direction, speed) builds a seamless whip/wipe at the cut nearest the playhead:
 *   outgoing clip: Offset slides the picture one full frame in `direction`, accelerating,
 *                  while Directional Blur builds up to a peak on its last frame;
 *   incoming clip: continues the same motion from the peak and eases to a stop as the blur clears.
 * Offset wraps the image around the frame edges, so nothing black ever shows and no overlap is needed.
 */

var SW_TICKS = 254016000000;
var SW_SPEEDS = { fast: 6, medium: 10, slow: 16 };          // frames on each side of the cut
var SW_DIRS = {                                              // picture motion per unit of progress
    right: [1, 0], left: [-1, 0], down: [0, 1], up: [0, -1]
};
var SW_BLUR = 40;                                            // peak Directional Blur length at the cut

function sw_seq() {
    if (!app.project) throw "No project is open.";
    var s = app.project.activeSequence;
    if (!s) throw "Open a sequence in the Timeline first.";
    return s;
}
function sw_frame(seq) { return parseFloat(seq.timebase) / SW_TICKS; }
function sw_time(sec) { var t = new Time(); t.seconds = sec; return t; }
function sw_locked(track) { try { return track.isLocked(); } catch (e) { return false; } }

/* the cut nearest the playhead on the top-most video track that has one within reach */
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
            if (Math.abs(a.end.seconds - b.start.seconds) > f / 2) continue;    // not touching
            var d = Math.abs(a.end.seconds - t);
            if (selIds[a.nodeId] || selIds[b.nodeId]) d -= 1000;                // a selected clip wins
            if (d <= reach && (!best || d < best.d)) best = { a: a, b: b, d: d, track: i };
        }
        if (best) return best;
    }
    throw "Park the playhead near a cut between two touching video clips.";
}

function sw_lc(x) { return String(x || "").toLowerCase(); }
/* a property by (lower-case) name fragment, else by its position in the effect */
function sw_prop(comp, fragments, index) {
    if (!comp) return null;
    var props = comp.properties;
    for (var i = 0; i < props.numItems; i++) {
        var n = sw_lc(props[i].displayName);
        for (var k = 0; k < fragments.length; k++) if (n.indexOf(fragments[k]) >= 0) return props[i];
    }
    return index < props.numItems ? props[index] : null;
}
/* the newest component whose name or match name contains a fragment;
   else the component that appeared at position `fallback` when we added it */
function sw_comp(clip, fragments, fallback) {
    var comps = clip.components;
    for (var i = comps.numItems - 1; i >= 0; i--) {
        var n = sw_lc(comps[i].displayName) + " " + sw_lc(comps[i].matchName);
        for (var k = 0; k < fragments.length; k++) if (n.indexOf(fragments[k]) >= 0) return comps[i];
    }
    return fallback < comps.numItems ? comps[fallback] : null;
}
/* what Premiere reported, for the error message */
function sw_describe(clip) {
    var out = [];
    for (var i = 0; i < clip.components.numItems; i++) {
        var c = clip.components[i], ps = [];
        for (var j = 0; j < c.properties.numItems; j++) ps.push(c.properties[j].displayName);
        out.push(c.displayName + " [" + ps.join(", ") + "]");
    }
    return out.join("; ");
}
/* take our two effects back off a clip (newest instances only) */
function sw_stripNewest(q, count) {
    var removed = 0;
    for (var c = q.numComponents - 1; c >= 0 && removed < count; c--) {
        var comp = q.getComponentAt(c), n = sw_lc(comp && comp.name);
        if (n.indexOf("offset") >= 0 || n.indexOf("directional blur") >= 0) {
            try { comp.remove(); removed++; } catch (e) {}
        }
    }
}
function sw_qeItem(seq, trackIndex, clip) {
    app.enableQE();
    var qt = qe.project.getActiveSequence().getVideoTrackAt(trackIndex);
    for (var i = 0; i < qt.numItems; i++) {
        var q = qt.getItemAt(i);
        if (q && q.type !== "Empty" && Math.abs(q.start.secs - clip.start.seconds) < 0.01) return q;
    }
    throw "Could not reach the clip at " + clip.start.seconds.toFixed(2) + "s.";
}
/* re-read the clip after QE changed it, so its component list is current */
function sw_refetch(seq, trackIndex, start) {
    var fresh = app.project.activeSequence || seq;        // a new handle sees the effects QE just added
    var clips = fresh.videoTracks[trackIndex].clips;
    for (var i = 0; i < clips.numItems; i++)
        if (Math.abs(clips[i].start.seconds - start) < 0.01) return clips[i];
    return null;
}

/* Key helpers. Premiere stores key times in ticks, and setValueAtKey only accepts a time
   that matches a stored key exactly ("Invalid parameter" otherwise), so values are always
   written through the key's own Time object as returned by getKeys(). */
function sw_ticksTime(sec) { var t = new Time(); t.ticks = String(Math.round(sec * SW_TICKS)); return t; }
function sw_addKey(p, sec) {
    try { p.addKey(sw_ticksTime(sec)); return; } catch (e) {}
    p.addKey(sec);
}
/* key times come back as Time objects or, in some versions, plain seconds */
function sw_keySec(k) { return typeof k === "number" ? k : k.seconds; }
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
    try { p.setValueAtKey(k, v, true); return; } catch (e) {}
    p.setValueAtKey(sw_keySec(k), v, true);
}
function sw_linear(p, sec) {
    try { var k = sw_keyAt(p, sec); if (k) p.setInterpolationTypeAtKey(k, 0, true); } catch (e) {}
}
/* run one step, naming it in the error if Premiere refuses */
function sw_step(label, fn) {
    try { return fn(); } catch (e) { throw label + ": " + (e && e.message ? e.message : e); }
}
/* zero out the effects we added, in case Premiere won't let QE delete them */
function sw_neutralise(clip, before) {
    try {
        var off = sw_comp(clip, ["offset"], before), bl = sw_comp(clip, ["directional"], before + 1);
        var sh = sw_prop(off, ["center", "centre"], 0), ln = sw_prop(bl, ["length"], 1);
        if (ln) { try { ln.setTimeVarying(false); } catch (e) {} try { ln.setValue(0, true); } catch (e2) {} }
        if (sh) { try { sh.setTimeVarying(false); } catch (e3) {} }
    } catch (e4) {}
}

/* add Offset + Directional Blur to one clip and key one half of the move */
function sw_keySide(seq, trackIndex, clip, dir, frames, outgoing) {
    var f = sw_frame(seq), q = sw_qeItem(seq, trackIndex, clip);
    var fxOffset = qe.project.getVideoEffectByName("Offset");
    var fxBlur = qe.project.getVideoEffectByName("Directional Blur");
    if (!fxOffset || !fxBlur) throw "Premiere's Offset or Directional Blur effect is missing.";
    var start = clip.start.seconds, before = clip.components.numItems;
    q.addVideoEffect(fxOffset);
    q.addVideoEffect(fxBlur);
    clip = sw_refetch(seq, trackIndex, start);
    try {
        sw_animate(seq, clip, dir, frames, outgoing, before);
    } catch (e) {
        sw_neutralise(clip, before);   // never leave a half-built, blurred clip behind
        sw_stripNewest(q, 2);
        throw e;
    }
}

function sw_animate(seq, clip, dir, frames, outgoing, before) {
    var f = sw_frame(seq);
    var offset = sw_comp(clip, ["offset"], before);
    var blur = sw_comp(clip, ["directional blur", "directional", "motion blur"], before + 1);
    var shift = sw_prop(offset, ["shift center", "shift centre", "center", "centre"], 0);
    var bDir = sw_prop(blur, ["direction"], 0), bLen = sw_prop(blur, ["length"], 1);
    if (!shift || !bLen || shift === bLen) {
        throw "Could not read the Offset / Directional Blur settings. Premiere reported: " + sw_describe(clip);
    }

    // Offset's centre is normally [0.5, 0.5]; some versions report pixels instead
    var c0 = shift.getValue(), w = 1, h = 1;
    if (c0 && c0[0] > 2) { w = seq.frameSizeHorizontal; h = seq.frameSizeVertical; }
    var cx = w / 2, cy = h / 2;
    if (bDir) { try { bDir.setValue(dir[0] !== 0 ? 90 : 0, true); } catch (e) {} }   // 90° = horizontal streaks

    // One curve runs straight through the cut, a key on every frame. With N frames per side,
    // frame k goes from -N (outgoing starts) to N (incoming at rest), the cut sitting between -1 and 0.
    // Travel eases in then out over one full frame width; blur follows the speed, peaking at the cut.
    var N = Math.max(1, frames), mediaIn = clip.inPoint.seconds, clipLen = clip.end.seconds - clip.start.seconds;
    var kFrom = outgoing ? -N : 0, kTo = outgoing ? -1 : N;
    sw_step("Turning on keyframes", function () { shift.setTimeVarying(true); bLen.setTimeVarying(true); });
    var plan = [], i;
    for (var k = kFrom; k <= kTo; k++) {
        var rel = outgoing ? clipLen + k * f : k * f;               // seconds from the clip's start
        if (rel < -f / 4 || rel > clipLen + f / 4) continue;         // clip shorter than the move
        var u = (k + N) / (2 * N);                                  // 0..1 across the whole wipe
        var travel = u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u);
        var speed = Math.min(1, 2 * Math.min(u, 1 - u) + 1 / (2 * N));
        plan.push({
            sec: mediaIn + Math.max(0, rel),
            pos: [cx + dir[0] * travel * w, cy + dir[1] * travel * h],
            blur: k === N || k === -N ? 0 : Math.round(SW_BLUR * speed * 10) / 10
        });
    }
    if (!plan.length) throw "The clip is too short for this wipe.";
    // add every key first, then write values through the keys Premiere actually stored
    sw_step("Adding keyframes", function () {
        for (i = 0; i < plan.length; i++) { sw_addKey(shift, plan[i].sec); sw_addKey(bLen, plan[i].sec); }
    });
    sw_step("Setting the slide", function () {
        for (i = 0; i < plan.length; i++) { sw_setKey(shift, plan[i].sec, plan[i].pos); sw_linear(shift, plan[i].sec); }
    });
    sw_step("Setting the blur", function () {
        for (i = 0; i < plan.length; i++) { sw_setKey(bLen, plan[i].sec, plan[i].blur); sw_linear(bLen, plan[i].sec); }
    });
    var first = plan[0].sec, last = plan[plan.length - 1].sec;
    // Premiere may drop an extra key where the playhead was; remove anything outside the move
    sw_trimKeys(shift, first, last, f);
    sw_trimKeys(bLen, first, last, f);
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

function sw_apply(direction, speed) {
    try {
        var seq = sw_seq(), dir = SW_DIRS[direction], frames = SW_SPEEDS[speed];
        if (!dir || !frames) return "error|Unknown wipe " + direction + " / " + speed;
        var cut = sw_findCut(seq);
        var aStart = cut.a.start.seconds, bStart = cut.b.start.seconds;
        sw_keySide(seq, cut.track, cut.a, dir, frames, true);
        sw_keySide(seq, cut.track, sw_refetch(seq, cut.track, bStart), dir, frames, false);
        var names = { right: "left → right", left: "right → left", down: "top → bottom", up: "bottom → top" };
        return "ok|" + speed.charAt(0).toUpperCase() + speed.slice(1) + " wipe " + names[direction] + " at " + bStart.toFixed(2) + "s (V" + (cut.track + 1) + ")";
    } catch (e) {
        return "error|" + (e && e.message ? e.message : e);
    }
}

/* take the wipe back off both clips at the nearest cut */
function sw_remove() {
    try {
        var seq = sw_seq(), cut = sw_findCut(seq), n = 0;
        var pair = [cut.a, cut.b];
        for (var i = 0; i < 2; i++) {
            var q = sw_qeItem(seq, cut.track, pair[i]);
            for (var c = q.numComponents - 1; c >= 0; c--) {
                var comp = q.getComponentAt(c);
                var cn = sw_lc(comp && comp.name);
                if (cn.indexOf("offset") >= 0 || cn.indexOf("directional blur") >= 0) {
                    try { comp.remove(); n++; } catch (e) {}
                }
            }
        }
        if (!n) return "error|No wipe found at this cut. Use Ctrl/Cmd+Z to undo instead.";
        return "ok|Wipe removed";
    } catch (e) {
        return "error|" + (e && e.message ? e.message : e);
    }
}
