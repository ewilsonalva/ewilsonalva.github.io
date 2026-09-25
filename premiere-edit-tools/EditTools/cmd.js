/* Runs one tool, then closes. Each of these little windows is a
 * Window > Extensions > "Edit Tools: …" entry, which is what lets you
 * give every tool a real Premiere keyboard shortcut. */
(function () {
  "use strict";
  var cep = window.__adobe_cep__;
  var id = window.ET_CMD, msg = document.getElementById("msg"), pick = document.getElementById("pick");

  function close() { if (cep) cep.closeExtension(); }
  function report(result) {
    if (!cep) return;
    var env = {};
    try { env = JSON.parse(cep.getHostEnvironment()); } catch (e) {}
    cep.dispatchEvent({
      type: "com.ewilsonalva.edittools.result", scope: "APPLICATION",
      appId: env.appId || "PPRO", extensionId: "com.ewilsonalva.edittools." + id,
      data: JSON.stringify({ id: id, result: result })
    });
  }
  function run(arg) {
    ET_call(id, arg, function (res) {
      report(res);
      var p = res.split("|"), kind = p.shift();
      if (kind === "ok") { close(); return; }
      if (kind === "choose") {
        msg.textContent = p.join("|");
        pick.hidden = false;
        return;
      }
      msg.textContent = p.join("|");
      msg.className = "err";
      setTimeout(close, 2500);
    });
  }
  pick.addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (b) { pick.hidden = true; msg.textContent = "…"; run(b.getAttribute("data-v")); }
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") close();
    if (!pick.hidden && "123".indexOf(e.key) >= 0) run(["in", "out", "both"][+e.key - 1]);
  });
  run("");
})();
