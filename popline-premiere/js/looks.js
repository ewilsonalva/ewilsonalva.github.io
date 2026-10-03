/*
 * Popline looks: bundled fonts, the animation library and the built-in caption looks.
 * Pure data + tiny helpers; used by captions.js (rendering) and main.js (UI).
 */
'use strict';

/* ------------------------------------------------------------- fonts */

// key = name shown in the UI. name/b/i = how libass selects the face (family + bold/italic flags).
// width = average advance per character as a fraction of the font size [UPPER, lower], measured from
// the font files; used to keep long lines inside the frame.
var FONTS = {
  'Montserrat Black': { file: 'Montserrat-Black.ttf', width: [0.429, 0.363] },
  'Montserrat ExtraBold': { file: 'Montserrat-ExtraBold.ttf', width: [0.424, 0.356] },
  'Montserrat SemiBold': { file: 'Montserrat-SemiBold.ttf', width: [0.416, 0.343] },
  'Poppins Black': { file: 'Poppins-Black.ttf', width: [0.342, 0.302] },
  'Poppins ExtraBold': { file: 'Poppins-ExtraBold.ttf', width: [0.34, 0.299] },
  'Poppins SemiBold': { file: 'Poppins-SemiBold.ttf', width: [0.334, 0.294] },
  'Inter Bold': { file: 'Inter-Bold.ttf', name: 'Inter', b: 1, width: [0.36, 0.3] },
  'Inter Bold Italic': { file: 'Inter-BoldItalic.ttf', name: 'Inter', b: 1, i: 1, width: [0.36, 0.3] },
  'Inter SemiBold': { file: 'Inter-SemiBold.ttf', width: [0.355, 0.295] },
  'Inter ExtraBold': { file: 'Inter-ExtraBold.ttf', width: [0.37, 0.31] },
  'Inter Black': { file: 'Inter-Black.ttf', width: [0.38, 0.32] },
  'Anton': { file: 'Anton-Regular.ttf', width: [0.246, 0.239] },
  'Bebas Neue': { file: 'BebasNeue-Regular.ttf', width: [0.267, 0.267] },
  'Archivo Black': { file: 'ArchivoBlack-Regular.ttf', width: [0.514, 0.417] },
  'Luckiest Guy': { file: 'LuckiestGuy-Regular.ttf', width: [0.421, 0.427] },
  'Bangers': { file: 'Bangers-Regular.ttf', width: [0.216, 0.216] },
  'Bungee': { file: 'Bungee-Regular.ttf', width: [0.242, 0.242] },
  'Russo One': { file: 'RussoOne-Regular.ttf', width: [0.511, 0.436] },
  'Righteous': { file: 'Righteous-Regular.ttf', width: [0.464, 0.386] },
  'Black Ops One': { file: 'BlackOpsOne-Regular.ttf', width: [0.434, 0.386] },
  'Rubik Mono One': { file: 'RubikMonoOne-Regular.ttf', width: [0.687, 0.687] },
  'Shrikhand': { file: 'Shrikhand-Regular.ttf', width: [0.441, 0.37] },
  'Permanent Marker': { file: 'PermanentMarker-Regular.ttf', width: [0.434, 0.366] },
  'Abril Fatface': { file: 'AbrilFatface-Regular.ttf', width: [0.439, 0.348] },
  'DM Serif Display': { file: 'DMSerifDisplay-Italic.ttf', i: 1, width: [0.394, 0.321] },
  'Lobster': { file: 'Lobster-Regular.ttf', width: [0.355, 0.265] },
  'Pacifico': { file: 'Pacifico-Regular.ttf', width: [0.364, 0.216] },
  'Satisfy': { file: 'Satisfy-Regular.ttf', width: [0.357, 0.272] },
  'Great Vibes': { file: 'GreatVibes-Regular.ttf', width: [0.454, 0.163] },
  'Monoton': { file: 'Monoton-Regular.ttf', width: [0.44, 0.41] },
  'VT323': { file: 'VT323-Regular.ttf', width: [0.312, 0.312] },
  'Press Start 2P': { file: 'PressStart2P-Regular.ttf', width: [0.728, 0.728] }
};

function fontFace(key) {
  var f = FONTS[key];
  if (!f) return { name: key, b: 0, i: 0, width: [0.45, 0.38] };
  return { name: f.name || key, b: f.b || 0, i: f.i || 0, width: f.width, file: f.file };
}

/* ------------------------------------------------------------- style */

var BASE_STYLE = {
  font: 'Montserrat Black',
  size: 100,              // px on a 1080-wide (or 1080-tall) frame; scaled to the sequence
  uppercase: true,
  spacing: 0,             // letter spacing px
  color: '#FFFFFF',
  accent: '#FFE600',      // active / emphasised word
  outlineColor: '#000000',
  outline: 6,
  outlineOpacity: 100,    // %
  shadow: 0,
  shadowColor: '#000000',
  shadowOpacity: 60,      // %
  glow: 0,                // edge blur
  fadeTail: 0,            // 0..100: colour ramp from `color` to `fadeColor` across the end of the line
  fadeColor: '#2A2A2A',
  highlight: 'color',     // none | color | box | pop | bigger | underline | hollow | reveal | karaoke
  boxColor: '#7C3AED',
  boxPad: 14,
  rainbow: false,
  palette: ['#FFE600', '#39FF14', '#00E5FF', '#FF4FD8', '#FF8A00'],
  anim: 'pop',            // see ANIMS
  animMs: 220,
  out: 'none',            // none | fade
  posY: 72,               // % from top (centre of the caption)
  maxWords: 3,
  maxChars: 16,           // per line
  lines: 1,
  maxGap: 0.6,            // seconds of silence that forces a new caption
  breakOnPunct: true
};

// Settings that decide how words are grouped / placed; a caption or word look never changes these.
var LAYOUT_KEYS = ['maxWords', 'maxChars', 'lines', 'maxGap', 'breakOnPunct', 'posY'];

function withDefaults(style) {
  var s = {};
  Object.keys(BASE_STYLE).forEach(function (k) { s[k] = style && style[k] !== undefined ? style[k] : BASE_STYLE[k]; });
  return s;
}

/** A look applied on top of the global style (keeps the global layout settings). */
function overlayLook(global, lookStyle) {
  var s = withDefaults(lookStyle);
  LAYOUT_KEYS.forEach(function (k) { s[k] = global[k]; });
  return s;
}

/* ------------------------------------------------------------- animations */

/*
 * Keyframes: p = progress 0..1 of the in-animation. Props:
 *   alpha 0 (opaque)..255, scale %, sx/sy % (separate), blur, spacing px, frx/fry/frz degrees, dx/dy px offset.
 * perChar: animate each letter, `stagger` ms apart (or spread over animMs when stagger = 'spread').
 * special: extra handling in captions.js (clip wipe, VHS / glitch colour layers).
 */
var ANIMS = {
  none: { label: 'None (cut)', kf: [] },
  fade: { label: 'Fade', kf: [{ p: 0, alpha: 255 }, { p: 1, alpha: 0 }] },
  pop: { label: 'Pop', kf: [{ p: 0, alpha: 255, scale: 70 }, { p: 0.6, alpha: 0, scale: 110 }, { p: 1, alpha: 0, scale: 100 }] },
  bounce: { label: 'Bounce (rebote)', kf: [{ p: 0, alpha: 255, scale: 40 }, { p: 0.45, alpha: 0, scale: 118 }, { p: 0.75, alpha: 0, scale: 94 }, { p: 1, alpha: 0, scale: 100 }] },
  blur: { label: 'Blur reveal', kf: [{ p: 0, alpha: 255, blur: 22, scale: 108 }, { p: 1, alpha: 0, blur: 0, scale: 100 }] },
  spread: { label: 'Smooth opacity (spread)', kf: [{ p: 0, alpha: 255, spacing: 26, blur: 6 }, { p: 1, alpha: 0, spacing: 0, blur: 0 }] },
  slideUp: { label: 'Smooth up', kf: [{ p: 0, alpha: 255, dy: 60 }, { p: 1, alpha: 0, dy: 0 }] },
  slideDown: { label: 'Drop down', kf: [{ p: 0, alpha: 255, dy: -60 }, { p: 1, alpha: 0, dy: 0 }] },
  rightIn: { label: 'Right in', kf: [{ p: 0, alpha: 255, dx: 120 }, { p: 1, alpha: 0, dx: 0 }] },
  leftIn: { label: 'Left in', kf: [{ p: 0, alpha: 255, dx: -120 }, { p: 1, alpha: 0, dx: 0 }] },
  zoomIn: { label: 'Zoom in', kf: [{ p: 0, alpha: 255, scale: 50 }, { p: 1, alpha: 0, scale: 100 }] },
  zoomOut: { label: 'Zoom out (punch)', kf: [{ p: 0, alpha: 120, scale: 160 }, { p: 1, alpha: 0, scale: 100 }] },
  stretch: { label: 'Warp (stretch)', kf: [{ p: 0, alpha: 255, sx: 230, sy: 30, blur: 8 }, { p: 0.7, alpha: 0, sx: 92, sy: 108, blur: 0 }, { p: 1, sx: 100, sy: 100 }] },
  flip: { label: '3D flip', kf: [{ p: 0, alpha: 255, frx: 90 }, { p: 0.7, alpha: 0, frx: -12 }, { p: 1, frx: 0 }] },
  swing: { label: 'Swing in', kf: [{ p: 0, alpha: 255, fry: 75 }, { p: 1, alpha: 0, fry: 0 }] },
  rotateIn: { label: 'Rotate in', kf: [{ p: 0, alpha: 255, frz: -16, scale: 70 }, { p: 0.7, alpha: 0, frz: 3, scale: 104 }, { p: 1, frz: 0, scale: 100 }] },
  shake: { label: 'Shake', kf: [{ p: 0, alpha: 255, frz: -7 }, { p: 0.15, alpha: 0, frz: 7 }, { p: 0.3, frz: -5 }, { p: 0.5, frz: 4 }, { p: 0.7, frz: -2 }, { p: 1, frz: 0 }] },
  flicker: { label: 'Neon flicker', kf: [{ p: 0, alpha: 255 }, { p: 0.1, alpha: 0 }, { p: 0.2, alpha: 210 }, { p: 0.32, alpha: 0 }, { p: 0.45, alpha: 170 }, { p: 0.55, alpha: 0 }, { p: 1, alpha: 0 }] },
  cascade: { label: 'Letter cascade', perChar: { stagger: 28 }, kf: [{ p: 0, alpha: 255, sy: 10, blur: 6 }, { p: 1, alpha: 0, sy: 100, blur: 0 }] },
  wave: { label: 'Waves', perChar: { stagger: 40 }, kf: [{ p: 0, alpha: 255, sy: 0 }, { p: 0.45, alpha: 0, sy: 140 }, { p: 0.75, sy: 88 }, { p: 1, sy: 100 }] },
  typewriter: { label: 'Typewriter', perChar: { stagger: 'spread', dur: 30 }, kf: [{ p: 0, alpha: 255 }, { p: 1, alpha: 0 }] },
  wipe: { label: 'Handwritten wipe', special: 'wipe', kf: [] },
  glitch: { label: 'Glitch (error)', special: 'glitch', kf: [{ p: 0, alpha: 255 }, { p: 0.25, alpha: 0 }, { p: 1, alpha: 0 }] },
  vhs: { label: 'VHS', special: 'vhs', kf: [{ p: 0, alpha: 255, blur: 4 }, { p: 0.4, alpha: 0, blur: 1.2 }, { p: 1, blur: 1.2 }] }
};

var HIGHLIGHTS = {
  none: 'No highlight',
  color: 'Colour the spoken word',
  box: 'Box behind the spoken word',
  pop: 'Pop the spoken word',
  bigger: 'Bigger spoken word',
  underline: 'Underline the spoken word',
  hollow: 'Outline text, spoken word filled',
  reveal: 'Reveal word by word',
  karaoke: 'Karaoke fill sweep'
};

/* ------------------------------------------------------------- looks */

var CATEGORIES = ['Viral', 'Modern', 'Cinematic', 'Elegant', 'Retro', 'Fun', 'Minimal'];

function L(id, label, cat, over) { return { id: id, label: label, cat: cat, style: withDefaults(over) }; }

var LOOKS = [
  // Viral: word-by-word short-form looks
  L('bold-pop', 'Bold Pop', 'Viral', {}),
  L('beast', 'Beast', 'Viral', { font: 'Luckiest Guy', size: 120, outline: 8, shadow: 5, shadowOpacity: 90, accent: '#39FF14', highlight: 'pop', anim: 'pop', maxWords: 2, maxChars: 14 }),
  L('box', 'Box Highlight', 'Viral', { font: 'Poppins ExtraBold', size: 96, outline: 0, highlight: 'box', boxColor: '#7C3AED', accent: '#FFFFFF', anim: 'slideUp', maxWords: 3, maxChars: 18 }),
  L('karaoke', 'Karaoke Reveal', 'Viral', { font: 'Montserrat ExtraBold', size: 84, outline: 5, highlight: 'reveal', accent: '#00E5FF', anim: 'fade', maxWords: 7, maxChars: 20, lines: 2 }),
  L('karaoke-fill', 'Karaoke Fill', 'Viral', { font: 'Montserrat Black', size: 92, outline: 6, color: '#FFFFFF', accent: '#FFE600', highlight: 'karaoke', anim: 'fade', animMs: 120, maxWords: 4, maxChars: 18 }),
  L('one-word', 'One Word Punch', 'Viral', { font: 'Anton', size: 170, outline: 7, highlight: 'none', anim: 'zoomOut', animMs: 160, maxWords: 1, maxChars: 14 }),
  L('hollow', 'Hollow Fill', 'Viral', { font: 'Archivo Black', size: 100, outline: 4, outlineColor: '#FFFFFF', accent: '#FFFFFF', highlight: 'hollow', anim: 'pop', maxWords: 3 }),
  L('underline', 'Underline Pop', 'Viral', { font: 'Poppins Black', size: 96, outline: 5, accent: '#00E5FF', highlight: 'underline', anim: 'slideUp', maxWords: 3 }),
  L('big-word', 'Big Word', 'Viral', { font: 'Anton', size: 130, outline: 6, accent: '#FF3B30', highlight: 'bigger', anim: 'pop', maxWords: 3 }),
  L('bubble', 'Bubble Box', 'Viral', { font: 'Luckiest Guy', size: 104, outline: 0, highlight: 'box', boxColor: '#FF2D55', accent: '#FFFFFF', anim: 'bounce', maxWords: 2 }),
  L('gamer', 'Gamer', 'Viral', { font: 'Russo One', size: 96, color: '#39FF14', outline: 6, accent: '#FFFFFF', highlight: 'pop', anim: 'shake', animMs: 320, maxWords: 2 }),
  L('hype', 'Hype', 'Viral', { font: 'Bungee', size: 165, outline: 7, rainbow: true, highlight: 'pop', anim: 'bounce', maxWords: 2 }),

  // Modern: Inter, gradient tail + soft glow (matches the bundled Text Preset templates)
  L('modern-text', 'Modern Italic', 'Modern', { font: 'Inter Bold Italic', size: 104, uppercase: false, outline: 4, outlineColor: '#FFFFFF', outlineOpacity: 30, glow: 14, fadeTail: 70, highlight: 'none', anim: 'blur', animMs: 380, out: 'fade', maxWords: 3 }),
  L('modern-easy', 'Modern Gradient', 'Modern', { font: 'Inter SemiBold', size: 92, uppercase: false, outline: 3, outlineColor: '#FFFFFF', outlineOpacity: 25, glow: 12, fadeTail: 85, highlight: 'none', anim: 'spread', animMs: 460, out: 'fade', maxWords: 3, maxChars: 20 }),
  L('modern-created', 'Modern Bold', 'Modern', { font: 'Inter ExtraBold', size: 110, uppercase: false, outline: 4, outlineColor: '#FFFFFF', outlineOpacity: 30, glow: 14, highlight: 'none', anim: 'zoomOut', animMs: 300, out: 'fade', maxWords: 2 }),
  L('modern-presets', 'Modern Slide', 'Modern', { font: 'Inter Bold', size: 96, uppercase: false, outline: 3, outlineColor: '#FFFFFF', outlineOpacity: 25, glow: 12, fadeTail: 80, highlight: 'none', anim: 'rightIn', animMs: 360, out: 'fade', maxWords: 3, maxChars: 20 }),
  L('modern-4k', 'Modern Cascade', 'Modern', { font: 'Inter Bold', size: 92, uppercase: false, outline: 3, outlineColor: '#FFFFFF', outlineOpacity: 25, glow: 10, fadeTail: 60, highlight: 'none', anim: 'cascade', animMs: 300, maxWords: 3, maxChars: 20 }),
  L('modern-black', 'Modern Black', 'Modern', { font: 'Inter Black', size: 100, outline: 0, shadow: 6, shadowOpacity: 50, accent: '#7FE7FF', highlight: 'color', anim: 'pop', maxWords: 3 }),
  L('apple', 'Apple Style', 'Modern', { font: 'Inter SemiBold', size: 80, uppercase: false, outline: 0, shadow: 3, shadowOpacity: 45, highlight: 'none', anim: 'blur', animMs: 300, out: 'fade', maxWords: 6, maxChars: 24, lines: 2 }),

  // Cinematic
  L('striking', 'Blur Reveal', 'Cinematic', { font: 'Bebas Neue', size: 170, color: '#FF2D2D', accent: '#FFFFFF', outline: 0, shadow: 6, shadowOpacity: 70, highlight: 'none', anim: 'blur', animMs: 420, out: 'fade', maxWords: 2, maxChars: 14 }),
  L('smooth-opacity', 'Smooth Opacity', 'Cinematic', { font: 'Bebas Neue', size: 150, color: '#7FE7FF', accent: '#FFFFFF', outline: 3, outlineColor: '#0A6C8C', glow: 6, highlight: 'none', anim: 'spread', animMs: 520, out: 'fade', maxWords: 3 }),
  L('glitch', 'Glitch', 'Cinematic', { font: 'Archivo Black', size: 104, outline: 5, accent: '#FF3355', highlight: 'color', anim: 'glitch', animMs: 300, maxWords: 2, maxChars: 14 }),
  L('error', 'Error', 'Cinematic', { font: 'Archivo Black', size: 110, color: '#FF3355', outline: 0, shadow: 0, highlight: 'none', anim: 'glitch', animMs: 380, maxWords: 1 }),
  L('vhs', 'VHS', 'Cinematic', { font: 'VT323', size: 160, outline: 0, shadow: 0, highlight: 'none', anim: 'vhs', animMs: 300, maxWords: 3, maxChars: 18 }),
  L('zoom-in', 'Zoom In', 'Cinematic', { font: 'Bebas Neue', size: 160, spacing: 6, outline: 0, shadow: 5, shadowOpacity: 70, highlight: 'none', anim: 'zoomIn', animMs: 360, out: 'fade', maxWords: 2 }),
  L('zoom-out', 'Zoom Out', 'Cinematic', { font: 'Anton', size: 150, outline: 0, shadow: 5, shadowOpacity: 70, highlight: 'none', anim: 'zoomOut', animMs: 300, out: 'fade', maxWords: 2 }),
  L('warp', 'Warp', 'Cinematic', { font: 'Bebas Neue', size: 160, outline: 0, glow: 2, shadow: 4, highlight: 'none', anim: 'stretch', animMs: 380, maxWords: 2 }),
  L('flip', '3D Flip', 'Cinematic', { font: 'Montserrat ExtraBold', size: 96, outline: 5, highlight: 'color', accent: '#FFB800', anim: 'flip', animMs: 360, maxWords: 3 }),

  // Elegant
  L('smooth-up', 'Smooth Up', 'Elegant', { font: 'Great Vibes', size: 150, uppercase: false, outline: 0, shadow: 4, shadowOpacity: 70, highlight: 'none', accent: '#F5D27A', anim: 'slideUp', animMs: 420, out: 'fade', maxWords: 3, maxChars: 20 }),
  L('elegant', 'Elegant Serif', 'Elegant', { font: 'DM Serif Display', size: 120, uppercase: false, outline: 0, shadow: 4, shadowOpacity: 70, accent: '#F5C542', highlight: 'color', anim: 'blur', animMs: 360, maxWords: 4, maxChars: 20 }),
  L('old-money', 'Old Money', 'Elegant', { font: 'DM Serif Display', size: 112, uppercase: false, color: '#EDE3C8', accent: '#C9A45C', outline: 0, shadow: 3, shadowOpacity: 60, highlight: 'none', anim: 'spread', animMs: 600, out: 'fade', maxWords: 3, maxChars: 20 }),
  L('triple-elegant', 'Triple Elegant', 'Elegant', { font: 'Abril Fatface', size: 120, uppercase: false, outline: 0, shadow: 4, shadowOpacity: 60, accent: '#E8C27A', highlight: 'color', anim: 'cascade', animMs: 320, maxWords: 3, maxChars: 18 }),
  L('handwritten', 'Handwritten', 'Elegant', { font: 'Satisfy', size: 140, uppercase: false, outline: 0, shadow: 3, shadowOpacity: 60, highlight: 'none', anim: 'wipe', animMs: 700, maxWords: 4, maxChars: 22 }),
  L('signature', 'Signature', 'Elegant', { font: 'Pacifico', size: 112, uppercase: false, outline: 0, shadow: 4, shadowOpacity: 60, accent: '#FF7AB6', highlight: 'color', anim: 'wipe', animMs: 600, maxWords: 3, maxChars: 20 }),
  L('lobster', 'Classy', 'Elegant', { font: 'Lobster', size: 120, uppercase: false, outline: 0, shadow: 5, shadowOpacity: 70, accent: '#FFC94A', highlight: 'color', anim: 'slideUp', animMs: 320, maxWords: 3, maxChars: 20 }),

  // Retro
  L('neon', 'Neon', 'Retro', { font: 'Montserrat ExtraBold', size: 100, outline: 5, outlineColor: '#FF00E6', glow: 8, accent: '#FF9CF5', highlight: 'color', anim: 'fade', maxWords: 3 }),
  L('neon-tube', 'Neon Tube', 'Retro', { font: 'Monoton', size: 110, color: '#FFD6FA', outline: 3, outlineColor: '#FF00E6', glow: 12, highlight: 'none', anim: 'flicker', animMs: 700, maxWords: 2, maxChars: 14 }),
  L('arcade', 'Arcade', 'Retro', { font: 'Press Start 2P', size: 54, color: '#FFE600', outline: 6, highlight: 'color', accent: '#FF3B30', anim: 'typewriter', animMs: 400, maxWords: 3, maxChars: 16 }),
  L('retro-80s', 'Retro 80s', 'Retro', { font: 'Righteous', size: 108, color: '#FF8A00', outline: 6, outlineColor: '#5A00FF', shadow: 6, shadowColor: '#FF00E6', shadowOpacity: 80, highlight: 'color', accent: '#FFE600', anim: 'bounce', maxWords: 3 }),
  L('military', 'Military', 'Retro', { font: 'Black Ops One', size: 104, color: '#D9D4AA', outline: 5, outlineColor: '#1E1E14', highlight: 'none', anim: 'shake', animMs: 300, maxWords: 2 }),
  L('terminal', 'Terminal', 'Retro', { font: 'VT323', size: 130, uppercase: false, color: '#39FF14', outline: 0, glow: 4, highlight: 'none', anim: 'typewriter', animMs: 500, maxWords: 4, maxChars: 22 }),

  // Fun
  L('comic', 'Comic', 'Fun', { font: 'Bangers', size: 140, spacing: 2, outline: 7, shadow: 4, shadowOpacity: 100, rainbow: true, highlight: 'pop', anim: 'bounce', maxWords: 3 }),
  L('trippy', 'Trippy', 'Fun', { font: 'Shrikhand', size: 108, uppercase: false, outline: 5, rainbow: true, highlight: 'none', anim: 'wave', animMs: 380, maxWords: 2, maxChars: 14 }),
  L('water', 'Water', 'Fun', { font: 'Righteous', size: 110, uppercase: false, color: '#9BEAFF', outline: 4, outlineColor: '#0077B6', glow: 8, highlight: 'none', anim: 'wave', animMs: 420, maxWords: 3 }),
  L('waves', 'Waves', 'Fun', { font: 'Poppins Black', size: 100, outline: 6, accent: '#FFE600', highlight: 'color', anim: 'wave', animMs: 340, maxWords: 3 }),
  L('rebote', 'Rebote', 'Fun', { font: 'Luckiest Guy', size: 116, outline: 7, shadow: 4, shadowOpacity: 90, highlight: 'none', anim: 'bounce', animMs: 320, maxWords: 2 }),
  L('marker', 'Marker', 'Fun', { font: 'Permanent Marker', size: 110, outline: 5, accent: '#FF3B30', highlight: 'color', anim: 'rotateIn', animMs: 300, maxWords: 3 }),
  L('sticker', 'Sticker', 'Fun', { font: 'Rubik Mono One', size: 70, outline: 0, highlight: 'box', boxColor: '#FFE600', accent: '#111111', anim: 'pop', maxWords: 2, maxChars: 14 }),

  // Minimal
  L('clean', 'Clean Minimal', 'Minimal', { font: 'Poppins SemiBold', size: 72, uppercase: false, outline: 0, shadow: 3, shadowOpacity: 80, highlight: 'none', anim: 'fade', animMs: 160, maxWords: 8, maxChars: 26, lines: 2 }),
  L('subtitle', 'Classic Subtitle', 'Minimal', { font: 'Poppins SemiBold', size: 56, uppercase: false, outline: 3, highlight: 'none', anim: 'none', maxWords: 10, maxChars: 32, lines: 2, posY: 86 }),
  L('right-in', 'Right In', 'Minimal', { font: 'Montserrat SemiBold', size: 84, uppercase: false, outline: 0, shadow: 4, shadowOpacity: 60, highlight: 'none', anim: 'rightIn', animMs: 300, out: 'fade', maxWords: 4, maxChars: 20 }),
  L('zoom-word', 'Zoom Word', 'Minimal', { font: 'Anton', size: 150, outline: 0, shadow: 5, shadowOpacity: 60, highlight: 'none', anim: 'zoomIn', animMs: 220, maxWords: 1 }),
  L('swing', 'Swing', 'Minimal', { font: 'Montserrat ExtraBold', size: 90, outline: 0, shadow: 5, shadowOpacity: 60, highlight: 'color', accent: '#9CF2FF', anim: 'swing', animMs: 320, maxWords: 3 })
];

function lookById(id, extra) {
  var all = LOOKS.concat(extra || []);
  for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
  return null;
}

module.exports = {
  FONTS: FONTS,
  fontFace: fontFace,
  BASE_STYLE: BASE_STYLE,
  LAYOUT_KEYS: LAYOUT_KEYS,
  withDefaults: withDefaults,
  overlayLook: overlayLook,
  ANIMS: ANIMS,
  HIGHLIGHTS: HIGHLIGHTS,
  CATEGORIES: CATEGORIES,
  LOOKS: LOOKS,
  lookById: lookById
};
