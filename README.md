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

## Results at a glance

360 held-out commands from 8 sites the models never saw, 13 systems, the same cases and the same prompt for all (details and limits below).

- **Eyes add real information.** Gaze + voice beats voice alone: **56.4% vs 45.8%, +10.6 points** (McNemar p = 2e-5). Raw gaze alone gets 8.3%, the nearest element to the gaze 26.7%.
- **An open model with no training matches the frontier.** Fireworks `glm-5p3-flash` 58.9% vs OpenAI `gpt-6-astra` 57.2% (no reliable difference), at **$0.65 vs $12.20 per 1,000 commands**. The cheapest OpenAI model that matches it (`gpt-6.1-sol`, 57.2%) costs $2.47, so about 3.8 times cheaper there.
- **It beats the small closed model at a lower price.** `glm-5p3-flash` vs `gpt-5.4-mini`: **+16.1 points** (58.9% vs 42.8%, p < 0.0001), $0.65 vs $0.88.
- **The benchmark is hard to fool.** Test set locked by SHA-256 and split by site, McNemar plus a site-level bootstrap (a gain counts only if both agree), a non-model baseline, a noise-floor rerun of the frontier model (56.9% vs 57.2%), and every failure reported.
- **What did not work, reported anyway.** Our LoRA did not beat its base (52.8% vs 56.4%, -3.6, not called real; it did cut format errors from 26 to 0). A top-5 filter scored 39.7%. A distance prompt hurt the frontier model (-2.8, p = 0.013). The open reasoning models are slower (4.4 s vs 1.6 s): no latency win.

## Why it works

Webcam eye tracking is good enough to point near something, not at it. Voice alone is ambiguous: a page has dozens of "that"s.
Neither signal is enough alone. Together they are.

| Signal | What it gives | What it lacks |
|---|---|---|
| Gaze | Where on screen | Precision (100 to 200 px off), so it lands between elements |
| Voice | What to do | Which element ("open that") |
| **Gaze + voice + the screen's elements, in one model call** | The element | |

Gaze never clicks by itself. A click always needs a wink, a spoken command or a deliberate action on the wheel, so looking around is safe. Only the normal macOS cursor follows your eyes; Glance draws a circle only while the wheel is open.

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
| Action wheel (radial menu) | Close BOTH eyes for about 1 s (0.7 s minimum; a blink or a wink does not count). It opens where you were looking. Look at an item for 1 s to choose it; close your eyes again, press Esc, or look away for 2 s to dismiss. The old 1 s stare is an opt-in toggle on the dashboard |
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

360 held-out commands from 8 sites never used in training. Source: `results/summary.json` and `results/rows/*.jsonl` (one row per case per system). Cost = measured tokens times list price (`results/PRICING.md`); the LoRA's cost and latency come from a training session and are **estimates**, not serving numbers.

| System | Top-1 accuracy | Cost / 1,000 commands | Latency p50 |
|---|---|---|---|
| `raw_gaze` (element under the gaze point) | 8.3% | $0 | local |
| `nearest` (nearest element to the gaze) | 26.7% | $0 | local |
| `open_cmd_only` (glm-5p3, command only) | 45.8% | $5.62 | 3.0 s |
| `harness_top5` (glm-5p3, 5 nearest elements only) | 39.7% | $6.28 | 4.6 s |
| LoRA on glm-5p3 (**not better than its base**) | 52.8% | $5.79 (estimate) | 1.6 s (training session, not serving) |
| `frontier_geo` (gpt-6-astra, distance prompt) | 54.4% | $13.79 | 1.5 s |
| `open_base` (glm-5p3, gaze + command) | 56.4% | $7.76 | 4.4 s |
| `frontier` (gpt-6-astra, gaze + command) | 57.2% | $12.20 | 1.6 s |
| `open_base_flash` (untrained glm-5p3-flash, extra data point) | 58.9% | $0.65 | 2.8 s |
| `frontier_rerun` (gpt-6-astra, second run, noise floor) | 56.9% | $12.27 | 1.6 s |
| `frontier_sol` (gpt-6.1-sol) | 57.2% | $2.47 | 1.4 s |
| `frontier_g54` (gpt-5.4) | 51.7% | $2.88 | 0.7 s |
| `frontier_g54mini` (gpt-5.4-mini) | 42.8% | $0.88 | 0.6 s |

Key comparisons (McNemar exact test and a site-cluster bootstrap, 5,000 draws; a gain counts only if both agree):

- Gaze + command vs command only (open model): **+10.6 points**, p = 2e-5, CI +4.7 to +16.4. Real.
- LoRA vs its base: **-3.6 points**, p = 0.11, CI -6.7 to -0.6. The tests disagree: not called real. The LoRA removed format errors (0 unparseable vs 26).
- Untrained flash vs `gpt-6-astra`: +1.7 points, p = 0.21. No reliable difference, at about 5% of its cost ($0.65 vs $12.20). But `gpt-6.1-sol` scores the same 57.2% at $2.47, so against the best-value OpenAI model flash is about 3.8 times cheaper, not 19 (+1.7 points, p = 0.18, no reliable difference).
- Untrained flash vs `gpt-5.4-mini` (small closed model, $0.88): **+16.1 points**, CI +11.4 to +21.7, p < 0.0001. Real, at a lower cost.
- Run-to-run noise floor: a second run of `gpt-6-astra` scored 56.9% vs 57.2% (5 discordant cases of 360, p = 1.0). The API forces temperature 1, and the frontier baseline is stable.
- Distance prompt on the frontier model: **-2.8 points**, p = 0.013. It hurt.

Not run because our Fireworks account reached its monthly spending cap at about 13:48 PT and was suspended: `harness_vote` (46 of 360 rows lost), `open_base_geo`, a second LoRA, and a LoRA on Muse Glimmer 30B (prepared, not launched). They are listed as `not_run` in `summary.json`. The demo app uses OpenAI `gpt-6-astra` for the model call (`GLANCE_PROVIDER=openai`).

## Limits

- **The benchmark gaze is simulated** (target plus Gaussian noise), not recorded from real eyes. It tests the model's choice, not the eye tracker.
- **Eye tracking and gestures are verified with synthetic camera frames.** Wink, brow and mouth thresholds and the head-pose sign need real faces and real lighting.
- **The app never serves our LoRA, and the demo model is OpenAI `gpt-6-astra`** (Fireworks account suspended at its spending cap; the app now defaults to OpenAI, and `GLANCE_PROVIDER=fireworks` selects `glm-5p3` on Fireworks). Serving a LoRA needs an hourly-billed dedicated deployment. LoRA latency is measured inside the training session, which is not serving latency, and is labeled as such.
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
pnpm web                                # landing + /try (in-browser demo) + results (copies results/summary.json first)
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
| `apps/web` | TypeScript (Next.js 16, static export) | Landing, `/try` (in-browser demo: webcam gaze with the same `@glance/gaze` code, a 9-point calibration, a "fine-tune my gaze" refit of your personal mapping, and an explorer of 24 real benchmark cases; runs locally, nothing uploaded; camera path verified with synthetic frames and a fake camera only), `/results` (built from `results/summary.json`, never hand-typed numbers) and `/disclosure`. Not deployed |
| `packages/gaze` | TypeScript | Iris and face features, calibration, smoothing, gestures |
| `packages/brain` | TypeScript | Calls the model on Fireworks to pick the element |
| `packages/contracts` | JSON Schema + TypeScript | Schemas, the shared intent prompt, golden fixture |
| `packages/elements` | JavaScript | `extract.js`: element extractor, shared by the crawl and the app |
| `packages/ui` | TypeScript (shadcn) | Liquid-glass black-and-white design system |
| `packages/input` | Rust | Native mouse helper (move, click, scroll, drag) |
| `packages/lab` | Python (uv) | Benchmark and training: crawl, dataset, systems, stats, LoRA |
| `data/`, `results/` | JSON | Dataset, saved rows per case per system, summary, charts |

See `ARCHITECTURE.md` for ownership and rules.