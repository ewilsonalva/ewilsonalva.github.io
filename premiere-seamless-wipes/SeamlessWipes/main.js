(function () {
  "use strict";

  var CEP = window.__adobe_cep__ || null;
  var FS = window.cep && window.cep.fs, ENC = window.cep && window.cep.encoding;
  var isWin = navigator.platform.indexOf("Win") === 0;

  // 8 directions laid out as a pad; the middle cell is Remove. rot = angle of the hover streak.
  var PAD = [
    { id: "upleft", rot: -135, icon: '<path d="M18 18L6 6M6 15V6h9"/>' },
    { id: "up", rot: -90, icon: '<path d="M12 20V5M6 11l6-6 6 6"/>' },
    { id: "upright", rot: -45, icon: '<path d="M6 18L18 6M9 6h9v9"/>' },
    { id: "left", rot: 180, icon: '<path d="M20 12H5M11 6l-6 6 6 6"/>' },
    { id: "remove" },
    { id: "right", rot: 0, icon: '<path d="M4 12h15M13 6l6 6-6 6"/>' },
    { id: "downleft", rot: 135, icon: '<path d="M18 6L6 18M6 9v9h9"/>' },
    { id: "down", rot: 90, icon: '<path d="M12 4v15M6 13l6 6 6-6"/>' },
    { id: "downright", rot: 45, icon: '<path d="M6 6l12 12M18 9v9H9"/>' }
  ];
  var LABEL = { upleft: "Up + Left", up: "Up", upright: "Up + Right", left: "Left", right: "Right",
    downleft: "Down + Left", down: "Down", downright: "Down + Right" };

  function $(id) { return document.getElementById(id); }
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function store(k, v) {
    try {
      if (v === undefined) return JSON.parse(localStorage.getItem("sw." + k));
      localStorage.setItem("sw." + k, JSON.stringify(v));
    } catch (e) { return null; }
  }
  function sysPath(type) {
    if (!CEP) return "";
    var p = decodeURI(CEP.getSystemPath(type));
    p = isWin ? p.replace("file:///", "") : p.replace("file://", "");
    return p.replace(/\\/g, "/").replace(/\/$/, "");
  }
  function osPath(p) { return isWin ? p.replace(/\//g, "\\") : p; }
  function fileUrl(p) { return "file:///" + encodeURI(p.replace(/\\/g, "/").replace(/^\/+/, "")).replace(/#/g, "%23"); }
  function host(script, cb) {
    if (!CEP) { cb("error|Not running inside Premiere Pro."); return; }
    CEP.evalScript(script, function (r) {
      r = String(r);
      if (r === "EvalScript error.") r = "error|Premiere's script engine refused the request. Restart Premiere Pro and try again.";
      cb(r);
    });
  }
  var EXT = sysPath("extension");

  // ---------- pad ----------
  $("pad").innerHTML = PAD.map(function (d) {
    if (d.id === "remove") return '<button class="wipe remove" data-id="remove" title="Remove the wipe near the playhead">Remove</button>';
    return '<button class="wipe" data-id="' + d.id + '" style="--rot:' + d.rot + 'deg" title="Pan ' + LABEL[d.id] + '">' +
      '<svg viewBox="0 0 24 24">' + d.icon + "</svg></button>";
  }).join("");

  // ---------- speed ----------
  var speed = store("speed") || "medium";
  function drawSpeed() {
    [].forEach.call($("speed").children, function (b) { b.classList.toggle("on", b.getAttribute("data-v") === speed); });
  }
  $("speed").addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    speed = b.getAttribute("data-v");
    store("speed", speed);
    drawSpeed();
  });
  drawSpeed();

  // ---------- sounds: None, the bundled whooshes, then the SFX Library panel's sounds if installed ----------
  var SOUNDS = [];            // index -> { name, path, peak, duration }
  function addGroup(label, list) {
    if (!list.length) return "";
    var html = '<optgroup label="' + esc(label) + '">';
    list.forEach(function (s) {
      SOUNDS.push(s);
      html += '<option value="' + (SOUNDS.length - 1) + '">' + esc(s.name) + "</option>";
    });
    return html + "</optgroup>";
  }
  function buildSounds() {
    SOUNDS = [];
    var html = '<option value="none">None</option>';
    html += addGroup("Whooshes", (window.SW_SOUNDS || []).map(function (s) {
      return { name: s.name, path: EXT + "/" + s.file, peak: s.peak, duration: s.duration };
    }));
    var lib = window.SFX_LIBRARY, libDir = EXT.replace(/\/[^\/]+$/, "") + "/SFXLibrary";
    if (lib && lib.sounds) {
      lib.categories.forEach(function (c) {
        html += addGroup("SFX Library · " + c.name, lib.sounds.filter(function (s) { return s.category === c.name; }).map(function (s) {
          return { name: s.name, path: libDir + "/sounds/" + s.file, peak: Math.min(s.duration * 0.4, 0.6), duration: s.duration };
        }));
      });
    }
    var user = readUserSounds();
    if (user.length) html += addGroup("SFX Library · Your sounds", user);
    var sel = $("sound"), keep = store("sound") || "Whooshes|Whoosh";
    sel.innerHTML = html;
    // restore the last choice by name
    for (var i = 0; i < sel.options.length; i++) {
      var o = sel.options[i], g = o.parentNode.label || "";
      if ((o.value === "none" && keep === "none") || g + "|" + o.text === keep) { sel.selectedIndex = i; break; }
    }
  }
  function readUserSounds() {
    if (!FS) return [];
    var r = FS.readFile(sysPath("userData") + "/SFXLibrary/library.json", ENC.UTF8);
    if (!r || r.err !== 0) return [];
    try {
      return (JSON.parse(r.data).sounds || []).map(function (s) {
        return { name: s.name + " (" + s.category + ")", path: s.path, peak: Math.min(s.duration * 0.4, 0.6), duration: s.duration };
      });
    } catch (e) { return []; }
  }
  $("sound").addEventListener("change", function () {
    var o = $("sound").selectedOptions[0];
    store("sound", o.value === "none" ? "none" : (o.parentNode.label || "") + "|" + o.text);
    stopPreview();
  });
  function chosenSound() {
    var v = $("sound").value;
    return v === "none" ? null : SOUNDS[+v];
  }

  // load the SFX Library panel's list when that plugin is installed next to this one
  (function loadSfxLibrary() {
    var libJs = EXT.replace(/\/[^\/]+$/, "") + "/SFXLibrary/library.js";
    if (!FS || FS.stat(libJs).err !== 0) { buildSounds(); return; }
    var s = document.createElement("script");
    s.src = fileUrl(libJs);
    s.onload = s.onerror = buildSounds;
    document.body.appendChild(s);
  })();

  // ---------- preview ----------
  var audio = new Audio();
  function stopPreview() { audio.pause(); $("preview").classList.remove("playing"); }
  $("preview").addEventListener("click", function () {
    var s = chosenSound();
    if (!s || !audio.paused) { stopPreview(); return; }
    audio.src = fileUrl(s.path);
    audio.currentTime = 0;
    var p = audio.play();
    if (p && p.catch) p.catch(function () { stopPreview(); });
    $("preview").classList.add("playing");
  });
  audio.addEventListener("ended", stopPreview);

  // ---------- adjustment layer ----------
  var useLayer = $("useLayer");
  useLayer.checked = store("useLayer") !== false;
  useLayer.addEventListener("change", function () { store("useLayer", useLayer.checked); refreshLayer(); });
  function refreshLayer() {
    host("sw_hasLayer()", function (r) {
      var name = r.split("|")[1] || "", el = $("layerState");
      if (!useLayer.checked) { el.textContent = "Effects go on the clips"; el.className = "state"; return; }
      el.textContent = name ? "Found: " + name : "None in project, using the clips";
      el.className = "state" + (name ? " found" : "");
      el.title = name ? "" : "File > New > Adjustment Layer to use the tutorial's method";
    });
  }

  // ---------- apply ----------
  var timer = 0;
  function show(res, btn) {
    var p = res.split("|"), ok = p.shift() === "ok";
    var el = $("status");
    el.textContent = p.join("|");
    el.className = "status " + (ok ? "ok" : "err");
    el.hidden = false;
    clearTimeout(timer);
    timer = setTimeout(function () { el.hidden = true; }, ok ? 3000 : 8000);
    if (btn) {
      btn.classList.remove("busy");
      btn.classList.add(ok ? "ok" : "err");
      setTimeout(function () { btn.classList.remove("ok", "err"); }, 900);
    }
  }
  $("pad").addEventListener("click", function (e) {
    var b = e.target.closest(".wipe");
    if (!b) return;
    var id = b.getAttribute("data-id");
    if (id === "remove") { host("sw_remove()", function (r) { show(r, b); }); return; }
    var s = chosenSound(), snd = "";
    if (s) snd = JSON.stringify({ path: osPath(s.path), peak: s.peak, duration: s.duration });
    b.classList.add("busy");
    host("sw_apply(" + JSON.stringify(id) + "," + JSON.stringify(speed) + "," + JSON.stringify(snd) + "," +
      JSON.stringify(String(useLayer.checked)) + ")", function (r) { show(r, b); });
  });

  // Premiere keeps the first-loaded host.jsx until restart; load the installed one again
  if (CEP) host("$.evalFile(" + JSON.stringify(EXT + "/jsx/host.jsx") + ")", refreshLayer);
})();
