(function () {
  "use strict";

  var LIB = window.SFX_LIBRARY;
  var CEP = window.__adobe_cep__ || null;           // null when opened in a normal browser
  var isWin = navigator.platform.indexOf("Win") === 0;

  var ICONS = {
    speaker: '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9a4 4 0 010 6M19 6.5a8 8 0 010 11"/></svg>',
    play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l12-7.5z"/></svg>',
    stop: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg>',
    star: '<svg viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
    chev: '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>',
    all: '<svg viewBox="0 0 24 24"><path d="M3 7h18M3 12h18M3 17h18"/></svg>',
    bolt: '<svg viewBox="0 0 24 24"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>',
    smile: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9.5h.01M15 9.5h.01"/></svg>',
    scissors: '<svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12"/></svg>',
    music: '<svg viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
    crown: '<svg viewBox="0 0 24 24"><path d="M3 8l4 4 5-7 5 7 4-4-2 11H5z"/></svg>'
  };

  var catByName = {};
  LIB.categories.forEach(function (c) { catByName[c.name] = c; });
  function indexSound(s) {
    var c = catByName[s.category];
    s.haystack = [s.name, s.category, c ? c.source : "", s.tags, s.quote].join(" ").toLowerCase();
  }
  LIB.sounds.forEach(indexSound);

  // ---------- small helpers ----------
  function $(id) { return document.getElementById(id); }
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function store(key, val) {
    try {
      if (val === undefined) return JSON.parse(localStorage.getItem("sfxlib." + key));
      localStorage.setItem("sfxlib." + key, JSON.stringify(val));
    } catch (e) { return null; }
  }
  function tint(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return "rgba(" + (n >> 16) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
  }
  function fmtDur(d) { return d < 60 ? d.toFixed(1) + "s" : Math.floor(d / 60) + ":" + ("0" + Math.round(d % 60)).slice(-2); }

  function extensionPath() {
    if (!CEP) return "";
    var p = decodeURI(CEP.getSystemPath("extension"));
    p = isWin ? p.replace("file:///", "") : p.replace("file://", "");
    return p;
  }
  var EXT = extensionPath();
  function soundPath(s) {
    var p = s.user ? s.path : EXT + "/sounds/" + s.file;
    return isWin ? p.replace(/\//g, "\\") : p;
  }

  function fileUrl(path) {
    return "file:///" + encodeURI(String(path).replace(/\\/g, "/").replace(/^\/+/, "")).replace(/#/g, "%23");
  }
  function extOf(s) { return ((/\.([^.\\/]+)$/.exec(s.user ? s.path : s.file) || [])[1] || "mp3").toUpperCase(); }

  function evalHost(script, cb) {
    if (!CEP) { cb("error|Not running inside Premiere Pro."); return; }
    CEP.evalScript(script, function (res) { cb(String(res)); });
  }

  // ---------- state ----------
  var favs = store("favs") || {};
  var state = { folder: null, query: "" };   // folder: null (home) | "__all" | "__fav" | category name

  var q = $("q"), list = $("list"), back = $("back"), title = $("title"), clearBtn = $("clear");
  var trackSel = $("track"), moveChk = $("move"), vol = $("vol");
  trackSel.value = store("track") || "0";
  moveChk.checked = !!store("move");
  vol.value = store("vol") != null ? store("vol") : 0.8;

  // ---------- rendering ----------
  function folderRow(key, name, sub, count, color, icon) {
    return '<div class="folder" data-folder="' + esc(key) + '">' +
      '<div class="tile" style="background:' + tint(color, 0.18) + ';color:' + color + '">' + ICONS[icon] + "</div>" +
      '<div class="meta"><div class="name">' + esc(name) + '</div><div class="sub">' + esc(sub) + "</div></div>" +
      '<span class="count">' + count + '</span><span class="chev">' + ICONS.chev + "</span></div>";
  }

  function soundRow(s) {
    var c = catByName[s.category];
    return '<div class="sound" data-id="' + esc(s.id) + '" title="' + esc(s.quote || s.name) + '">' +
      '<div class="tile" style="background:' + tint(c.color, 0.18) + ';color:' + c.color + '">' + ICONS.speaker + "</div>" +
      '<div class="meta"><div class="name">' + esc(s.name) + '</div><div class="sub">' + esc(s.category) + " • " + extOf(s) + " • " + fmtDur(s.duration) + "</div></div>" +
      (s.user ? '<button class="trash" data-act="del" title="Remove from library">' + ICONS.trash + "</button>" : "") +
      '<button class="star' + (favs[s.id] ? " on" : "") + '" data-act="fav" title="Favorite">' + ICONS.star + "</button>" +
      '<button class="play" data-act="play" title="Preview">' + ICONS.play + "</button>" +
      '<button class="apply" data-act="apply" title="Place at the playhead">Apply</button>' +
      '<div class="progress"></div></div>';
  }

  function matches(s, terms) {
    for (var i = 0; i < terms.length; i++) if (s.haystack.indexOf(terms[i]) < 0) return false;
    return true;
  }

  function render() {
    stopPreview();
    var html = "";
    var query = state.query.trim().toLowerCase();
    back.hidden = state.folder === null && !query;
    clearBtn.hidden = !query;

    if (query) {
      var terms = query.split(/\s+/);
      var scope = LIB.sounds;
      if (state.folder === "__fav") scope = scope.filter(function (s) { return favs[s.id]; });
      else if (state.folder && state.folder !== "__all") scope = scope.filter(function (s) { return s.category === state.folder; });

      var cats = state.folder ? [] : LIB.categories.filter(function (c) {
        var h = (c.name + " " + c.source).toLowerCase();
        return terms.every(function (t) { return h.indexOf(t) >= 0; });
      });
      // name hits first, then tag / quote hits
      var hits = scope.filter(function (s) { return matches(s, terms); });
      hits.sort(function (a, b) {
        var an = a.name.toLowerCase().indexOf(terms[0]) >= 0 ? 0 : 1, bn = b.name.toLowerCase().indexOf(terms[0]) >= 0 ? 0 : 1;
        return an - bn;
      });
      title.textContent = state.folder ? folderTitle() + " — search" : "Search";

      if (cats.length) {
        html += '<div class="section">Categories</div>';
        cats.forEach(function (c) { html += folderRow(c.name, c.name, c.source, countOf(c.name), c.color, c.icon); });
      }
      html += '<div class="section">' + hits.length + " sound" + (hits.length === 1 ? "" : "s") + "</div>";
      hits.forEach(function (s) { html += soundRow(s); });
      if (!hits.length && !cats.length) html = '<div class="empty">No sounds match “' + esc(state.query.trim()) + "”.</div>";
    } else if (state.folder === null) {
      title.textContent = "Library";
      var favCount = LIB.sounds.filter(function (s) { return favs[s.id]; }).length;
      html += '<div class="section">Folders</div>';
      html += folderRow("__all", "All Sounds", "Every sound in the library", LIB.sounds.length, "#9ca3af", "all");
      html += folderRow("__fav", "Favorites", "Sounds you starred", favCount, "#fbbf24", "star");
      LIB.categories.forEach(function (c) { html += folderRow(c.name, c.name, c.source, countOf(c.name), c.color, c.icon); });
    } else {
      title.textContent = folderTitle();
      var items = state.folder === "__all" ? LIB.sounds
        : state.folder === "__fav" ? LIB.sounds.filter(function (s) { return favs[s.id]; })
        : LIB.sounds.filter(function (s) { return s.category === state.folder; });
      items.forEach(function (s) { html += soundRow(s); });
      if (!items.length) html = '<div class="empty">' + (state.folder === "__fav" ? "Star a sound to add it here." : "Nothing here yet.") + "</div>";
    }
    list.innerHTML = html;
    list.scrollTop = 0;
  }

  function folderTitle() {
    return state.folder === "__all" ? "All Sounds" : state.folder === "__fav" ? "Favorites" : state.folder;
  }
  function countOf(cat) { return LIB.sounds.filter(function (s) { return s.category === cat; }).length; }
  function soundById(id) { for (var i = 0; i < LIB.sounds.length; i++) if (LIB.sounds[i].id === id) return LIB.sounds[i]; }

  // ---------- preview ----------
  var audio = new Audio();
  var playingRow = null, raf = 0;
  audio.volume = +vol.value;

  function stopPreview() {
    audio.pause();
    cancelAnimationFrame(raf);
    if (playingRow) {
      playingRow.classList.remove("playing");
      playingRow.querySelector(".play").innerHTML = ICONS.play;
      playingRow.querySelector(".progress").style.width = "0";
    }
    playingRow = null;
  }
  function tick() {
    if (!playingRow || !audio.duration) return;
    playingRow.querySelector(".progress").style.width = (100 * audio.currentTime / audio.duration) + "%";
    raf = requestAnimationFrame(tick);
  }
  function togglePreview(row, s) {
    if (playingRow === row) { stopPreview(); return; }
    stopPreview();
    audio.src = s.user ? fileUrl(s.path) : "sounds/" + s.file;
    audio.currentTime = 0;
    var p = audio.play();
    if (p && p.catch) p.catch(function () { toast("Could not play " + s.name, true); stopPreview(); });
    playingRow = row;
    row.classList.add("playing");
    row.querySelector(".play").innerHTML = ICONS.stop;
    raf = requestAnimationFrame(tick);
  }
  audio.addEventListener("ended", stopPreview);

  // ---------- apply ----------
  function apply(row, s) {
    var btn = row.querySelector(".apply");
    btn.disabled = true;
    btn.textContent = "…";
    var script = "sfx_apply(" + JSON.stringify(soundPath(s)) + "," + s.duration + "," +
      JSON.stringify(trackSel.value) + "," + JSON.stringify(String(moveChk.checked)) + ")";
    evalHost(script, function (res) {
      var parts = res.split("|");
      btn.disabled = false;
      if (parts[0] === "ok") {
        btn.textContent = "Added";
        btn.classList.add("done");
        toast("“" + s.name + "” added to " + parts[1]);
        setTimeout(function () { btn.textContent = "Apply"; btn.classList.remove("done"); }, 1200);
      } else {
        btn.textContent = "Apply";
        toast(parts.slice(1).join("|") || res || "Something went wrong.", true);
      }
    });
  }

  var toastTimer = 0;
  function toast(msg, isErr) {
    var t = $("toast");
    t.textContent = msg;
    t.className = "toast show " + (isErr ? "err" : "ok");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = "toast"; }, isErr ? 4000 : 1800);
  }

  // ---------- events ----------
  list.addEventListener("click", function (e) {
    var folder = e.target.closest(".folder");
    if (folder) {
      state.folder = folder.getAttribute("data-folder");
      state.query = ""; q.value = "";
      render();
      return;
    }
    var btn = e.target.closest("button[data-act]");
    var row = e.target.closest(".sound");
    if (!row) return;
    var s = soundById(row.getAttribute("data-id"));
    var act = btn ? btn.getAttribute("data-act") : "play";
    if (act === "play") togglePreview(row, s);
    else if (act === "apply") apply(row, s);
    else if (act === "del") removeUserSound(s);
    else if (act === "fav") {
      if (favs[s.id]) delete favs[s.id]; else favs[s.id] = 1;
      store("favs", favs);
      btn.classList.toggle("on", !!favs[s.id]);
      if (state.folder === "__fav" && !favs[s.id]) render();
    }
  });
  list.addEventListener("dblclick", function (e) {
    var row = e.target.closest(".sound");
    if (row && !e.target.closest("button")) apply(row, soundById(row.getAttribute("data-id")));
  });

  q.addEventListener("input", function () { state.query = q.value; render(); });
  q.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { q.value = ""; state.query = ""; render(); }
  });
  clearBtn.addEventListener("click", function () { q.value = ""; state.query = ""; render(); q.focus(); });
  back.addEventListener("click", function () {
    if (state.query) { q.value = ""; state.query = ""; }
    else state.folder = null;
    render();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "/" && document.activeElement !== q) { e.preventDefault(); q.focus(); }
  });

  trackSel.addEventListener("change", function () { store("track", trackSel.value); });
  moveChk.addEventListener("change", function () { store("move", moveChk.checked); });
  vol.addEventListener("input", function () { audio.volume = +vol.value; store("vol", +vol.value); });

  // ---------- your own sounds ----------
  var USER_COLORS = ["#fb923c", "#22d3ee", "#e879f9", "#a3e635", "#f87171", "#818cf8"];
  var userLib = { categories: [], sounds: [] };

  function addCategory(name) {
    if (catByName[name]) return;
    var c = { name: name, color: USER_COLORS[userLib.categories.length % USER_COLORS.length], source: "Your sounds", icon: "music", user: true };
    userLib.categories.push(c);
    LIB.categories.push(c);
    catByName[name] = c;
  }
  function mergeUserSound(s) {
    s.user = true;
    LIB.sounds.push(s);
    indexSound(s);
  }
  function saveUserLib(cb) {
    var data = JSON.stringify({ categories: userLib.categories, sounds: userLib.sounds.map(function (s) {
      return { id: s.id, name: s.name, category: s.category, path: s.path, duration: s.duration, tags: s.tags || "", quote: "" };
    }) });
    evalHost("sfx_writeUserLib(" + JSON.stringify(data) + ")", cb || function () {});
  }
  function loadUserLib() {
    evalHost("sfx_readUserLib()", function (res) {
      if (!res || res.indexOf("error|") === 0) return;
      try {
        var d = JSON.parse(res);
        (d.categories || []).forEach(function (c) { addCategory(c.name); });
        (d.sounds || []).forEach(function (s) { userLib.sounds.push(s); mergeUserSound(s); });
        render();
      } catch (e) {}
    });
  }
  function removeUserSound(s) {
    if (!window.confirm("Remove “" + s.name + "” from the library?")) return;
    LIB.sounds.splice(LIB.sounds.indexOf(s), 1);
    userLib.sounds = userLib.sounds.filter(function (x) { return x.id !== s.id; });
    evalHost("sfx_deleteFile(" + JSON.stringify(s.path) + ")", function () {});
    saveUserLib();
    render();
    toast("Removed " + s.name);
  }

  var addView = $("addView"), addList = $("addList"), addForm = $("addForm");
  var addFolder = $("addFolder"), newFolderRow = $("newFolderRow"), newFolder = $("newFolder");
  var pending = [];      // [{ path, name, duration }]

  function openAdd() {
    stopPreview();
    pending = [];
    addList.innerHTML = "";
    addForm.hidden = true;
    var def = state.folder && catByName[state.folder] ? state.folder : "Meme Sounds";
    addFolder.innerHTML = LIB.categories.map(function (c) {
      return '<option' + (c.name === def ? " selected" : "") + ">" + esc(c.name) + "</option>";
    }).join("") + '<option value="__new">＋ New folder…</option>';
    newFolderRow.hidden = true;
    newFolder.value = "";
    addView.hidden = false;
  }
  function baseName(p) { return String(p).replace(/^.*[\\\/]/, "").replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim(); }
  function titleCase(t) { return t.replace(/\b\w/g, function (c) { return c.toUpperCase(); }); }
  function probeDuration(item) {
    var a = new Audio();
    a.preload = "metadata";
    a.onloadedmetadata = function () { item.duration = a.duration || 0; drawPending(); };
    a.src = fileUrl(item.path);
  }
  function drawPending() {
    addList.innerHTML = pending.map(function (p, i) {
      return '<div class="add-row"><input data-i="' + i + '" value="' + esc(p.name) + '" title="Sound name">' +
        '<span class="dur">' + (p.duration ? fmtDur(p.duration) : "…") + "</span></div>";
    }).join("");
    addForm.hidden = !pending.length;
  }
  $("add").addEventListener("click", openAdd);
  $("addBack").addEventListener("click", function () { addView.hidden = true; });
  $("pick").addEventListener("click", function () {
    evalHost("sfx_pickFiles()", function (res) {
      if (!res || res.indexOf("error|") === 0) { if (res) toast(res.slice(6), true); return; }
      res.split("\n").forEach(function (p) {
        if (!p) return;
        var item = { path: p, name: titleCase(baseName(p)), duration: 0 };
        pending.push(item);
        probeDuration(item);
      });
      drawPending();
    });
  });
  addList.addEventListener("input", function (e) {
    var i = e.target.getAttribute("data-i");
    if (i != null) pending[+i].name = e.target.value;
  });
  addFolder.addEventListener("change", function () {
    newFolderRow.hidden = addFolder.value !== "__new";
    if (!newFolderRow.hidden) newFolder.focus();
  });
  $("save").addEventListener("click", function () {
    var folder = addFolder.value === "__new" ? newFolder.value.trim() : addFolder.value;
    if (!folder) { toast("Give the new folder a name.", true); return; }
    addCategory(folder);
    var todo = pending.slice(), added = 0;
    (function next() {
      var p = todo.shift();
      if (!p) {
        saveUserLib();
        addView.hidden = true;
        state.folder = folder; state.query = ""; q.value = "";
        render();
        toast("Added " + added + " sound" + (added === 1 ? "" : "s") + " to " + folder);
        return;
      }
      var name = p.name.trim() || baseName(p.path);
      evalHost("sfx_importSound(" + JSON.stringify(p.path) + "," + JSON.stringify(folder) + "," + JSON.stringify(name) + ")", function (res) {
        var r = res.split("|");
        if (r[0] === "ok") {
          var s = { id: "user/" + Date.now() + "_" + added, name: name, category: folder, path: r.slice(1).join("|"), duration: Math.round((p.duration || 1) * 100) / 100, tags: "" };
          userLib.sounds.push(s);
          mergeUserSound(s);
          added++;
        } else toast(r.slice(1).join("|"), true);
        next();
      });
    })();
  });

  // show the active sequence name so it is clear where Apply will go
  function refreshSeq() {
    evalHost("sfx_ping()", function (res) {
      var p = res.split("|");
      $("seq").textContent = p[0] === "ok" ? p[1] : "";
    });
  }
  if (CEP) { refreshSeq(); setInterval(refreshSeq, 3000); loadUserLib(); }

  render();
})();
