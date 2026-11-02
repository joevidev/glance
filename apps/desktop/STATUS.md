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
