(function () {
  "use strict";

  var TOOLS = window.ET_TOOLS, byId = {};
  TOOLS.forEach(function (t) { byId[t.id] = t; });
  var keys = ET_store("keys") || {};          // user overrides: id -> letter
  function keyOf(id) { return keys[id] || byId[id].key; }
  function svg(inner) { return '<svg viewBox="0 0 24 24">' + inner + "</svg>"; }

  var bar = document.getElementById("bar"), menu = document.getElementById("menu");
  var tip = document.getElementById("tip"), statusEl = document.getElementById("status");
  var lastClip = ET_store("lastClip") || "freeze";
  var lastTransition = ET_store("lastTransition") || "Cross Dissolve";

  // ---------- toolbar ----------
  var LAYOUT = [
    ["split", "delleft", "delright"],
    ["link", "unlink"],
    ["cliptool"],
    ["fill", "fullkey", "clearkeys", "speedkeys"],
    ["transition", "crossfade"],
    ["settings"]
  ];
  var CLIP_TOOLS = ["freeze", "reverse", "mirror", "rotate"];
  var GEAR = '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 010-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 014 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 010 4h-.1a1.7 1.7 0 00-1.5 1z"/>';

  function buildBar() {
    var html = "";
    LAYOUT.forEach(function (group, gi) {
      if (gi) html += '<div class="sep"></div>';
      group.forEach(function (id) {
        if (id === "cliptool") {
          html += '<button class="tool clip more" data-id="cliptool">' + svg(byId[lastClip].icon) + "</button>";
        } else if (id === "settings") {
          html += '<button class="tool" data-id="settings">' + svg(GEAR) + "</button>";
        } else {
          html += '<button class="tool' + (id === "transition" || id === "fill" ? " more" : "") + '" data-id="' + id + '">' + svg(byId[id].icon) + "</button>";
        }
      });
    });
    bar.innerHTML = html;
  }

  // ---------- tooltips ----------
  function tipFor(id) {
    if (id === "cliptool") return "Clip Tool<small>Freeze · Reverse · Mirror · Rotate</small>";
    if (id === "settings") return "Shortcuts";
    var t = byId[id], extra = "";
    if (id === "transition") extra = "<small>" + lastTransition + " · right-click to change</small>";
    if (id === "fill") extra = "<small>Whole clip visible, no stretching · right-click for Fill</small>";
    if (id === "crossfade") extra = "<small>2 touching clips: crossfade · 1 clip: fade in/out</small>";
    return t.name + "<kbd>" + ET_keyLabel(keyOf(id)) + "</kbd>" + extra;
  }
  function place(el, anchor) {
    var r = anchor.getBoundingClientRect(), w = window.innerWidth, h = window.innerHeight;
    el.style.left = el.style.top = "0px";
    var ew = el.offsetWidth, eh = el.offsetHeight;
    var x = r.right + 6, y = r.top;
    if (x + ew > w) x = Math.max(4, Math.min(r.left, w - ew - 4)), y = r.bottom + 6;
    if (y + eh > h) y = Math.max(4, h - eh - 4);
    el.style.left = x + "px";
    el.style.top = y + "px";
  }
  bar.addEventListener("mouseover", function (e) {
    var b = e.target.closest(".tool");
    if (!b || !menu.hidden) return;
    tip.innerHTML = tipFor(b.getAttribute("data-id"));
    tip.hidden = false;
    place(tip, b);
  });
  bar.addEventListener("mouseout", function (e) {
    if (!e.relatedTarget || !e.relatedTarget.closest || !e.relatedTarget.closest(".tool")) tip.hidden = true;
  });

  // ---------- menus ----------
  var menuAnchor = null;
  function openMenu(anchor, html, onPick) {
    tip.hidden = true;
    statusEl.hidden = true;
    menu.innerHTML = html;
    menu.hidden = false;
    menuAnchor = anchor;
    place(menu, anchor);
    menu.onclick = function (e) {
      var b = e.target.closest("button[data-v]");
      if (!b) return;
      closeMenu();
      onPick(b.getAttribute("data-v"));
    };
  }
  function closeMenu() { menu.hidden = true; menuAnchor = null; }
  document.addEventListener("mousedown", function (e) {
    if (!menu.hidden && !menu.contains(e.target) && !(menuAnchor && menuAnchor.contains(e.target))) closeMenu();
  });

  function clipMenu(anchor) {
    var html = "";
    CLIP_TOOLS.forEach(function (id) {
      html += '<button data-v="' + id + '">' + svg(byId[id].icon) + byId[id].name + "<kbd>" + ET_keyLabel(keyOf(id)) + "</kbd></button>";
    });
    openMenu(anchor, html, function (id) {
      lastClip = id;
      ET_store("lastClip", id);
      anchor.innerHTML = svg(byId[id].icon);
      run(id, null, anchor);
    });
  }
  function transitionMenu(anchor) {
    var html = '<div class="hd">Quick transition</div>';
    ET_TRANSITIONS.forEach(function (n) {
      html += '<button data-v="' + n + '"' + (n === lastTransition ? ' class="cur"' : "") + ">" + n + "</button>";
    });
    openMenu(anchor, html, function (n) {
      lastTransition = n;
      ET_store("lastTransition", n);
      run("transition", n, anchor);
    });
  }
  function fitMenu(anchor) {
    openMenu(anchor,
      '<div class="hd">Resize to sequence</div>' +
      '<button data-v="fit">Fit: whole clip visible<kbd>' + ET_keyLabel(keyOf("fill")) + '</kbd></button>' +
      '<button data-v="fill">Fill: cover the frame, crop edges</button>',
      function (mode) { run("fill", mode, anchor); });
  }
  function fadeMenu(anchor) {
    openMenu(anchor,
      '<div class="hd">One clip selected</div>' +
      '<button data-v="in">Fade in</button><button data-v="out">Fade out</button><button data-v="both">Fade in + out</button>',
      function (mode) { run("crossfade", mode, anchor); });
  }

  // ---------- running tools ----------
  var statusTimer = 0;
  function showStatus(msg, isErr) {
    statusEl.textContent = msg;
    statusEl.className = "status " + (isErr ? "err" : "ok");
    statusEl.hidden = false;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(function () { statusEl.hidden = true; }, isErr ? 4500 : 1600);
  }
  function flash(btn, cls) {
    if (!btn) return;
    btn.classList.remove("busy", "ok", "err");
    btn.classList.add(cls);
    if (cls !== "busy") setTimeout(function () { btn.classList.remove(cls); }, 700);
  }
  function buttonFor(id) {
    if (CLIP_TOOLS.indexOf(id) >= 0) return bar.querySelector('[data-id="cliptool"]');
    return bar.querySelector('[data-id="' + id + '"]');
  }
  function run(id, arg, btn) {
    btn = btn || buttonFor(id);
    if (id === "transition" && arg == null) arg = lastTransition;
    flash(btn, "busy");
    ET_call(id, arg, function (res) {
      var p = res.split("|"), kind = p.shift(), msg = p.join("|");
      if (kind === "choose") { btn.classList.remove("busy"); fadeMenu(btn); return; }
      flash(btn, kind === "ok" ? "ok" : "err");
      showStatus(msg || res, kind !== "ok");
    });
  }

  bar.addEventListener("click", function (e) {
    var b = e.target.closest(".tool");
    if (!b) return;
    var id = b.getAttribute("data-id");
    if (id === "settings") return openKeys();
    if (id === "cliptool") return clipMenu(b);
    run(id, null, b);
  });
  bar.addEventListener("contextmenu", function (e) {
    var b = e.target.closest(".tool");
    e.preventDefault();
    if (!b) return;
    var id = b.getAttribute("data-id");
    if (id === "transition") transitionMenu(b);
    if (id === "fill") fitMenu(b);
    if (id === "cliptool") clipMenu(b);
  });

  // shortcut commands (Window > Extensions > Edit Tools: …) report back here
  if (window.__adobe_cep__) {
    window.__adobe_cep__.addEventListener("com.ewilsonalva.edittools.result", function (ev) {
      var d = ev.data;
      try { d = typeof d === "string" ? JSON.parse(d) : d; } catch (e) { return; }
      var p = String(d.result).split("|"), kind = p.shift();
      flash(buttonFor(d.id), kind === "ok" ? "ok" : "err");
      showStatus(p.join("|"), kind !== "ok");
    });
  }

  // keys also work while this panel has focus
  function comboLetter(e) {
    if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey) return null;
    var m = /^Key([A-Z])$/.exec(e.code || "");
    return m ? m[1] : null;
  }
  document.addEventListener("keydown", function (e) {
    if (!keysView.hidden) return;
    if (e.key === "Escape") return closeMenu();
    var L = comboLetter(e);
    if (!L) return;
    for (var i = 0; i < TOOLS.length; i++) {
      if (keyOf(TOOLS[i].id) === L) { e.preventDefault(); run(TOOLS[i].id); return; }
    }
  });

  // ---------- shortcuts view ----------
  var keysView = document.getElementById("keys"), table = document.getElementById("keyTable");
  function openKeys() {
    closeMenu();
    tip.hidden = true;
    var html = "";
    TOOLS.forEach(function (t) {
      html += "<tr><td>" + svg(t.icon) + "</td><td>Edit Tools: " + t.name + '</td><td><button class="rec" data-id="' + t.id + '">' + ET_keyLabel(keyOf(t.id)) + "</button></td></tr>";
    });
    table.innerHTML = html;
    keysView.hidden = false;
  }
  var listening = null;
  table.addEventListener("click", function (e) {
    var b = e.target.closest(".rec");
    if (!b) return;
    if (listening) listening.classList.remove("listen");
    listening = b;
    b.classList.add("listen");
    b.textContent = "Press " + ET_keyLabel("…");
  });
  document.addEventListener("keydown", function (e) {
    if (!listening) return;
    e.preventDefault();
    var id = listening.getAttribute("data-id");
    if (e.key === "Escape") { listening.textContent = ET_keyLabel(keyOf(id)); }
    else {
      var L = comboLetter(e) || (/^Key([A-Z])$/.exec(e.code || "") || [])[1];
      if (!L) return;
      // a key already taken by another tool is swapped with this tool's old key
      var old = keyOf(id);
      TOOLS.forEach(function (t) { if (t.id !== id && keyOf(t.id) === L) keys[t.id] = old; });
      keys[id] = L;
      ET_store("keys", keys);
      openKeys();
    }
    if (listening) listening.classList.remove("listen");
    listening = null;
  }, true);
  document.getElementById("keysClose").addEventListener("click", function () { keysView.hidden = true; listening = null; });

  buildBar();
})();
