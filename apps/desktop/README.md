# Glance desktop

Electron + electron-vite + React 19 + Tailwind v4 + shadcn (liquid glass, black and white).
"Your assistant can hear you, now it can see what you see."

You run the laptop with your eyes: the cursor follows your gaze (webcam), a wink clicks, a head nod scrolls.
When you say a short command ("open that"), a model on Fireworks picks which on-screen element you mean from
where you look and what you said. Gaze never clicks by itself.

## Run

```bash
pnpm install            # once, at the repo root
pnpm desktop            # builds the Rust input helper, starts Electron with hot reload
```

Keys are read from the repo-root `.env` by the Electron main process only (`FIREWORKS_API_KEY`, `OPENAI_API_KEY`).
They never reach a renderer and are never logged.

**Which model answers** (shown in the debug panel as `provider · model` and next to every decision):

| Run | Provider | Model |
|---|---|---|
| `pnpm desktop` | `fireworks` (default), key `FIREWORKS_API_KEY` | `accounts/fireworks/models/glm-5p3` |
| `GLANCE_PROVIDER=openai pnpm desktop` | `openai`, key `OPENAI_API_KEY` | `gpt-6-astra` |

`GLANCE_MODEL` overrides the model id for either provider. The prompt, the element format and the parser are identical for both
(golden fixture); only the request parameters differ: the OpenAI path sends no `temperature` (the model rejects anything but the
default) and uses `max_completion_tokens` 1024; the Fireworks path sends `temperature: 0`, `max_tokens` 256, `reasoning_effort: low`.
Measured here with a 3-element toy page: `gpt-6-astra` 1.7 to 2.0 s, `glm-5p3` 0.6 to 1.7 s.

First run downloads the MediaPipe face model (3.7 MB) into `apps/desktop/resources/` (gitignored). After that
nothing needs the network except the model call and speech to text.

### Switches

| Env | Effect |
|---|---|
| `GLANCE_PROVIDER=openai` | Use OpenAI (`gpt-6-astra`) for the intent call instead of Fireworks. |
| `GLANCE_FAKE_GAZE=mouse` | The real mouse stands in for the gaze. Cursor control is off (the mouse already is the cursor). With the dashboard toggle "Radial menu on a 1 s stare" on, dwelling 1 s on the mouse opens the radial menu; every Browse feature works. Use it to develop, test, and as the recording fallback. |
| `GLANCE_SIM_CAMERA=1` | Synthetic face frames instead of the webcam, so onboarding and the tracker run with no camera. Uses a throw-away user-data dir, so it never touches your real calibration. |
| `GLANCE_SCREENSHOT=1` | Capture every window to `apps/desktop/.screens/` and quit. `GLANCE_SIMFLOW=1` (with `GLANCE_SIM_CAMERA=1`) drives the whole onboarding and screenshots each step. |

```bash
GLANCE_FAKE_GAZE=mouse pnpm desktop     # fallback with no eyes
```

## macOS permissions (do these once, by hand)

macOS asks for each of these the first time the feature is used. The prompt names the app that is running:
`Electron` when started with `pnpm desktop` (and your terminal, e.g. `Terminal` / `iTerm`, for the input helper).
If you dismissed a prompt: System Settings > Privacy & Security > the list below, switch the app on, restart Glance.

| Permission | Why | Prompt appears | App to allow |
|---|---|---|---|
| Camera | face and iris tracking (local only) | when you press "Calibrate my eyes" | Electron |
| Accessibility | move the real cursor, click, scroll (native helper) | "Allow" button on the welcome screen, or at the first click | Electron **and** your terminal app (the helper process inherits the terminal's trust) |
| Microphone | push to talk | first time you press Option+Space | Electron |
| Screen Recording | only for Diana's screen recording (QuickTime / Cmd+Shift+5), not for Glance itself | when you start the recording | the recorder |

Glance shows a clear message in the UI when Accessibility is missing (the helper reports `trusted:false`); it does not fail silently.

## Using it

1. **Onboarding** (first launch, or "Recalibrate eyes"): camera preview with iris rings, then a full-screen 9-point
   calibration (one white dot at a time, about 25 frames per dot, progress ring), then the fit with the
   leave-one-out error in px and a verdict, then gesture training (relax, wink left, wink right, open mouth, raise brows,
   2 s each) which shows which gestures work for you. Saved to Electron userData (never the repo).
2. **Open Browse**: a window with a URL bar, a command box, and a glass debug panel (bug icon toggles it). It opens a
   local demo inbox with close links, so it works offline. Type a URL to browse a real site.
3. **Command**: type it in the box, or press Option+Space, speak, press Option+Space again. Main extracts the elements with
   the shared extractor, calls the model with gaze + command + elements, shows the ring and the name tag on the chosen
   element, and clicks it with the native helper.
4. **Debug panel**: the model's pick, nearest-to-gaze pick, latency in ms, the raw reply. The **Pick used** switch is the
   ablation: "Nearest to gaze" vs "Model pick" so the demo can show "nearest misses, the model gets it".
   "Send the gaze point" switches between the gaze prompt and the command-only prompt.

### Controls

| Action | Gesture |
|---|---|
| Move | Look (smoothed gaze moves the real cursor) |
| Left click / right click | Wink left / wink right |
| Double click | Double wink |
| Drag | Open mouth = press, move your gaze, close = drop |
| Scroll | Raise brows, nod up or down (settings has "invert scroll" if it feels backwards) |
| Action wheel (radial menu) | Close both eyes for about 1 s (`eyes_closed_long`, 700 ms by default, in `packages/gaze/src/gestures.ts`): opens at the last gaze point; click, right click, drag, scroll up/down, mic, type. Look at an item for 1 s (or wink) to choose it; close your eyes again, Esc, or look away for 2 s to close. The 1 s stare is opt-in (`radialDwell`). The overlay draws a gaze dot only while the wheel is open |
| Push to talk | Option+Space |
| Pause tracking | Alt+Shift+P (also in the menu bar tray item) |

## Demo checklist

- [ ] Camera, Accessibility, Microphone allowed (above). Notifications off. Do Not Disturb on.
- [ ] Sit where you will record, face lit from the front, no window behind you. Recalibrate if you move.
- [ ] `pnpm desktop`, calibrate, check the verdict is Good or better and that gestures you need show "works".
- [ ] "Open Browse", check the debug panel is visible, the page is the inbox (or the site Joel chose).
- [ ] Try "open that" with the gaze on a link: ring + tag appear, the link opens. Try the ablation switch.
- [ ] If a gesture is flaky: do not film it, use the fallback (typed command, or `GLANCE_FAKE_GAZE=mouse`).
- [ ] If the left and right winks feel swapped: onboarding detects and corrects it automatically. If scroll runs backwards, flip "Invert scroll direction".
- [ ] Close windows with personal content. Never show `.env`.

## Layout

```
src/main/        Electron main: windows, native input client, controller (gaze/gestures/radial/overlay state),
                 browse window + intent, speech, asset protocol, tray
src/preload/     typed contextBridge API (contextIsolation on)
src/shared/      IPC contract types
src/renderer/    views: MainApp (onboarding + dashboard), Calibrate, BrowseChrome, Overlay; lib/engine.ts (camera -> MediaPipe -> gaze)
resources/       demo.html (offline demo inbox), face_landmarker.task (downloaded, gitignored)
```

Shared UI lives in `packages/ui` (`@glance/ui/globals.css`, `@glance/ui/components/*`).

## Known gaps

- Camera path, wink/brow/mouth thresholds and head-pose sign are verified only with synthetic frames, not a real face.
- Calibrates and drives the primary display only.
- A double wink produces one click (the first wink) plus one second-click, i.e. a real double click.
- Voice commands use the gaze from the moment you stop recording; very late looking away loses it.
