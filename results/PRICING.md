# Pricing used for cost_usd (looked up 2026-11-02)

Cost per call = (prompt_tokens x input price + completion_tokens x output price) / 1,000,000.
Token counts come from the provider's `usage` field (measured). Prices are list prices read from the
provider pages on 2026-11-02 (looked up, not negotiated). Reasoning tokens are billed as output and are
already inside completion_tokens. The cached-input discount is NOT applied, so costs are upper bounds.

| System | Model id | Input USD / 1M tokens | Output USD / 1M tokens | Source |
|---|---|---|---|---|
| open_cmd_only, open_base, harness_top5, harness_vote (FINAL, same base as the LoRA) | accounts/fireworks/models/glm-5p3 (Fireworks serverless) | 1.40 | 4.40 | https://fireworks.ai/models/fireworks/glm-5p3 (cached input 0.26, not applied) |
| open_base_flash (extra data point only, not in the comparison) | accounts/fireworks/models/glm-5p3-flash | 0.15 | 0.50 | https://fireworks.ai/models/fireworks/glm-5p3-flash (cached input 0.03, not applied) |
| frontier | gpt-6-astra (OpenAI) | 10.00 | 50.00 | https://developers.openai.com/api/docs/pricing (standard tier, short context) |
| raw_gaze, nearest | none (local geometry) | 0 | 0 | no model call |
| lora | accounts/fireworks/models/glm-5p3 + LoRA (rank 16) | 4.86 (prefill) | 12.15 (sample) | Fireworks serverless-training price table (fireworks.ai/pricing, sampling rates). cost_usd in lora.jsonl is lab-train's ESTIMATE from that table (not a serving bill); latency_ms is sampled inside a training session, NOT serving latency |

Other OpenAI prices seen on the same page (standard tier, per 1M in/out): gpt-6.1-sol 2/10, gpt-6.1-terra 1/5, gpt-6-sol 2/10,
gpt-5.5 5/30, gpt-5.4 2.5/15, gpt-5.4-mini 0.75/4.5.

Why gpt-6-astra is the frontier system: it is the first model in the page's "Flagship models" section and has the
highest standard price of the general chat models (gpt-*-pro variants are reasoning-heavy pro tiers, not general chat). The page
does not explicitly call it the flagship; this is our reading. It answered a verification call with the exact id `gpt-6-astra`.

## Run settings (identical for every open-model system; frontier differs only where the API forces it)
- Prompt: packages/contracts/prompts (build_prompt), one user message, no system message. Same text for open and frontier systems.
- Open model: temperature 0 (harness_vote: 5 samples at 0.7), max_tokens 8192. GLM-5.3 models are thinking models (reasoning cannot be disabled; the reasoning trace is billed as output tokens and counted in cost). A reply cut off at max_tokens has no answer and is scored wrong (reported as `n_truncated_length`).
- Frontier gpt-6-astra: temperature is NOT sent (the model rejects any value but the default 1, so it is not run at temperature 0), `max_completion_tokens`=4096 instead of `max_tokens` (0 of 360 replies were truncated).
- Transient errors (429, connection, 5xx) are retried with backoff (14 in-call attempts, then up to 6 extra passes) and are never scored as wrong; the count of rows that needed retries is in summary.json systems.*.n_rows_retried. Non-transient errors and unparseable replies are wrong answers.
- Fireworks glm-5p3-flash LoRA-training capacity was unavailable (HTTP 409), so lab-train switched the base to glm-5p3; the open baselines were rerun on glm-5p3.

## Added 2026-11-02 ~15:40 PT with the OpenAI key only (Fireworks was suspended)
Same 360 locked cases, same prompt (`build_prompt`, gaze + command), same run settings as `frontier` (temperature not sent, `max_completion_tokens` 4096). Prices are the list prices in the table above; cost = measured `usage` tokens x list price, no cached-input discount.

| System (rows file) | Model id | Input / Output USD per 1M | Total for 360 | Per 1,000 | Purpose |
|---|---|---|---|---|---|
| frontier_rerun | gpt-6-astra | 10.00 / 50.00 | $4.42 | $12.27 | Second run of the same system: run-to-run noise floor (the API forces temperature 1) |
| frontier_sol | gpt-6.1-sol | 2.00 / 10.00 | $0.89 | $2.47 | Cheaper closed model |
| frontier_g54 | gpt-5.4 | 2.50 / 15.00 | $1.04 | $2.88 | Mid-price closed model |
| frontier_g54mini | gpt-5.4-mini | 0.75 / 4.50 | $0.32 | $0.88 | Small closed model, compared with the small open flash model |

Total spent on these four runs: $6.66. All four: 360/360 rows, 0 API errors, 0 unparseable replies, 0 truncations. Run log: `results/logs/openai_extra2.log` (a first launch was stopped at 303 cached calls after a false alarm in our own monitor, then resumed from cache).
