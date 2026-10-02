# Grabbit for Premiere Pro

A Premiere Pro panel that lets you **search YouTube or paste a video link**, then downloads the video, makes it edit-friendly, **imports it into your project** and **drops it on the timeline**. It can also **paste whatever is on your clipboard**, grab a video's **thumbnail**, or grab **any single frame**, either from a link or from your own timeline. You never leave Premiere.

Built from scratch to work like the "YOINK!" panel. It's a CEP extension that drives
[yt-dlp](https://github.com/yt-dlp/yt-dlp) and [ffmpeg](https://ffmpeg.org) and uses ExtendScript to place the clip.

```
 01 FETCH            02 ENCODE                     03 TIMELINE
 yt-dlp downloads ─▶ ffprobe checks codecs;      ─▶ ExtendScript imports into a
 (optionally just    VP9/AV1/Opus/10-bit gets       "Grabbit" bin and inserts /
 the in→out range)   re-encoded to H.264 or ProRes  overwrites at the playhead
```

## Features

- **Search YouTube** from the panel: thumbnails, durations and channels. Double-click or press GRAB.
- **Paste any link** that yt-dlp supports (YouTube, Shorts, Vimeo, TikTok, X, Instagram and many more).
- **In / out points**: download only the part you need (`1:30`, `90`, `1:02:03`).
- **Max quality**: 480p to 2160p. Up to 1080p it picks H.264 so no re-encode is needed.
- **Encode**: *Auto* re-encodes only when Premiere would struggle (VP9, AV1, Opus, 10-bit). You can also force *H.264* or *ProRes 422*, or turn encoding off.
- **Place clip**: insert at the playhead, overwrite at the playhead, append to the end, or add to the bin only. If no sequence is open, it creates one that matches the clip.
- **Grab mode: VIDEO / THUMBNAIL / FRAME**. *Thumbnail* puts the video's full-size thumbnail (PNG) in the project. *Frame* grabs one full-quality frame at the time you type in **FRAME AT**. yt-dlp finds the stream and ffmpeg decodes only that frame, so the whole video is never downloaded. Every search result has VIDEO / THUMB / FRAME buttons.
- **Paste clipboard** (button, or Ctrl/Cmd+V anywhere in the panel). It handles:
  - an image copied from a browser (right-click → *Copy image*, e.g. from Google Images), saved as PNG
  - files copied in Explorer/Finder, imported in place without copying
  - a link to an image, video or audio file, downloaded (WebP/AVIF are converted to PNG, since Premiere can't import them)
  - a link to a video page, handled in the current Grab mode
  - You can also **drag** a link or image from your browser onto the panel.
- **Export frame**: saves the frame under the playhead (at sequence resolution, PNG or JPG), adds it to the project, and puts it on the first free track above at the playhead.
- Images go on the **first free video track above** the target track (overwrite), so nothing underneath is cut or rippled. Several pasted files are laid out back to back.
- Files are saved to `Grabbit Downloads/` next to your `.prproj` so the project stays portable. You can change this in Settings.
- Live progress, speed and ETA, a **Cancel** button, Open Folder, a one-click **Update yt-dlp** button, and optional browser cookies for age-restricted videos.

## Install

**From the zip** (`dist/Grabbit-<version>.zip`): unzip it anywhere, then
- **Windows**: double-click **`Install Windows.bat`**
- **macOS**: double-click **`Install Mac.command`**. If macOS blocks it, right-click → *Open*, or run `bash install/install-mac.sh` in Terminal.

Or from a checkout:

**Windows** (PowerShell, no admin needed):

```powershell
cd grabbit-premiere
powershell -ExecutionPolicy Bypass -File install\install-windows.ps1
```

**macOS**:

```bash
cd grabbit-premiere
bash install/install-mac.sh
```

The installer:
1. copies the panel to your user CEP extensions folder
   (`%APPDATA%\Adobe\CEP\extensions\Grabbit` / `~/Library/Application Support/Adobe/CEP/extensions/Grabbit`),
2. turns on `PlayerDebugMode` so Premiere loads unsigned extensions,
3. downloads `yt-dlp`, `ffmpeg`, `ffprobe` and `deno` into `bin/`. On macOS it uses Homebrew for ffmpeg and deno if you have it.

Restart Premiere and open **Window → Extensions → Grabbit**.

> **Why deno?** YouTube now requires a JavaScript runtime for yt-dlp to get full-quality formats. Without it, downloads may fail or be limited to low quality.

### Manual install
Copy this folder into the CEP extensions folder above, enable PlayerDebugMode
(`HKCU\Software\Adobe\CSXS.12` → `PlayerDebugMode`=`1` on Windows, `defaults write com.adobe.CSXS.12 PlayerDebugMode 1` on macOS; repeat for 11 and 13). Then put the tools in `bin/` or anywhere on your PATH.

## How it compares to Blinkl AnyPaste

Blinkl (blinkl.io) is a separate **desktop app** (Tauri/Rust) that installs its own CEP extension into Premiere/After Effects. It uses an admin helper to write into Adobe's protected folders, registers **global hotkeys** that open a command palette, and bundles yt-dlp and ffmpeg for AnyPaste. Grabbit does the same jobs (paste, link download, export frame) from inside a panel, so there's no separate app, no admin rights and no account. The one thing a panel can't do is a system-wide hotkey: Ctrl/Cmd+V works while the Grabbit panel has focus.

## Project layout

| Path | What it does |
|---|---|
| `CSXS/manifest.xml` | Panel definition (Premiere 22.0+, Node.js enabled) |
| `index.html`, `css/style.css` | Panel UI |
| `js/main.js` | UI logic: search, the grab pipeline and progress |
| `js/core.js` | Node module that finds the tools and builds/runs yt-dlp, ffprobe and ffmpeg. It has no CEP dependencies. |
| `js/cep.js` | Small bridge to `window.__adobe_cep__` (evalScript and extension path) |
| `jsx/host.jsx` | ExtendScript: import into bin, insert/overwrite/append, stills on a free track, create sequence, export frame at playhead (QE DOM) |
| `install/`, `Install Windows.bat`, `Install Mac.command` | Installers for Windows and macOS |
| `build-zip.sh` | Builds `dist/Grabbit-<version>.zip` |
| `test/core.test.js` | Unit tests, plus an end-to-end test of the real yt-dlp → ffprobe → ffmpeg pipeline |

## Development

```bash
node --test test/core.test.js      # needs yt-dlp + ffmpeg on PATH for the end-to-end test
```

The `.debug` file exposes Chrome DevTools for the panel at <http://localhost:8099> while Premiere is running.

## Troubleshooting

- **Panel missing from Window → Extensions**: PlayerDebugMode isn't set for your CEP version. Premiere 2024–2025 uses CSXS.11/12. Restart Premiere after setting it.
- **"Sign in to confirm you're not a bot"**: in Settings, set *Cookies from browser* to a browser where you're signed in to YouTube.
- **HTTP 403 / format not available**: click *Update yt-dlp*. Sites change often and yt-dlp updates to keep up.
- **Clip shows as audio only or won't play**: set Encode to *Always H.264*.
- **Ctrl+V does nothing**: click an empty part of the panel first (not a text box), or use the PASTE CLIPBOARD button.
- **Export frame times out**: make sure the Timeline panel has an open sequence. The frame comes from Premiere's own exporter, so the sequence must be able to render that frame.

## Use responsibly

Only download videos you own or have permission to use. YouTube's Terms of Service and most other platforms' terms restrict downloading. Grabbit does not bypass DRM.
