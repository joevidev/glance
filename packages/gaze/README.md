# @glance/gaze

The "eyes" of Glance: pure TypeScript that turns MediaPipe face-landmark output into a calibrated, smoothed screen point plus gestures (winks, mouth, brows, head-pitch scroll). The core is pure and runs in Node (vitest) with no camera. Only `createFaceLandmarker` touches the browser (and lazy-imports `@mediapipe/tasks-vision`).

```
camera -> FaceLandmarker -> frameFromResult -> GazeFrame --+--> GazeTracker (GazeCalibration + One Euro + dwell) -> point
                                                           +--> GestureDetector -> events (wink, double wink, mouth, brows, scroll)
```

Gaze never clicks on its own. This package only emits dwell progress and gesture events; the app decides what they do.

## Wiring MediaPipe (desktop renderer)

```ts
import { createFaceLandmarker, frameFromResult, GazeCalibration, GazeTracker, GestureDetector, calibrationPoints } from '@glance/gaze';

const lm = await createFaceLandmarker({
  wasmRoot: '/mediapipe/wasm',            // copy node_modules/@mediapipe/tasks-vision/wasm/ into your static assets
  modelUrl: '/mediapipe/face_landmarker.task', // bundle locally; origin file:
  // https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
});

const gestures = new GestureDetector();
let tracker: GazeTracker | null = null;

function onVideoFrame(video: HTMLVideoElement, nowMs: number) {
  const res = lm.detect(video, nowMs);                       // VIDEO mode; timestamps are forced strictly increasing
  const frame = frameFromResult(res, nowMs, { aspect: video.videoWidth / video.videoHeight });
  if (!frame) return;                                        // no face
  for (const ev of gestures.update(frame)) handle(ev);
  const out = tracker?.update(frame);                        // { point, pointPx, speedPxPerS, dwell, held }
}
```

Drive it from `requestVideoFrameCallback` (or rAF) at the camera rate. `createFaceLandmarker` uses the GPU delegate and falls back to CPU, 1 face, blendshapes + facial transformation matrixes on. Pass `aspect` (video width / height; default 16/9) so the iris geometry is metric.

### Calibration flow

```ts
const calib = new GazeCalibration();                // degree and ridge are auto-selected by leave-one-out unless given
for (const target of calibrationPoints(9)) {         // 9 (or 16, 5): inset 8% from the edges, snake order
  // show a dot at target (normalized 0..1); wait ~500 ms for the saccade; then for ~1 s:
  calib.addSample(frame, target);                    // ignores frames where an eye is closed (returns false)
}
const fit = calib.fit({ width: screenW, height: screenH });   // { ok, samples, looErrorPx, trainErrorPx }
// looErrorPx is mean leave-one-TARGET-out error in screen pixels: the honest accuracy number. Show it; offer a re-run if it is large.
localStorage.setItem('glance.calib', JSON.stringify(calib.toJSON()));   // later: GazeCalibration.fromJSON(JSON.parse(...))
tracker = new GazeTracker(calib, { width: screenW, height: screenH });
```

Recalibrate when the user moves a lot (the model includes head pose, face position and size, but it is still a 2D regression).

## API

| Export | What |
|---|---|
| `frameFromResult(r, tsMs, {aspect?})` | `LandmarkerResultLike` -> `GazeFrame \| null` (null: no face or no iris landmarks) |
| `createFaceLandmarker({wasmRoot, modelUrl})` | async; `{ detect(video, tsMs), close() }` |
| `GazeCalibration({ridge?, degree?})` | `addSample(frame, target)`, `fit(screen)`, `predict(frame)` (normalized, unclamped, null if unfitted), `toJSON()`, `fromJSON()`; also `sampleCount`, `isFitted`, `chosen`, `clear()` |
| `OneEuroFilter2D({minCutoff?, beta?, dCutoff?})` | `filter(p, tsMs)`, `reset()` |
| `GazeTracker(calib, screen, opts?)` | `update(frame)` -> `{ point, speedPxPerS, pointPx, dwell, held }`; `recentPoint(msAgo)`; `reset()` |
| `DwellDetector({radiusPx?, dwellMs?})` | `update(pointPx, tsMs)` -> `{ progress, fired, center }` |
| `GestureDetector(thresholds?)` | `update(frame)` -> `GestureEvent[]` |
| `GestureCalibrator` | `addNeutral(frame)`, `addGesture(name, frame)`, `result()` -> `{ thresholds, works, separation }` |
| `calibrationPoints(5 \| 9 \| 16)` | normalized targets |
| `simulateGazeFrames(path, opts)` / `simulateGaze` | synthetic frames (and true targets) for camera-free development |
| `DEFAULT_THRESHOLDS`, `FEATURE_NAMES`, `headPoseFromMatrix`, `assembleFeatures` | extras |

### GazeFrame

`tsMs`, `features` (below), `blinkLeft/blinkRight` (MediaPipe `eyeBlinkLeft/Right`; "left" is the USER's left eye), `jawOpen`, `browUp` (max of `browInnerUp` and the mean of `browOuterUpLeft/Right`), `head {yaw, pitch, roll}` radians (yaw + = nose toward image right, pitch + = looking DOWN, roll + = clockwise in the image; from the facial transformation matrix, with a rough landmark fallback if the matrix is missing), `faceBox {cx, cy, size}` normalized.

The webcam image is NOT mirrored here. If the app shows a mirrored preview, that is a display concern only; calibration absorbs signs.

## Features (`features.ts`, order is part of the contract, 14 values)

Landmarks (478-point mesh): iris centers 468 / 473; eye corners 33,133 (eye A, user's right) and 362,263 (eye B, user's left); lids 159/145 (A) and 386/374 (B). Each eye gets its own axis from corner to corner (both oriented image-left to image-right), so offsets are roll-invariant; everything is divided by eye width so it is distance-invariant; landmark x is scaled by `aspect` so geometry is metric.

| # | name | meaning |
|---|---|---|
| 0 | gx | mean iris offset along the eye axis from the corner midpoint / eye width (image-right +), roughly +-0.15 |
| 1 | gy | mean iris offset perpendicular to the axis from the corner midpoint / eye width (down +) |
| 2 | gly | mean iris offset perpendicular to the axis from the lid center (mid of upper/lower lid) / eye width |
| 3 | yaw | head yaw (rad) |
| 4 | pitch | head pitch (rad, + down) |
| 5 | roll | head roll (rad) |
| 6 | cx | face box center x (0..1) |
| 7 | cy | face box center y (0..1) |
| 8 | size | face box size (0..1), distance proxy |
| 9 | open | mean eyelid gap / eye width |
| 10 | ixA | eye A iris x offset |
| 11 | ixB | eye B iris x offset |
| 12 | iyA | eye A iris y offset |
| 13 | iyB | eye B iris y offset |

The first 5 are the "core" that the degree-2 polynomial expands (squares + cross terms).

## Calibration (`calibration.ts`)

Ridge regression, closed form, no deps. Features are standardized, optionally expanded to degree 2 (5 core features -> 15 extra terms) and standardized again; the intercept is not penalized. `ridge` is relative to the sample count. If `ridge` is omitted, `fit` picks from `{0.001 ... 1}` by leave-one-out; if `degree` is omitted it tries 1 and 2 and keeps the lower leave-one-out error (ties keep degree 1). The leave-one-out is exact (ridge hat-matrix identity) and leaves out all frames of one target at once, so near-duplicate frames of a dot do not flatter the number. Standardization stats use all data (a small optimistic bias). `looErrorPx` and `trainErrorPx` are mean Euclidean pixel errors. `fit` returns `ok: false` with fewer than 3 distinct targets.

## Smoothing (`filter.ts`)

One Euro filter (Casiez et al., CHI 2012) on the normalized point, vector speed shared by both axes. Defaults for ~30 fps webcam gaze in normalized units: `minCutoff 0.5 Hz`, `beta 4`, `dCutoff 1 Hz`. MEASURED on synthetic data only (noise sigma 2% of screen): fixation jitter drops to 0.30x of raw; after a 0.6-screen step the output reaches 73% in 1 frame, 97% in 3 frames, 100% in 5. If you feed pixels, scale `beta` by 1/screen size.

`GazeTracker` also: clamps to 0..1; freezes the point and dwell while either eye blink > `holdBlink` (default 0.4; `held: true`, dwell cannot fire) so a wink cannot drag the cursor or complete a dwell; resets the filter after a 700 ms gap; keeps 3 s of history. Eyelid motion starts slightly before the blink score crosses the threshold, so for click-on-wink use `tracker.recentPoint(350)` (the smoothed gaze from about 350 ms ago) rather than the live point.

## Dwell (`dwell.ts`)

`progress` 0..1 while the point stays within `radiusPx` (default 70) of the running center; `fired` is true once when it reaches 1 (`dwellMs` default 900); no re-fire until the point leaves the radius. Gap > 700 ms restarts.

## Gestures (`gestures.ts`)

Events: `wink_left`, `wink_right`, `double_wink_left`, `double_wink_right`, `brows_up`, `mouth_open_start`, `mouth_open_end`, `scroll {velocity}`.

Default thresholds (`DEFAULT_THRESHOLDS`):

| key | default | meaning |
|---|---|---|
| blinkClosed | 0.6 | eye closed at or above this blink score |
| blinkOpen | 0.35 | eye open again at or below this (hysteresis) |
| winkMinMs | 200 | shorter one-eye closures are ignored |
| winkMaxMs | 700 | longer closures are ignored (2 s hold does not fire) |
| doubleWinkGapMs | 500 | 2nd wink must START within this after the 1st ENDED |
| mouthOpen / mouthClose | 0.5 / 0.25 | jawOpen hysteresis |
| browsUp | 0.5 | browUp must hold 100 ms; releases at 60% |
| scrollGain | 1200 | px/s of scroll per rad/s of head-pitch rate while brows are up (+ = down; negative flips) |

Wink rules (the part that must not misfire): a wink is ONE eye closed past `blinkClosed` for `winkMinMs..winkMaxMs` while the other never closed; it is emitted when that eye REOPENS. Any frame with both eyes closed poisons the attempt and nothing can arm again until both eyes are open (this also handles the 1-3 frame skew between the eyes at the start and end of a natural blink). A double wink is emitted INSTEAD of the second `wink_*` (the first `wink_*` was already emitted). Scroll events come every frame while brows are up and |filtered pitch rate| exceeds a 0.12 rad/s dead zone; `velocity = scrollGain * sign(rate) * (|rate| - 0.12)`, capped at +-4000.

`GestureCalibrator` measures this user: record neutral frames (blinks allowed; it uses the 90th percentile), then frames of each gesture. `result()` returns personalized thresholds and `works` per gesture (false when the gesture does not separate from neutral, or a wink cannot isolate one eye). Leave non-working gestures unbound. Gestures that do not work keep the default thresholds.

## Simulation (`sim.ts`)

```ts
const { frames, targets } = simulateGaze(calibrationPoints(9), { msPerPoint: 1500, seed: 1 });
const frames2 = simulateGazeFrames(path, { fps: 30, noise: 1, seed: 1, naturalBlinkEveryMs: 4000,
  script: [{ atMs: 3000, kind: 'winkLeft', durationMs: 300 }, { atMs: 6000, kind: 'mouthOpen' }, { atMs: 9000, kind: 'browsUp' }] });
```

Deterministic per seed. Gaze maps to features via a smooth, mildly nonlinear model plus Gaussian noise, head wobble and optional scripted `blink | winkLeft | winkRight | mouthOpen | browsUp`. Calibrating on it gives ~23 px leave-one-out error on a 1920x1080 screen (MEASURED, synthetic). Real webcams will be much worse: 100-250 px is an ESTIMATE, not measured.

## Not verified against real MediaPipe output (check once live)

Everything here is tested on synthetic data and hand-built landmark meshes. Unverified on a real camera: (1) the matrix convention (column-major, y up), so whether `head.pitch` + really is "looking down" and scroll direction is right (nod once; flip with a negative `scrollGain`); (2) that `eyeBlinkLeft` is the user's left eye (wink once; if `GestureCalibrator` says `winkLeft: false` but `winkRight: true` for a left wink, swap); (3) real-world blink/wink score shapes (use `GestureCalibrator`); (4) `fit()` returns `Infinity` errors when `ok` is false (they serialize as null): check `ok`.

## Dev

```
pnpm --filter @glance/gaze test
pnpm --filter @glance/gaze check-types
```
