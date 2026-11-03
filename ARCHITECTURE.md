# Glance — architecture and lanes

Polyglot monorepo: **Turborepo + pnpm** at the root. A package can be in any language. Turbo only needs a `package.json` with scripts (`build`, `test`, `dev`) in each; the Python and Rust packages wrap `uv` and `cargo` that way. Apps are what a user runs or what gets deployed; packages serve the apps (and may call apps).

```
apps/
  desktop/        Electron + electron-vite + React + Tailwind v4 + shadcn  (the product)
  web/            Next.js landing + results + disclosure (static export, built from results/summary.json)
packages/
  contracts/      JSON schemas, the intent PROMPT (shared by eval and app), TS types/zod, golden fixture
  elements/       extract.js: DOM element extractor used by the crawl AND the in-app browser
  gaze/           TS: MediaPipe iris/blendshapes, calibration (ridge), smoothing, wink/head gestures
  brain/          TS: Fireworks client + intent call used by the desktop app
  ui/             TS: shadcn components + Tailwind v4 liquid-glass theme (black and white)
  input/          Rust (optional): native mouse helper (move, click, scroll, drag) as a child process
  lab/            Python (uv): crawl, dataset, systems, stats, LoRA training  <- the 40% of the score
  typescript-config/  shared tsconfig
data/             crawl + dataset (committed JSON)      results/   rows, summary.json, charts, train status
```

## The seam that keeps the demo honest

The eval and the app render the **same prompt** (`packages/contracts/prompts/intent.txt`) from the **same element format** (`extract.js`). `packages/contracts/fixtures/prompt_golden.json` is the contract: Python (`glance_lab/prompt.py`) and TypeScript (`packages/contracts/src/prompt.ts`) must both reproduce it byte for byte.

## Lanes (disjoint ownership)

| Lane | Owns (only edit these) | Priority |
|---|---|---|
| lab-train | `packages/lab/glance_lab/train/**`, `packages/lab/tests/test_train*`, `results/train/**` | 1 — Fireworks, slowest |
| lab-data | `packages/lab/glance_lab/data/**`, `packages/lab/tests/test_data*`, `data/**`, `packages/elements/**` | 1 — blocks all the others |
| lab-systems | `packages/lab/glance_lab/systems/**`, `.../stats/**`, `packages/lab/tests/test_systems*`, `test_stats*`, `results/**` except `results/train/` | 2 |
| desktop | `apps/desktop/**`, `packages/ui/**`, `packages/brain/**`, `packages/contracts/src/**`, `packages/input/**` | 3 |
| gaze | `packages/gaze/**` | 3 |
| root files, `.env`, lockfiles, `ARCHITECTURE.md`, `package.json`, `turbo.json` | Joel and the coordinating session | — |

## Rules for every agent

1. **No git.** Joel makes every commit. Do not run `git add/commit/push`.
2. **Never read, print or `cat` `.env`.** Python loads keys in-process through `glance_lab.common.require_env("NAME")`. Never write a key into any file, log or message.
3. **Only edit your owned paths.** Need a change elsewhere? Say so in your final report instead.
4. **Dependencies:** do not run `pnpm add` / `pnpm install` unless you are the `desktop` agent. Python: prefer the standard library and what is installed (`uv run python -c "import X"` to check); `uv add` only if really needed.
5. **The test set is locked once `data/dataset/manifest.json` says `"locked": true`.** Never regenerate or edit it. Never train on it. One saved row per case per system in `results/rows/<system>.jsonl` (schema: `packages/contracts/schema/row.schema.json`).
6. **Honesty:** never fabricate or cherry-pick a result, never weaken a baseline, report failures and costs. Mark measured vs estimated.
7. **Report back with numbers**: files written, tests run and passing, rows produced, what is blocked. Keep status in `results/<lane>-status.md` if your task is long.

## Times (PT, today)

Dataset locked **13:00**. LoRA training launched **13:20**. All systems scored **14:45**. Stats, charts, README **15:15**. Submit **15:30–16:00**. Hard close **16:30**.
