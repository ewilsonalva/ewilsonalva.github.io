# Popline 2: transcript captions + title presets for Premiere Pro

A Premiere Pro panel that **transcribes your whole timeline** and turns it into **animated, editable captions**. You can style every caption, or **individual words**, with any of **53 built-in looks** or your own **Motion Graphics Template (.mogrt) presets**. **Smart Mix** picks a fitting preset for each phrase.

```
 01 TRANSCRIBE     02 EDIT                     03 PRESETS                        04 STYLE           05 ADD
 whole sequence →  fix words, give a word or   53 looks + your .mogrt library:   fine-tune the     one layer of animated
 word timings      caption its own look /      add · delete · ＋ at playhead ·   main look, save   captions + your templates,
                   template                    drag to timeline · customise ·    it as a preset    update in place
                                               apply to all · Smart Mix
```

## What it can do

1. **Add presets**: **＋ ADD PRESET** imports `.mogrt` files into your library. You can also **drag .mogrt files onto the panel**. Popline also finds title-pack folders in Downloads, Documents and Desktop automatically (e.g. `Downloads\TITLES PRESETS…`), or you can add a folder.
2. **Delete presets**: 🗑 on any card. Library templates are deleted. Templates in outside folders are hidden, and the original file is kept. Built-in looks are hidden, and **Restore deleted presets** brings them back.
3. **One click or drag to the timeline**:
   - **＋** puts a preset at the playhead with your own text, even where nobody is speaking. For a look, Popline renders a short animated title; for a template, it places the template.
   - **Drag** a template card straight onto the timeline.
   - **Click** a card to use it on the selected caption.
4. **Customise**:
   - **Templates**: ✎ sets the name, the Smart Mix category, default text, size, and every colour and number control the template exposes (e.g. text colour, shadow opacity, gradient colours). Popline applies them each time it places the template.
   - **Looks**: ✎ opens the look in STYLE, where you can set font, colours, outline, glow, gradient fade, active-word effect, animation, timing and position. **SAVE AS PRESET** keeps your version.
5. **Apply to the entire transcript**: **APPLY TO ALL** uses one preset for every caption, whether it's a look or a template.
6. **Smart Mix**: different presets per phrase, chosen from what's said:
   - **Matching**: the opening hook, hype words, numbers and money get punchy presets. Serious or dramatic lines go cinematic, emotional lines elegant, questions modern, gaming/tech retro. Slow, calm delivery gets minimal presets.
   - **Main look**: plain lines keep it, so the edit stays consistent.
   - **Variety** sets how much changes, from 0 (one look everywhere) up to a lot. **SHUFFLE** gives a new mix with the same rules, and **UNDO MIX** resets everything.
   - **Pool**: looks, templates, both, or only one category.

**Per-word looks**: in EDIT, click words in the selected caption, then pick a look for just those words. They keep their own font, colours and animation (keyed to when each word is spoken) inside any caption.

## Built-in looks (53)

| Category | Looks |
|---|---|
| Viral | Bold Pop, Beast, Box Highlight, Karaoke Reveal, Karaoke Fill, One Word Punch, Hollow Fill, Underline Pop, Big Word, Bubble Box, Gamer, Hype |
| Modern | Modern Italic, Modern Gradient, Modern Bold, Modern Slide, Modern Cascade, Modern Black, Apple Style |
| Cinematic | Blur Reveal, Smooth Opacity, Glitch, Error, VHS, Zoom In, Zoom Out, Warp, 3D Flip |
| Elegant | Smooth Up, Elegant Serif, Old Money, Triple Elegant, Handwritten, Signature, Classy |
| Retro | Neon, Neon Tube, Arcade, Retro 80s, Military, Terminal |
| Fun | Comic, Trippy, Water, Waves, Rebote, Marker, Sticker |
| Minimal | Clean Minimal, Classic Subtitle, Right In, Zoom Word, Swing |

- **Animations**: fade, pop, bounce, blur reveal, smooth opacity (spread), smooth up, drop, right/left in, zoom in/out, warp, 3D flip, swing, rotate in, shake, neon flicker, letter cascade, waves, typewriter, handwritten wipe, glitch and VHS.
- **Active-word effects**: colour, box, pop, bigger, underline, hollow→filled, reveal, karaoke fill sweep.
- **Fonts**: 32 bundled (OFL/Apache, licences in `fonts/licenses`).

## Install

Unzip **`Popline-<version>.zip`**, then:

- **Windows**: double-click **`Install Windows.bat`**. It installs per-user, with no admin needed, and sets up:
  - ffmpeg (or reuses Grabbit's copy)
  - whisper.cpp and the *base* speech model
  - the Inter font for the bundled title templates
  - your title templates, copied into your preset library on first launch
- **macOS**: double-click **`Install Mac.command`** (right-click → Open if blocked). It uses Homebrew for ffmpeg and whisper.cpp.

Restart Premiere, then open **Window → Extensions → Popline Captions**.

## Adding captions to the timeline

**ADD CAPTIONS TO TIMELINE** places two things:

- Captions using looks become **one transparent ProRes 4444 layer** on the top free video track.
- Captions using templates become **Motion Graphics Templates** on the track above, with the words filled into the template's text fields (split across them for multi-field templates). They keep their own animation and stay editable in Essential Graphics.

After any change, press it again. The animated layer is re-rendered and **relinked in place**, and the templates are replaced, never duplicated.

Also: **ADD AS PREMIERE CAPTIONS** (a native caption track) and exports to SRT / ASS / TXT.

## Files

| Path | What it does |
|---|---|
| `js/looks.js` | Fonts, the 53 looks, animation and highlight library |
| `js/captions.js` | Words → captions; edits, per-word/caption looks; ASS rendering; template placements |
| `js/smart.js` | Smart Mix: classifies each phrase and picks a fitting preset |
| `js/mogrt.js` | Reads .mogrt files (text fields, colour/number controls, thumbnail) without unpacking them |
| `js/library.js` | Preset library in `~/.popline/library`: import, delete/hide, per-template settings |
| `js/transcribe.js`, `js/render.js` | whisper.cpp / OpenAI transcription; ffmpeg + libass rendering |
| `jsx/host.jsx` | Premiere side: clips, overlay place/relink, MOGRT placement with text, scale and colour settings, removal |
| `packs/` | Templates bundled into your install zip (seeded into the library on first launch) |

```bash
node --test test/popline.test.js
```

## Notes

- **Templates with a different font**: templates made in After Effects use the fonts they were designed with. The bundled ones use Inter, which the installer adds. If a template from another pack shows a different font, install the font listed on its card (hover).
- **Drag to the timeline**: this uses CEP's file drag and works in recent Premiere versions. If your version doesn't accept the drop, use **＋** instead.
- **Smart Mix** runs offline on the transcript, so nothing is sent anywhere. It also respects the category you give each template in ✎.
