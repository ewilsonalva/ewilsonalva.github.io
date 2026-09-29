# Seamless Wipes: one-click panoramic transitions for Premiere Pro

![Panel](screenshot.png)

A one-click version of the **adjustment layer method** panoramic transition (the DILEN *Classic Panoramic* presets): 8 directions, 3 speeds, with an optional whoosh placed right on the cut.

## Install

1. Close Premiere Pro.
2. **Windows:** double-click `install_windows.bat`. **Mac:** run `bash install_mac.sh` in Terminal.
3. Open Premiere and go to **Window → Extensions → Seamless Wipes**.

## Use

1. **Once per project (recommended):** create an adjustment layer with **File → New → Adjustment Layer** and keep its name *Adjustment Layer*. The panel shows **Found: Adjustment Layer**.
2. Put two clips next to each other on a track and park the playhead near the cut.
3. Pick a **Speed** (Fast 0.6s, Medium 1.0s, Slow 1.6s) and a **Sound** (or *None*). ▶ previews the sound. Both are remembered.
4. Click a direction: right, left, up, down, or one of the four diagonals.

**Remove** (the middle button) takes the wipe near the playhead back off: the layer, the effects and the sound. Ctrl/Cmd+Z works too.

## What one click does

Exactly what the tutorial does by hand:

1. The adjustment layer is placed on a free track **above the cut**, centred on it and trimmed to the chosen length. A new track is added if needed.
2. The same effect stack as the DILEN presets goes on the layer:
   - **Transform:** the picture at 50%, in the top-left quarter.
   - **Mirror ×2:** mirrored right and down, making a tile whose edges always match.
   - **Offset:** slides the tile 3 widths (4 heights for vertical), easing in and out.
   - **Crop:** keeps one quarter with **Zoom** on, so it's full screen again.
   - **Gaussian Blur:** peaks at the cut to hide the switch.
3. The chosen sound goes on a free audio track, with its loudest moment on the cut.

The move starts and ends on a whole tile, so the picture is untouched when the wipe enters and leaves.

**No adjustment layer in the project?** The panel splits off just the transition part of each clip (the end of the first clip and the start of the second) and puts the effects there instead. The result looks the same.

**Softer look (from the quick tip):** add a short Cross Dissolve between the two clips under the wipe.

## Sounds

- **Whooshes:** 8 are bundled with the plugin.
- **SFX Library:** if the SFX Library panel is installed, all of its sounds are listed too, including sounds you added yourself.
