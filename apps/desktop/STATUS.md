# desktop status (updated 13:5x PT)

| Milestone | State | Verified |
|---|---|---|
| M0 scaffold, `pnpm desktop` | done | `pnpm desktop` builds main+preload and starts Electron; check-types passes |
| M1 packages/ui glass theme, Button/Card/Dialog/Progress/Tabs (+Badge, Switch, Mark, ProgressRing), Geist bundled | done | screenshots in apps/desktop/.screens; ui check-types passes |
| M2 native input (Rust) + typed IPC | done | helper: move/pos round trip exact at 6 points (smoke.mjs), click/scroll/down/up ok, 8 cargo tests; app-level: real clicks landed in the page |
| M3 onboarding calibration | done, synthetic frames only | full flow run with GLANCE_SIM_CAMERA: preview, 9-point, fit 12 px LOO (synthetic), saved to userData, dashboard; real webcam NOT tried |
| M4 overlay (dot, dwell ring, element ring + tag, toast, radial) | done | .screens/overlay.png, flow-7-overlay-live.png |
| M5 demo path (Browse, extractor, decideIntent, click, ablation, debug panel, push to talk) | done | live Fireworks (glm-5p3): `{"target": 8}` in 0.6 to 1.7 s, real click landed in the page; PTT code path built, mic + OpenAI STT not exercised |
| M6 gestures drive the real cursor | done | wink_left click, double_wink one dblclick, wink_right contextmenu, scroll +velocity scrolled the page down (injected events through the controller) |
| M7 tray, radial, pause shortcut, README, FAKE_GAZE | done | README written; tray + shortcuts registered, not clicked by hand |

Tests: contracts 8 pass (golden byte for byte), brain 5 pass (+1 live skipped by default), cargo 8 pass.

## QA / e2e (qa agent, 15:0x PT)

Run: `node apps/desktop/e2e/run.mjs [s1 s2 ...]` (builds into e2e/.app/out, launches the real Electron app via Playwright `_electron`, real mouse via the native helper, GLANCE_PROVIDER=openai; about 5 live OpenAI calls). Screenshots: `apps/desktop/e2e/out/<scenario>/NN-label-<window>.png`, summary `e2e/out/summary.json`. `E2E_NO_BUILD=1` reuses the build. The harness needs the Browse window to be the active app (other apps or agents stealing focus make clicks flaky: it re-asserts focus before each gesture).

| State | Scenario | Measured |
|---|---|---|
| ✔ | s1 onboarding, simulated camera: welcome, camera, 9-point, fit, validation (6 unseen points), gestures, look-and-wink skipped, dashboard | LOO 12 px and validation 4 to 5 px (synthetic), 30 fps, calibration (74 KB) only in the temp userData, real userData untouched; gestures 0/4 "work" because synthetic faces never wink |
| ✔ | s2 Browse "open that", ring + tag, click lands, debug panel, ablation | 1.4 to 1.8 s, ring after about 1.4 to 1.7 s, click log "#1 Invoice 4821"; Nearest-to-gaze clicked Weekly update, Model pick clicked the invoice (1.4 s, 1.5 s) |
| ✔ | s3 gestures with GLANCE_FAKE_GAZE=mouse + SIM | wink_left 1 click 52 ms; double wink exactly 1 dblclick (+2 clicks); wink_right 5/5 plus 3/3 after a 1.4 s dwell; scroll 0 to 208 px and back to 0; mouth open/close press+release |
| ✔ | s3n same WITHOUT the simulated camera (the coordinator's question) | same numbers; 1 intermittent miss of the drag step in 3 runs (focus), 2 of 2 green on rerun |
| ✔ | s3b gaze frames drive the real cursor + drag motion | cursor error 0.0 px, drift 0.0 px, drag press at A, 27 drag moves, release 600 px away, wink clicks at the gaze point in 9 to 38 ms |
| ✔ | s4 radial opens after dwell, "Scroll down" committed by looking | open 1046 to 1055 ms, commit about 1.4 s, scroll 0 to 600, no click from dwell |
| ✔ | s5 Alt+Shift+P (real keystroke) | pauses in about 105 ms, overlay says Paused, wink ignored, resumes |
| ✔ | s6 missing OPENAI key | welcome says "OPENAI_API_KEY not found in the repo .env", intent error "OPENAI_API_KEY is not set" in the debug panel and a toast, no crash |
| ✔ | s7 Accessibility missing (stand-in helper reports trusted:false) | status message, welcome row with Allow button, and (new) a toast on every click attempt |

### Bugs

| State | Bug | Where / cause |
|---|---|---|
| ✔ fixed | wink_right "flaky": after a 1 s dwell the radial is open and the wink only closed it, no right click (0/3 reproduced) | controller.ts onGesture: now closes the radial and still right-clicks (an item hovered = cancel only) |
| ✔ fixed | brows+nod scroll ignored for up to 9 s while the radial was open (scrollY 0 to 0) | controller.ts: the first scroll now closes the radial |
| ✔ fixed | pausing (or quitting) during a mouth-open drag left the mouse button pressed; a stuck button made every later click flaky | controller.ts setSettings/stop release the button |
| ✔ fixed | click without Accessibility failed silently | controller.ts clickAtGaze toasts "Accessibility is off" |
| ✔ fixed | tests could write to the real userData / could not run two instances | index.ts GLANCE_USERDATA, input.ts GLANCE_INPUT_BIN (tests only) |
| ✔ answered | "M6 wink_right contextmenu 0 and scroll 0" in the shared screenshot script | NOT the simulated camera and not the typing/gestureHook/radialSuspended changes: the same gestures pass 8/8 without SIM (s3n) and without FAKE too. Causes: the script never settles the radial (fixed above) and it does not make sure Glance is the active app; with another app in front, `runIntent` now uses the Accessibility path (GLANCE_ELEMENTS=auto), which is how the script's second run picked "full screen" of someone else's window. gestureHook/radialSuspended reset correctly (typing close sets them back) |
| ◐ open | real clicks only land when Glance is the active app (macOS swallows the first click of an inactive app); runIntent focuses it, gestures do not | by design for desktop control; for the recording keep Browse in front |
| ◐ open | with another app in front "open that" acts on THAT app through Accessibility (clicked a window's "full screen" button in a test) | owner: ax (features/ax); consider GLANCE_ELEMENTS=dom for the Browse recording |
| ◐ open | harness cannot move the mouse of a held button from a second process; drag motion is covered via gaze frames (s3b) | harness only |

### Phase 2 (15:0x PT, after the typing, voice, ax, agent and onboarding merges) and the final run

Full run `node apps/desktop/e2e/run.mjs`: 13 of 13 scenarios PASS (about 4 min, about 15 live OpenAI calls). Only one clean full 13/13 run so far (earlier full runs had s4 and s5 failing from a harness bug, since fixed: s4 now reads the radial item positions from the overlay DOM, 4 of 4 reruns green).

| State | Scenario | Measured |
|---|---|---|
| ✔ | p1 Assistant "reply yes, tomorrow at 3 works" (resources/demo, gaze on the "when" line) | stops at "Send reply?" after 4 s and 3 steps with nothing sent (localStorage `sent` empty), reply body "Yes, tomorrow at 3 works." typed; after a real left wink: sent once, 4 steps, 9 s total, 3311 tokens in |
| ✔ | p2 Assistant "schedule it" | stops at "Save event?" after 9 s and 6 steps, form = Product demo / 2026-11-03 / 15:00 / ana.torres@northwind.example, no event saved yet; after the wink: exactly 1 event saved, 7 steps, 13 s |
| ✔ | p3 Typing mode (Alt+Shift+T real keystroke, live replies) | panel + 3 replies in 255 ms; dwell on reply 1 typed it into the page input; gaze keyboard typed "hi"; predicted word completed with a trailing space; backspace removed one char |
| ✔ | p4 Accessibility path on a real app (Calculator) | glance-ax: 22 elements in 88 ms; with Calculator in front "press 7" -> model picked [6] "7" in 2085 ms; the real click landed (Calculator display copy = "7") |

Notes: the typing owner's own check (`GLANCE_TYPING_E2E=1`) and the agent owner's (`GLANCE_AGENT_E2E=1`) are separate; p1 to p4 are independent black-box runs through the real gesture and IPC paths. Minor open: the Browse URL bar says "Glance demo inbox (local)" for every file:// page, also resources/demo (owner: BrowseChrome, cosmetic). Simulated camera gives 0/4 gestures "reliable" (synthetic faces never wink), so a SIM-calibrated profile has all gestures unbound: use FAKE gaze + injected gestures for tests.
