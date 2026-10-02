# Popline: viral captions for Premiere Pro

A Premiere Pro panel that **transcribes your clips** and turns the words into **animated, fully editable "viral" captions**: word-by-word highlights, pop/bounce, blur reveal, smooth opacity, glitch and more. Pick a preset, tweak every detail, and drop the captions onto your timeline.

```
 01 TRANSCRIBE          02 EDIT                  03 STYLE                     04 ADD
 whisper.cpp on your    fix words, *emphasise*,   13 presets + every setting:  animated caption layer on the top track
 computer (or OpenAI)   split | merge, sync,      font, colours, outline,      (update in place) · Premiere caption track
 → word timings         find & replace            glow, highlight, motion      · your own .mogrt · SRT / ASS / TXT
```

## Features

- **Transcription with word timings**
  - Runs offline on your computer with [whisper.cpp](https://github.com/ggml-org/whisper.cpp), or uses the OpenAI API if you add a key.
  - Source: the selected timeline clips, or a whole audio track (optionally only between In/Out). Clip trims, timeline position and speed changes are accounted for.
  - 99 languages, with auto-detect. Optional translate-to-English, a vocabulary hint for names and brands, and automatic removal of filler words (um, uh).
- **Edit like a document**
  - Every caption is a text box.
  - `*word*` gives a word the highlight colour. `|` splits a caption. ⤒ merges with the caption above.
  - Sync ±0.1s, find & replace, delete.
  - Clicking a caption moves Premiere's playhead to it.
- **Style**
  - **13 presets**: Bold Pop, Beast, Box Highlight, Karaoke Reveal, One Word Punch, Blur Reveal, Smooth Opacity, Smooth Up, Elegant Serif, Clean Minimal, Glitch, Neon, Comic. You can also **save your own presets**.
  - **13 bundled fonts** (OFL/Apache licensed): Montserrat, Poppins, Anton, Bebas Neue, Archivo Black, Luckiest Guy, Bangers, DM Serif Display, Great Vibes.
  - Colours: text, highlight, outline, box and shadow; rainbow words.
  - Outline, shadow (with opacity) and glow.
  - Active-word effect: colour, box, pop, or word-by-word reveal.
  - Words per caption, characters per line, 1–3 lines.
  - 11 in-animations at adjustable speed, plus an optional fade out and vertical position.
  - Long lines automatically shrink to fit the frame.
- **Live preview**: the exact caption render over the real frame from your clip. **PLAY CAPTION** renders a short animated preview.
- **Four ways to add captions**
  1. **Animated captions**: a transparent ProRes 4444 layer at the sequence's size and frame rate, placed on the top free video track (a new track is added if needed). Edit or restyle and press **UPDATE**: the same clip is relinked to the new render, so your cuts and effects on it stay put.
  2. **Premiere captions**: a native caption track, editable in Premiere's Text panel and styled in Essential Graphics. These have no animation.
  3. **Your own MOGRT**: one instance of any `.mogrt` with a text field per caption, e.g. a title pack like the one in the reference video. Its animation plays and the text stays editable in Essential Graphics.
  4. **Export** SRT, ASS (opens in Aegisub, or burn in with ffmpeg) or a plain transcript.
- The whole session (words, edits, style) is saved in `Popline/<sequence>/popline.json` next to your project, and comes back when you reopen the sequence.

## Install

Unzip **`Popline-<version>.zip`**, then:

- **Windows**: double-click **`Install Windows.bat`**. It installs per-user with no admin rights. It downloads ffmpeg (or reuses Grabbit's copy), whisper.cpp and the *base* speech model.
- **macOS**: double-click **`Install Mac.command`** (right-click → Open if macOS blocks it). It uses Homebrew for ffmpeg and whisper.cpp and downloads the *base* model. Without Homebrew, choose the OpenAI engine in the panel.

Restart Premiere, then open **Window → Extensions → Popline Captions**.

More models are downloaded from the panel's **Transcribe** tab:

| Model | Size | Notes |
|---|---|---|
| tiny | 75 MB | quickest |
| base | 142 MB | the installed default |
| small | 466 MB | noticeably more accurate |
| large-v3-turbo | 547 MB | best |

## How it works

| Piece | What it does |
|---|---|
| `jsx/host.jsx` | ExtendScript: reads the sequence and clips (media path, in point, timeline position, speed), places/relinks the overlay, creates caption tracks, inserts MOGRTs |
| `js/transcribe.js` | ffmpeg cuts each clip's used audio to 16 kHz WAV → `whisper-cli -ml 1 -sow -oj` (one word per segment) → words mapped back to sequence time |
| `js/captions.js` | Groups words into captions; handles edits; builds **ASS subtitles** where every spoken word gets its own event with `\t` transforms (pop, blur, spread, slide…), so animations continue seamlessly across word changes |
| `js/render.js` | ffmpeg + libass draw the ASS onto a transparent canvas → ProRes 4444 with alpha; also preview stills (PNG) and preview clips (WebM) |
| `js/main.js` | The panel |

## Development

```bash
node --test test/popline.test.js   # needs ffmpeg with libass (+ libvpx for preview clips)
```

The `.debug` file exposes DevTools at <http://localhost:8098> while Premiere runs.

## Troubleshooting

- **"whisper.cpp not found"**: run the installer, or switch the engine to *OpenAI API*.
- **"built without libass"**: your ffmpeg can't draw subtitles. Rerun the installer, or drop a full ffmpeg build into `bin/`.
- **Captions out of sync**: use *SYNC ±0.1s* in the Edit tab. If a clip has time remapping (not a constant speed change), caption that clip after a nest/render.
- **Words wrong**: pick a bigger model, add names to *Vocabulary hint*, or fix them in the Edit tab. Your fixes are kept when you restyle.
- **Overlay file size**: ProRes 4444 is roughly 100 MB per minute at 1080×1920. It's an intermediate, so you can delete old `Popline Captions v*.mov` files in the `Popline` folder.
