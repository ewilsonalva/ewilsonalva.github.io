(function () {
  "use strict";

  var CEP = window.__adobe_cep__ || null;
  var DIRS = [
    { id: "right", label: "Left → right",  icon: '<path d="M4 12h15M13 6l6 6-6 6"/>' },
    { id: "left",  label: "Right → left",  icon: '<path d="M20 12H5M11 6l-6 6 6 6"/>' },
    { id: "down",  label: "Top → bottom",  icon: '<path d="M12 4v15M6 13l6 6 6-6"/>' },
    { id: "up",    label: "Bottom → top",  icon: '<path d="M12 20V5M6 11l6-6 6 6"/>' }
  ];
  var SPEEDS = [
    { id: "fast",   label: "Fast",   frames: 12, anim: ".45s" },
    { id: "medium", label: "Medium", frames: 20, anim: ".8s" },
    { id: "slow",   label: "Slow",   frames: 32, anim: "1.3s" }
  ];

  var grid = document.getElementById("grid"), statusEl = document.getElementById("status");
  var html = "<span></span>";
  DIRS.forEach(function (d) { html += '<span class="hd">' + d.label.replace(" → ", " →<br>") + "</span>"; });
  SPEEDS.forEach(function (s) {
    html += '<span class="speed">' + s.label + "<small>" + s.frames + " frames</small></span>";
    DIRS.forEach(function (d) {
      html += '<button class="wipe" data-dir="' + d.id + '" data-speed="' + s.id + '" style="--dur:' + s.anim + '" title="' +
        s.label + " wipe, " + d.label.toLowerCase() + '"><svg viewBox="0 0 24 24">' + d.icon + "</svg></button>";
    });
  });
  grid.innerHTML = html;

  function host(script, cb) {
    if (!CEP) { cb("error|Not running inside Premiere Pro."); return; }
    CEP.evalScript(script, function (r) {
      r = String(r);
      if (r === "EvalScript error.") r = "error|Premiere's script engine refused the request. Restart Premiere Pro and try again.";
      cb(r);
    });
  }
  var timer = 0;
  function show(res, btn) {
    var p = res.split("|"), ok = p.shift() === "ok";
    statusEl.textContent = p.join("|");
    statusEl.className = "status " + (ok ? "ok" : "err");
    statusEl.hidden = false;
    clearTimeout(timer);
    timer = setTimeout(function () { statusEl.hidden = true; }, ok ? 2200 : 5000);
    if (btn) {
      btn.classList.remove("busy");
      btn.classList.add(ok ? "ok" : "err");
      setTimeout(function () { btn.classList.remove("ok", "err"); }, 800);
    }
  }

  grid.addEventListener("click", function (e) {
    var b = e.target.closest(".wipe");
    if (!b) return;
    b.classList.add("busy");
    host("sw_apply(" + JSON.stringify(b.getAttribute("data-dir")) + "," + JSON.stringify(b.getAttribute("data-speed")) + ")", function (r) { show(r, b); });
  });
  document.getElementById("remove").addEventListener("click", function () {
    host("sw_remove()", function (r) { show(r); });
  });

  // Premiere keeps the first-loaded host.jsx until restart; load the installed one again
  if (CEP) {
    var ext = decodeURI(CEP.getSystemPath("extension")).replace(/^file:\/\/\/?/, navigator.platform.indexOf("Win") === 0 ? "" : "/");
    host("$.evalFile(" + JSON.stringify(ext + "/jsx/host.jsx") + ")", function () {});
  }
})();
