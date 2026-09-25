/* The tool list shared by the toolbar panel and the shortcut commands.
 * `key` is the suggested shortcut. Every one is Alt+Shift (Option+Shift on Mac)
 * plus a letter, a range Premiere's default layout leaves empty. */
window.ET_TOOLS = [
  { id: "split",     name: "Split",            key: "B", group: "cut",   icon: '<path d="M12 3v18"/><path d="M8 7l-3 5 3 5M16 7l3 5-3 5"/>' },
  { id: "delleft",   name: "Delete Left",      key: "Q", group: "cut",   icon: '<path d="M14 4v16"/><rect x="3" y="7" width="8" height="10" rx="1.5" stroke-dasharray="2.5 2"/><path d="M5 10l4 4M9 10l-4 4"/><rect x="17" y="7" width="4" height="10" rx="1"/>' },
  { id: "delright",  name: "Delete Right",     key: "W", group: "cut",   icon: '<path d="M10 4v16"/><rect x="13" y="7" width="8" height="10" rx="1.5" stroke-dasharray="2.5 2"/><path d="M15 10l4 4M19 10l-4 4"/><rect x="3" y="7" width="4" height="10" rx="1"/>' },
  { id: "link",      name: "Link",             key: "L", group: "link",  icon: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>' },
  { id: "unlink",    name: "Unlink",           key: "U", group: "link",  icon: '<path d="M10 14l-2.5 2.5a3.5 3.5 0 01-5-5L5 9"/><path d="M14 10l2.5-2.5a3.5 3.5 0 015 5L19 15"/><path d="M5 5l14 14"/>' },
  { id: "freeze",    name: "Freeze",           key: "F", group: "clip",  icon: '<rect x="4" y="5" width="3" height="14" rx="1"/><rect x="17" y="5" width="3" height="14" rx="1"/><path d="M12 7v10"/>' },
  { id: "reverse",   name: "Reverse",          key: "E", group: "clip",  icon: '<path d="M4 12a8 8 0 108-8H8"/><path d="M11 1L8 4l3 3"/><path d="M14 9l-4 3 4 3z"/>' },
  { id: "mirror",    name: "Mirror",           key: "M", group: "clip",  icon: '<path d="M12 3v18"/><path d="M9 6L3 18h6zM15 6l6 12h-6z"/>' },
  { id: "rotate",    name: "Rotate 90°",       key: "O", group: "clip",  icon: '<path d="M20 12a8 8 0 11-2.3-5.6"/><path d="M20 4v5h-5"/>' },
  { id: "fill",      name: "Fill Frame",       key: "I", group: "frame", icon: '<rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M7 9V8h2M17 9V8h-2M7 15v1h2M17 15v1h-2"/>' },
  { id: "fullkey",   name: "Full Keyframes",   key: "K", group: "frame", icon: '<path d="M6 12l3-3 3 3-3 3z"/><path d="M15 12l3-3 3 3-3 3z" /><path d="M3 12h1M12 12h1"/>' },
  { id: "clearkeys", name: "Clear Keys",       key: "X", group: "frame", icon: '<path d="M9 12l3-3 3 3-3 3z"/><path d="M4 4l16 16"/>' },
  { id: "speedkeys", name: "Speed Ramp Keys",  key: "R", group: "frame", icon: '<path d="M3 18c4 0 5-10 9-10s5 10 9 10"/><circle cx="7" cy="14" r="1.5"/><circle cx="17" cy="14" r="1.5"/>' },
  { id: "transition",name: "Quick Transition", key: "T", group: "trans", icon: '<rect x="2" y="6" width="9" height="12" rx="1.5"/><rect x="13" y="6" width="9" height="12" rx="1.5"/><path d="M9 12h6M13 10l2 2-2 2"/>' },
  { id: "crossfade", name: "Audio Crossfade",  key: "C", group: "trans", icon: '<path d="M3 18L21 6M3 6l18 12"/><path d="M3 21h18" stroke-opacity=".5"/>' }
];

window.ET_TRANSITIONS = ["Cross Dissolve", "Dip to Black", "Dip to White", "Film Dissolve", "Additive Dissolve", "Morph Cut", "Push", "Slide", "Split", "Iris Round", "Barn Doors", "Wipe"];

window.ET_isMac = navigator.platform.indexOf("Mac") === 0;
window.ET_keyLabel = function (letter) {
  return (window.ET_isMac ? "⌥⇧" : "Alt+Shift+") + letter;
};

/* tiny CEP helpers (no CSInterface.js needed) */
window.ET_host = function (script, cb) {
  var cep = window.__adobe_cep__;
  if (!cep) { cb("error|Not running inside Premiere Pro."); return; }
  cep.evalScript(script, function (r) { cb(String(r)); });
};
window.ET_call = function (id, arg, cb) {
  window.ET_host("et_run(" + JSON.stringify(id) + "," + JSON.stringify(arg == null ? "" : arg) + ")", cb);
};
window.ET_store = function (key, val) {
  try {
    if (val === undefined) return JSON.parse(localStorage.getItem("edittools." + key));
    localStorage.setItem("edittools." + key, JSON.stringify(val));
  } catch (e) { return null; }
};
