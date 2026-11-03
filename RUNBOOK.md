# Glance: recording runbook (for Diana)

Goal: from a fresh terminal to "ready to record" in under 10 minutes, and nothing that fails silently.
Everything runs on this Mac. The video script is `../demo-script-dev-local.md` (one folder up). Only film what works.

Fireworks is suspended, so **the demo's model is OpenAI `gpt-6-astra`**. Always start the app with `GLANCE_PROVIDER=openai`, keep the debug panel line "Model answering: openai · gpt-6-astra" visible, and say it plainly in the video.

---

## 0. Before you sit down (1 minute)

- **Plug in the charger.** A webcam, a model loop and a screen recording drain a laptop fast.
- Free disk: a screen recording needs several GB free (`pnpm preflight` tells you).
- Turn on **Do Not Disturb** (Control Center > Focus). Quit Slack, Messages, Mail, browsers with personal tabs.
- Sit where you will record: face lit from the **front**, no window or bright lamp behind you.

## 1. From a fresh terminal to ready (about 6 minutes)

Use ONE terminal app for everything (Terminal, iTerm, Warp...). Its Accessibility permission is what the cursor helper uses.

```bash
cd /Users/dianamunozlar/Workspace/jctimana/buivo/hackathons/fireworks-nov02/glance

pnpm install        # ONLY if pnpm preflight says "JavaScript dependencies are not installed"
pnpm preflight      # the checklist; fix every ✖ before going on
GLANCE_PROVIDER=openai pnpm desktop
```

### What `pnpm preflight` prints

`✔` ok, `✖` critical (the command exits with an error, with a one-line fix under it), `⚠` read it or check by hand.

Critical (any `✖` means NOT ready): node 22+, pnpm, cargo, uv; dependencies installed; the Rust input helper builds; `pnpm check-types` passes; the face model file is present; the OpenAI key is set and one real call works.

Expected warnings today:
- Fireworks: `HTTP 412: account suspended`. Normal. Say in the video that the demo runs on OpenAI.
- Camera, Microphone, Accessibility for **Electron**: macOS does not let a script read these. Do the 20-second test printed under each one (also in section 2).
- Battery, disk, Do Not Disturb, extra displays: act on them.

If `pnpm check-types` fails, the code is in a state that Joel must look at. Do not try to fix it; send him the first error lines the preflight prints.

If the face model is missing: be online, run `GLANCE_PROVIDER=openai pnpm desktop` once (it downloads 3.7 MB), close the app, run `pnpm preflight` again.

### Permissions, once (macOS asks the first time; the prompt names `Electron`)

| Permission | Allow | Quick test (20 s) |
|---|---|---|
| Camera | Electron | In the app press "Calibrate my eyes": your face appears with white rings on the irises within 5 s |
| Microphone | Electron | Press Option+Space, say "open that", press Option+Space again: your words appear |
| Accessibility | Electron **and** your terminal app | The dashboard tile "Accessibility" says **Allowed** (not Missing). If it says Missing press "Allow Accessibility" |

Open the panes directly:
`open "x-apple.systempreferences:com.apple.preference.security?Privacy_Camera"` (also `Privacy_Microphone`, `Privacy_Accessibility`).
After switching a permission on, **quit Glance and start it again**. Screen Recording is only for the recorder (QuickTime / Cmd+Shift+5), not for Glance.

## 2. What each screen should look like, and what you do

1. **Welcome / dashboard tiles.** Black and white glass window. Tiles: Camera (shows `tracking` with an fps number), Accessibility (`Allowed`), Gaze error, and the key tile (`OpenAI  Key set`). Anything red or "Missing": fix it now, see Troubleshooting.
2. **Camera step.** Live preview of your face with white rings on your irises. Sit about an arm's length away (**50 to 70 cm**). If you see no rings, move closer, add light from the front. Click "Start calibration" only when the rings sit on your eyes.
3. **Calibration: 9 white dots, one at a time.** Look at each dot, **keep your head still**, move only your eyes. A progress ring fills for each dot (about 1 s each). Do not blink hard or look away between dots. Do not talk.
4. **Result of the fit** (leave-one-out error in px and a word): Excellent, Good, Usable, Poor or Failed. See "How to read the result" below.
5. **If present: "Eye validation".** A screen titled "Six points your eyes had never seen": six new dots, then the measured error (mean and median px) and a verdict. Below "Good" it offers **Fine-tune my eyes (15 s)**; "Redo validation" repeats it. (This screen is being added now; if you do not see it, go on.)
6. **Gesture training**: relax, wink left, wink right, open mouth, raise brows, 2 s each. Each gesture ends as "works" or not for your face. **Film only gestures that say "works".**
7. **Dashboard, then "Open Browse".** A glass window with a URL bar, a command box and a debug panel (bug icon, top right). Open the debug panel. It must show **Model answering: openai · gpt-6-astra**.
8. The page is the offline demo inbox. The newer demo mail site (needed for the multi-step assistant) opens with the **"open demo mail"** button in the Assistant panel (top of the debug sidebar, bug icon); Browse itself still starts on the older demo inbox: an Inbox with "Demo tomorrow at 3 PM?" from Ana Torres.

### How to calibrate well

- Lighting: light on your face from the front (a lamp or window **in front of** you). Nothing bright behind you.
- Distance: **50 to 70 cm**, face centered in the camera, camera at eye level.
- **Head still**, chair fixed, same seat for the whole recording. If you move, recalibrate ("Recalibrate eyes" on the dashboard).
- No glasses glare, no hair over the eyes, no hat brim.
- Look at the dot center, not "near" it. Move only your eyes.

### How to read the result and when to redo

| Word | Mean error | What it means | Do |
|---|---|---|---|
| Excellent | under about 100 px | Tight enough to choose between neighbouring links | Record |
| Good | under about 160 px | Normal for a webcam; the model resolves the rest | Record |
| Usable | under about 250 px | Cursor lands in the right area but is loose | Fine-tune (if offered), or redo with better light and a still head. Record only if it improves |
| Poor / Redo / Failed | 250 px or more, or no fit | Too far off to point with | **Redo now.** Fix lighting, distance and head position first, then "Recalibrate eyes". If it stays this way twice, use `GLANCE_FAKE_GAZE=mouse` (below) |

The fit screen and the validation screen use slightly different cut-offs (the validation is the stricter, honest one, measured on points you never trained on). **Do not say or show any px number in the video unless it comes from your own real calibration.** The repo screenshots used a simulated camera.

## 3. Controls that work, and the fallback

| Action | How | Notes |
|---|---|---|
| Move the cursor | Look | Smoothed gaze |
| Left click | Wink left | Most reliable; film this first |
| Right click | Wink right | Least reliable in testing. Do not film it unless it shows "works" |
| Double click | Double wink | |
| Drag | Open mouth = press, move your gaze, close = drop | |
| Scroll | Raise brows, then nod up or down | If it runs backwards, turn on "Invert scroll direction" on the dashboard |
| Action wheel (radial menu) | Close both eyes for about 1 s (not a blink, not a wink). Look at an item ~1 s to choose it. Close eyes again, Esc, or look away 2 s to close | click, right click, drag, scroll, mic (and "Type" if present). Thresholds depend on your face: confirm it in gesture training ("Close both eyes" row) |
| Voice command | Option+Space, speak, Option+Space | Was never tried with a real microphone before today. Test in the rehearsal |
| Typed command | the command box in Browse | Always works; the safe fallback |
| Pause tracking | Alt+Shift+P (also the menu-bar item) | Use it when you pick up the mouse or talk to someone |
| Typing mode (if present) | wheel "Type", or Alt+Shift+T | Panel at the bottom of the screen with three reply suggestions and a gaze keyboard; the app you are typing into keeps focus |

**Gaze never clicks by itself.** A wink, a spoken command or the typed command does.

**Fallback with no eyes (always available):**
```bash
GLANCE_FAKE_GAZE=mouse GLANCE_PROVIDER=openai pnpm desktop
```
The real mouse stands in for the gaze (cursor control is off). Turn on "Radial menu on a 1 s stare" on the dashboard, then hold the mouse still about 1 s on something for the radial menu (there is no face to close eyes in this mode); every Browse feature works. In the video, say it is the mouse standing in for the gaze if it is visible.

## 4. Demo beats mapped to features (see `../demo-script-dev-local.md` for the words)

| Beat | What you do | Feature it shows | If it does not work |
|---|---|---|---|
| 1 Hook (0:00 to 0:08) | Deck slide 1, still | n/a | n/a |
| 2 Eyes only (0:08 to 0:22) | Cursor follows your eyes over 2 or 3 links; wink to open one; brows + nod to scroll. Hands away from keyboard and mouse | Eye-controlled cursor, wink click, head scroll | Show only the cursor following your eyes; say only the first sentence |
| 3 Gaze + command (0:22 to 0:38) | Browse, debug panel visible. Look at a link between two others, say or type "open that". Hold 2 s on the debug panel | Intent model picks the element from gaze + command; ring and name tag on the element; panel shows model pick, nearest-to-gaze pick, latency, the model line | Type the command. If "Nearest to gaze" and "Model pick" never differ, do not claim the model fixed anything |
| 3b optional (10 s) | In a terminal in the `glance` folder run `pnpm replay` | Replay of 5 REAL benchmark cases: nearest element misses, the model gets it; one case where every system fails; final line with the real accuracies | Use it if the live beat is flaky. Do not call it live |
| 3c if present: multi-step | Press "open demo mail" in the Assistant panel, look at the Ana Torres mail and say or type **"reply yes, tomorrow at 3 works"**. Then on the opened mail look at the time line and say **"schedule it"** | Assistant that does several steps on the offline demo site. Anything like send or save asks you to confirm first: Return = yes, Escape = no (these two keys are global while the prompt is up) | Skip it unless Joel says it is working. It is only film-worthy if it finishes by itself in one take |
| 3d if present: typing mode | Alt+Shift+T (or radial "Type") in a text field; pick a suggested reply with your gaze | Reply suggestions and gaze keyboard | Skip it if suggestions are slow or wrong |
| 3e if present: real desktop | Say a command while another app is in front (not Glance) | Elements come from the macOS Accessibility tree instead of the web page | Only film an app with nothing personal in it |
| 4 The number | Deck slide 5, read only what is on it | The benchmark | Never improvise a number |
| 5 Caveat + close | Deck slide 7 | Gaze in the benchmark is simulated | n/a |

**What was in the code when this runbook was written (14:38 PT, other people were still editing; ask Joel which beats are real before you record):**
- Present and wired: eye validation screen (after calibration), typing mode (main process + panel, shortcut Alt+Shift+T), voice failure messages, the offline demo mail site (`resources/demo/`: inbox, email, reply, calendar), real-desktop elements (Accessibility tree reader), the multi-step assistant in the main process (it asks for confirmation before send/save/submit).
- Not found yet in the screens: a place in Browse where you type or say the multi-step command for the assistant. Until Joel confirms where it is, treat beats 3c to 3e as "not available" and do not film or mention them.

Honesty lines to keep: "the demo uses a hosted model (OpenAI); our open-model and LoRA results are in the benchmark." The app does not run our LoRA.

## 5. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Cursor drifts or jumps | You moved after calibrating; light changed; calibration was Usable or worse | Sit as when you calibrated, fix the light, "Recalibrate eyes" and check the verdict. Do not film a drifting take |
| Left and right winks swapped | Camera is mirrored differently for your setup | Onboarding detects and corrects it. If still wrong after gesture training, redo the gesture training; film only the left wink |
| Scroll goes the wrong way | Head-pose sign differs | Dashboard: switch "Invert scroll direction" |
| Cursor moves but **no click lands** | Accessibility missing for Electron and/or your terminal | Settings > Privacy & Security > Accessibility: switch ON **Electron and your terminal**, quit Glance, start again. The dashboard tile must say Allowed |
| No camera image / tile says not tracking | Camera permission off, another app (Zoom, FaceTime, a browser tab) holds the camera, or the face model file is missing | Allow Camera for Electron; quit other camera apps; run `pnpm preflight` (face model check); restart Glance |
| Model slow or errors | Provider: OpenAI key bad/out of quota, no network, or you started without `GLANCE_PROVIDER=openai` (it then tries suspended Fireworks) | Check the line "Model answering" shows `openai`. Run `pnpm preflight` (the OpenAI line shows the HTTP status). Then use the typed command |
| Microphone silent / "Did not catch that" | Mic permission off, wrong input device, or you pressed Option+Space too soon or twice | System Settings > Sound > Input: pick the right mic and watch the level; allow Microphone for Electron; speak after the first press and press again to stop; use the typed command |
| Window not on top | Another app took focus, or Browse is behind a full-screen app | Click the Glance menu-bar item, "Open Browse"; Mission Control (F3) to find it. Keep other apps closed. Do not record with a full-screen app |
| Everything feels dead | Tracking is paused | Alt+Shift+P toggles it (a toast says paused or resumed) |
| Two displays | Glance drives the primary display only | Unplug the second display before calibrating |

## 6. What NOT to do while recording

- No personal windows, tabs, Slack, email, notifications. Do Not Disturb on.
- Never show `.env`, an API key, the calibration data or the terminal history. Do not run `cat .env`, `env` or `printenv` on screen.
- Do not say or show a px error that is not from your real calibration.
- Do not say the demo runs on Fireworks or on our trained LoRA. It runs on OpenAI `gpt-6-astra`.
- Do not announce features that are not built or did not work in rehearsal (voice, right click, the multi-step assistant, typing mode, real-desktop elements). If it is not "if present and working", leave it out.
- Do not fake a result. If a take fails, use the fallback or re-record, and tell Joel afterwards what failed.
- Do not move your head or change seats between calibration and the take; do not recalibrate in the middle of a take.
- Do not leave the terminal with the preflight output on screen with warnings, unless that is the shot.

## 7. Last check before pressing record

- [ ] `pnpm preflight` ended with "Ready" (no `✖`).
- [ ] Charger plugged in, Do Not Disturb on, personal windows closed.
- [ ] Calibration verdict Good or better, gestures you will use show "works".
- [ ] Browse open, debug panel visible, "Model answering: openai · gpt-6-astra".
- [ ] One dry run of beat 3 ("open that") done.
- [ ] QuickTime: File > New Screen Recording (or Cmd+Shift+5), microphone on, whole screen.
- [ ] Video saved before 16:00 PT. Three takes of each beat; Joel picks.
