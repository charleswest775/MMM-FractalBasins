# MMM-FractalBasins — context for Claude sessions

Charles's MagicMirror² module: the magnetic pendulum's fractal basins, for his hallway mirror,
as one page in a rotation of pages. Split out of MMM-ChaosTheory on 2026-09-28 with its history
(it was the `basins` simulation of that module's chaos page).

## Files

- `MMM-FractalBasins.js` — module shell: one canvas plus an HTML caption (equations + live
  readout, updated 2×/s). Restarts the sequence every `cycleSeconds` and on each `resume()`.
  Loop: `setTimeout` until a frame is due, then one `requestAnimationFrame`. `suspend()` stops
  it; a sim with `resting = true` is polled only every 500 ms; while MagicMirror fades the module
  out (`hidden` is set at the start, `suspend()` comes after), frames draw nothing.
  `turns: { of, at }`: only every nth showing; otherwise the wrapper gets `display: none` and
  nothing starts.
- `simulations/magnetic-pendulum.js` — the physics (`window.BasinsMagneticPendulum`, renamed so
  it can't clash with MMM-ChaosTheory's global: `accel`, `rk4`, `settle`, `energy`) and the
  `basins` sim on `window.BasinsSimulations`. Small-angle pendulum over three magnets with
  friction, RK4 at dt = 0.02. The sim loads the maps, fades in view ×1, swings the deepest view's
  release pair live (white and black, 4 simulated units per second), then zooms ×10, ×100,
  ×1000 (2 s each, 6 s held); ~40 s to the last close-up, a little under a minute in all, then
  rests on it. Suits a page of about a minute.
- `simulations/common.js` (`window.BasinsCommon`) — `FixedClock`, `sci` and other helpers.
- `assets/basins-0..3.png` + `assets/basins.json` — the maps (1000², ×1 to ×1000) and their
  views and release pairs, rendered by `tools/render-basins.js` (all cores, ~2 min on a Mac;
  a Pi 3 would need ~47 min of CPU per map at ~3.5 ms per pixel). Re-run it after changing the
  pendulum; a test checks the parameters in `basins.json` against the code.
- UMD-style, so the physics runs in Node: `tests/magnetic-pendulum.test.js` (`node --test`, no
  dependencies): energy only falls, three-fold symmetry, convergence under a halved step, the
  shipped pairs split.
- `node_helper.js` — the stats panel (`statsPanel: true`): CPU of Electron and cage, per core,
  temperature, from `/proc`, only while shown.
- `dev/preview.html` — runs the module in a desktop browser (`python3 -m http.server` in the repo,
  then `/dev/preview.html?fps=12`).

MMM-ChaosTheory has the same simulation (`basins`): a fix to the physics or the sim probably
belongs in both.

The shell (`MMM-FractalBasins.js`, `node_helper.js`'s stats panel, `dev/preview.html`) is shared
in spirit with the sibling modules (MMM-ChaosTheory, the other split-out chaos modules, and
MMM-FractalZoom, MMM-Atom, MMM-Chladni, MMM-SacredGeometry, MMM-Tilings, MMM-PlanetsDance,
MMM-SnowCrystal, MMM-NightSky, MMM-PhotoDeck): a fix there probably belongs in the siblings too.

## Measured cost on the Pi

900², 20 fps, over a 60 s showing, Electron + cage: 42% of a core averaged over the sequence
(at 20 fps), ~7% while a picture is held. Hidden: 0.3% (baseline 0.2%). The fade-in and each 2 s
zoom redraw the whole canvas; the swing draws only new path segments.

## Performance findings on the Pi (measured)

- A frame that changes the canvas costs ~2%/fps fixed; beyond that, cost scales with the
  **bounding box of everything changed in the frame**. Full redraws of a 900² canvas at 20 fps
  saturate the pipeline (~150%). JS is never the bottleneck (<3 ms/frame).
- So: draw incrementally (long-exposure trails), keep each frame's changes spatially compact,
  and rest when the picture is static. Line width, opacity, `rAF` vs timer made no difference.
- MagicMirror applies `electronSwitches` after app ready, so `remote-debugging-port` can't be set
  that way; use `debugStats: true` and a `grim` screenshot to see fps on the Pi.

## Hard constraints: the target device

- **Raspberry Pi 3 B+, 905 MB RAM, 64-bit Debian 13.** Mirror runs Electron 42 in a cage
  Wayland kiosk.
- **No GPU acceleration, and it can't be enabled**: the Pi 3's VideoCore IV only does GLES 2.0,
  Chromium needs ES 3.0 (tested). All canvas drawing is CPU. **No WebGL / three.js.**
- Screen will be **portrait 1200×1920** once mounted (Dell U2413, rotated). Design for portrait.
- Electron baseline is ~0.5% of one core. **Measure, don't guess**: on the Pi,
  `~/.cache/mm-sample.sh 60` prints Electron CPU% and RSS over 60 s. Record before/after numbers
  in the README.
- The mirror rotates pages every 15-30 s (MMM-pages, which hides/shows modules). `suspend()` and
  `resume()` must fire on page changes, or the loop burns CPU 24/7.

## Deploying and testing

- This repo is public so the Pi can `git clone`/`git pull` without credentials.
- Pi access: `ssh fatherson@raspberrypi.local` (key auth). Module path:
  `~/MagicMirror/modules/MMM-FractalBasins`. Restart: `pm2 restart MagicMirror`
  (pm2 is in `~/.npm-global/bin`). Logs: `pm2 logs MagicMirror`.
- The mirror's **config.js lives in a separate private repo**, `charleswest775/magicmirror-setup`
  (cloned at `~/dev/magicmirror-setup`). Add the module's config block there, then
  `./deploy.sh diff` and `./deploy.sh push` (push validates config before restarting).
  Don't hand-edit config.js on the Pi without `./deploy.sh pull` afterwards.
- Faster iteration: run it in a desktop browser (`dev/preview.html`), then confirm performance
  on the Pi.
- Commit as Charles's GitHub noreply address (set in this repo's git config).
