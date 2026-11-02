# Glance

**Operate your agent with your eyes.**

Your eyes are the cursor. Your voice is the command.
Say "open that" and your agent knows which "that."

Glance is a macOS app. The webcam tracks where you look and moves the real cursor; a wink clicks, a nod scrolls.
When you add a short spoken command, an agent running a model on Fireworks picks the exact on-screen element you mean
from where you were looking and what you said, and acts on it, even when the eye tracker is off by 100 to 200 px.

Agents can hear you. Glance lets you point.

### The agent

| | What it does | State |
|---|---|---|
| One step per command | Reads your gaze, your command and the page's elements, picks one, shows a ring on it, clicks | Built; the benchmark measures this step |
| Multi-step tasks | "Schedule it": observe, decide, act, check, repeat until done, confirming before any send or save | In progress; not part of the benchmark |

Built at the Fireworks: Deploy Buildathon (Microsoft & NVIDIA), San Francisco, 2026-11-02.

## Why it works

Webcam eye tracking is good enough to point near something, not at it. Voice alone is ambiguous: a page has dozens of "that"s.
Neither signal is enough alone. Together they are.

| Signal | What it gives | What it lacks |
|---|---|---|
| Gaze | Where on screen | Precision (100 to 200 px off), so it lands between elements |
| Voice | What to do | Which element ("open that") |
| **Gaze + voice + the screen's elements, in one model call** | The element | |

Gaze never clicks by itself. A click always needs a wink, a spoken command or a dwell, so looking around is safe.

## How it works

```
LAPTOP (local, private)
  Webcam -> MediaPipe Face Landmarker (iris, blendshapes, head pose)
         -> personal 9-point calibration (ridge fit, seconds)
         -> smoothed cursor + gestures (wink, nod, mouth) -> native mouse helper (Rust)
  Mic    -> speech to text (push to talk, Option+Space)
  Page   -> element extractor (id, role, name, box)

FIREWORKS (the brain)
  gaze point + command + elements (text) -> open model -> {"target": <element id>}

LAPTOP
  ring + name tag on the chosen element -> click
```

The eyes run locally on purpose: the cursor needs a frame every ~33 ms, a cloud call takes hundreds of ms,
and sending face video off the machine is a privacy problem. Only text (a gaze point, a command and element names)
goes to the model. No images leave the laptop.

The app and the benchmark share one prompt (`packages/contracts/prompts/intent.txt`) and one element format
(`packages/elements/extract.js`), pinned by a golden fixture that Python and TypeScript must both reproduce byte for byte.
What we measure is what the app runs.

## Controls

| Action | Gesture |
|---|---|
| Move | Look (smoothed gaze moves the real cursor) |
| Left click / right click | Wink left / wink right |
| Double click | Double wink |
| Drag | Open mouth = press, move your gaze, close mouth = drop |
| Scroll | Raise brows, nod up or down |
| Radial menu | Hold your gaze about 1 s |
| Voice command | Option+Space, speak, Option+Space |
| Pause tracking | Alt+Shift+P |

Onboarding runs a 9-point calibration, reports its leave-one-out error in px, and tests which gestures work for your face.
Calibration stays in Electron's user-data directory, never in the repo. Full desktop guide: `apps/desktop/README.md`.

## The benchmark

**Task:** gaze point + short command + the clickable elements on screen -> the element the user means.

- **Data:** Playwright crawl of 36 public sites, 56 pages. Split by site: 28 train sites (2,520 cases), 8 test sites (360 cases).
  The test set is locked (`data/dataset/manifest.json`, `test_sha256`) and was never trained on.
- **Gaze noise:** sampled around the target at levels taken from published webcam error (WebGazer, WebEyeTrack).
- **Commands:** from templates (deictic, ordinal, relational), not written by the frontier model we compare against.
- **Systems, same test cases and prompt:**

| System | What |
|---|---|
| `raw_gaze` | Element under the gaze point |
| `nearest` | Element nearest to the gaze point |
| `open_cmd_only` | Open base model, command only (no gaze) |
| `open_base` | Open base model on Fireworks, gaze + command |
| `frontier` | OpenAI frontier model, gaze + command (the required frontier baseline) |
| `harness_top5`, `harness_vote` | Harness ideas on the open base model |
| LoRA | Open model fine-tuned with Fireworks serverless training (rank 16, 1 epoch, 2,520 cases) |

- **Metrics:** top-1 accuracy, cost per 1,000 commands, latency.
- **Statistics:** McNemar on each change against its baseline, and a cluster bootstrap that resamples whole sites (5,000 draws, 95% interval).
  A gain counts only if both agree.

## Results

Filled in from `results/summary.json` once all systems are scored. Nothing here is an estimate unless it says so.

| System | Top-1 accuracy | Cost / 1,000 commands | Latency p50 |
|---|---|---|---|
| `raw_gaze` | [pending] | | |
| `nearest` | [pending] | | |
| `open_base` | [pending] | | |
| `frontier` | [pending] | | |
| LoRA | [pending] | | |

## Limits

- **The benchmark gaze is simulated** (target plus Gaussian noise), not recorded from real eyes. It tests the model's choice, not the eye tracker.
- **Eye tracking and gestures are verified with synthetic camera frames.** Wink, brow and mouth thresholds and the head-pose sign need real faces and real lighting.
- **The app serves the base model, not the LoRA.** Serving a LoRA needs an hourly-billed dedicated deployment. LoRA latency is measured inside the training session, which is not serving latency, and is labeled as such.
- **One LoRA per person is the roadmap, not a result.** We have no honest per-user data from today.
- Calibrates and drives the primary display only.
- Dense or canvas-based pages expose few clickable elements, so there is less for the model to choose from.

## Setup

Requires macOS, Node 22+, pnpm, Rust (`cargo`) and `uv`.

```bash
pnpm install
(cd packages/lab && uv sync && uv run playwright install chromium)
cp .env.example .env     # then fill in FIREWORKS_API_KEY and OPENAI_API_KEY
```

macOS permissions: Camera, Accessibility and Microphone (details in `apps/desktop/README.md`).

## Run

```bash
pnpm desktop                            # the app
GLANCE_FAKE_GAZE=mouse pnpm desktop     # the mouse stands in for the eyes (no camera)
pnpm web                                # landing + results
pnpm test                               # all test suites
```

Benchmark, in order (each step is a script in `packages/lab/package.json`):

```bash
pnpm lab crawl && pnpm lab dataset      # public sites -> locked train/test split
pnpm lab run-systems                    # all non-trained systems on the test set
pnpm lab train                          # LoRA on Fireworks serverless training, scores the test set
pnpm lab stats                          # McNemar + cluster bootstrap, charts, results/summary.json
```

## Monorepo

Turborepo + pnpm. A package can be written in any language; Turbo sees it through the scripts in its `package.json`.

| Path | Language | What |
|---|---|---|
| `apps/desktop` | TypeScript (Electron, React, Tailwind v4, shadcn) | The product |
| `apps/web` | TypeScript (Next.js) | Landing + results page |
| `packages/gaze` | TypeScript | Iris and face features, calibration, smoothing, gestures |
| `packages/brain` | TypeScript | Calls the model on Fireworks to pick the element |
| `packages/contracts` | JSON Schema + TypeScript | Schemas, the shared intent prompt, golden fixture |
| `packages/elements` | JavaScript | `extract.js`: element extractor, shared by the crawl and the app |
| `packages/ui` | TypeScript (shadcn) | Liquid-glass black-and-white design system |
| `packages/input` | Rust | Native mouse helper (move, click, scroll, drag) |
| `packages/lab` | Python (uv) | Benchmark and training: crawl, dataset, systems, stats, LoRA |
| `data/`, `results/` | JSON | Dataset, saved rows per case per system, summary, charts |

See `ARCHITECTURE.md` for ownership and rules.

## Disclosure

- Everything in this repo was built during the event on 2026-11-02.
- AI coding assistant: Claude Code was used throughout, including parallel sub-agents.
- Third-party components:
  - Google MediaPipe Face Landmarker;
  - Electron, electron-vite, React, Tailwind, shadcn/ui, Next.js;
  - Playwright; the Fireworks and OpenAI SDKs;
  - the McNemar and cluster-bootstrap approach from the organizers' sample submission (`sinanuozdemir/ai-experiments`).
- Webcam gaze error levels used in the benchmark come from WebGazer and WebEyeTrack (arXiv 2508.19544).
- No face images or calibration data are stored in this repo.
