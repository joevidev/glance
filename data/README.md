# Glance dataset

Task: given a page's clickable elements, a noisy gaze point and a short command, return the element id the user means.
Built by `glance_lab.data.crawl` (Playwright + `packages/elements/extract.js`) then `glance_lab.data.build`. Everything here is reproducible from `data/sites/*.json` and seed `20261102`.

## Counts

| | sites | pages | cases |
|---|---|---|---|
| train | 28 | 41 | 2520 |
| test (LOCKED) | 8 | 15 | 360 |

Split is by site (registered domain), never by case: no site appears in both splits (checked in `tests/test_data_build.py`). `manifest.json` has `locked: true` and `test_sha256`; never regenerate or edit `test.jsonl`. `build` refuses to touch the test split once locked (it only rebuilds train from non-test sites).

Test sites (8, cases per site): craigslist.org (45), github.com (45), huggingface.co (45), linear.app (45), lobste.rs (45), npr.org (45), openstreetmap.org (45), w3schools.com (45).

Train sites (28): anthropic.com, arxiv.org, cloudflare.com, data.gov, docker.com, fireworks.ai, google.com, gutenberg.org, mailchimp.com, mozilla.org, nasa.gov, notion.so, paulgraham.com, pypi.org, python.org, react.dev, scrapingcourse.com, slack.com, stackoverflow.com, stripe.com, tailwindcss.com, theguardian.com, toscrape.com, usa.gov, weather.gov, wikihow.com, wikipedia.org, ycombinator.com.

Crawl: 50+ candidate sites, 36 yielded pages with >= 12 extractable elements. Dropped (bot walls, heavy consent/JS shells, near-empty DOM): bbc, reuters, apnews, nytimes, etsy, ebay, medium, kaggle, archive.org, reddit, npm, imdb, gov.uk, vercel, duckduckgo, saucedemo and others. Viewport 1440x900 (most) or 1280x800 (a deterministic few). No screenshots are stored.

## Case design

* Gaze is SIMULATED: element center + Gaussian noise, per-axis std `sigma` in {60, 120, 180} px (one third each), clamped to the viewport; resampled so the answer box lies within 2.5 sigma of the gaze point (solvable by design). Hard cases (adjacent links, dense menus) are kept.
* Measured Euclidean gaze error on the test set (mean / median px): sigma 60: 66.7 / 60.1; sigma 120: 131.8 / 124.6; sigma 180: 190.2 / 174.7. Published webcam gaze error is roughly 100-200 px (WebGazer, Papoutsaki et al., IJCAI 2016; WebEyeTrack, 2025); sigma 60 is optimistic, 120 and 180 match it.
* Commands are templates (no LLM), four types stored in `command_type`: `deictic` ("open that", "click this"), `role` ("the button", "click the search box"), `partial_name` (one or two words from the element's name: "the pricing one", "open the docs link"), `ordinal` ("the second link": rank among same-role elements in reading order, only first..fifth, only when the role has >= 2 elements). The answer always fits its command (checked at generation).
* Extra fields on each case: `page` (source file) and `n_command_matches` (how many elements the command alone fits). These are generation metadata: **systems must not put them in a prompt.**

Command mix (train / test): {"deictic": 798, "ordinal": 361, "partial_name": 735, "role": 626} / {"deictic": 95, "ordinal": 66, "partial_name": 103, "role": 96}. Sigma mix (train / test): {"60": 871, "120": 818, "180": 831} / {"60": 122, "120": 124, "180": 114}. Caps per site: train 90, test 45.

## Neither signal alone wins (test set, n=360)

| measure | value |
|---|---|
| nearest element to gaze (box distance, 0 inside) is the answer, sigma 60 / 120 / 180 | 35.2% / 27.4% / 17.5% (overall 26.9%) |
| same, nearest by element center (overall) | 27.5% |
| nearest-to-gaze accuracy by command type | {"deictic": 0.2526, "ordinal": 0.303, "partial_name": 0.2816, "role": 0.25} |
| command matches exactly one element (overall) | 41.7% |
| ... by type | {"deictic": 0.0, "role": 0.0, "partial_name": 0.8155, "ordinal": 1.0} |
| command only, random pick among matches: expected accuracy | 45.6% (by type {"deictic": 0.029, "role": 0.0598, "partial_name": 0.8719, "ordinal": 1.0}) |
| oracle: nearest-to-gaze among elements the command fits, sigma 60 / 120 / 180 (box distance) | 64.8% / 62.9% / 55.3% |
| same, by center distance | 66.4% / 62.1% / 57.0% |

Deictic cases are unsolvable from the command: gaze is the only signal, so their ceiling is about the nearest-element rate. Train statistics are in `manifest.json` (`train_stats`).

## Known limits

* Gaze is simulated i.i.d. Gaussian noise, not recorded webcam gaze: real error is correlated, head-pose dependent and biased. Results on it say how well a system fuses a noisy point with language, not how well it does on a live webcam.
* Commands are templated and short; real users say richer things. Ordinals follow the extractor's reading order (top to bottom, 12 px row grouping), only first..fifth, so they skew to the top of the page.
* `extract.js` caps a page at 80 elements (reading order). Dense pages (HN, lobste.rs, craigslist, github) are truncated, so lower-viewport links are not listed.
* Targets are drawn uniformly over a page's elements, so duplicated link names ("hide", "comments") produce ambiguous partial_name cases on purpose.
* Only 36 sites, 8 in test: site-clustered bootstrap intervals will be wide. lobste.rs (test) and Hacker News (train) have similar layouts, which may flatter generalization slightly.
* Pages are public snapshots taken on 2026-11-02 at the crawl time; consent banners were dismissed on a best-effort basis; some sites were blocked and are absent.
