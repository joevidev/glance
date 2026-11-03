# LORA_MUSE (Muse Glimmer 30B) PREPARED OFFLINE, NOT LAUNCHED (written 14:09 PT)
Account `buivo` is suspended (HTTP 412); no Fireworks call was made for this prep (only the Hugging Face tokenizer download, which is NOT gated).

VERIFIED (docs or measured offline):
- Base `accounts/fireworks/models/muse-glimmer-30b`, tokenizer `meta-models/Muse-Glimmer-30B` (public, 202,048 vocab). Docs page muse-glimmer.md: LoRA SFT free via UI and Serverless Training API until 11/30 (jobs started before 2026-12-01 PT), no card; RL/DPO/full-parameter/deployments/inference are not covered; default LoRA rank 8; serverless default max seq len 2,048 (longer rows refused); in-session sampling is "priced separately at the published per-token rates".
- Muse needs a DIFFERENT format than GLM (ATEM chat protocol). Implemented as `Fmt("muse")` in glance_lab/train/core.py:
  context = `<|begin_of_text|><|start|>system<|message|>You are a helpful AI assistant.\nKnowledge cutoff: 2026-01-04.\nCurrent date: 2026-11-02.\n\nReasoning strength: high.\n\n# Valid recipients: "self", "user".<|eot|><|start|>user<|message|>{plain prompt}<|eot|><|start|>assistant`
  weighted target = ` to=user<|message|>{"target": N}<|eot|>` (10 tokens, plain JSON, NO `</think>`); sampler stop token = `<|eot|>` (id 200008).
  Checked on 201 cases (200 train + golden): the context text equals `tokenizer.apply_chat_template(add_generation_prompt=True)` and the full token sequence equals the tokenized full template (0 mismatches). The date is fixed to 2026-11-02 so train and inference match.
- Prompt text: the same plain prompt (build_prompt variant plain); only the chat wrapper differs. Rows: results/rows/lora_muse.jsonl, system `lora_muse`; status results/train/status_muse.json, summary_muse.json. Same locked-dataset checks (locked flag, test sha256, disjoint ids), retry wrapper, 40-step checkpoints, rank 8 default, lr 1e-4 constant, batch 16, 1 epoch.
- Dry-run: 2520 train cases, 1,900,581 tokens, 158 steps, 0 dropped. Longest sequence ~1,707 tokens; over 2,048: 0; over 4,096: 0; over 8,192: 0 (the 2,048 serverless default would also suffice). Scoring 360 test cases: 414,072 prompt tokens.
- Cost: training $0 under the free promo (at the serverless.md table rate it would be 1.90M x $5.86/1M = $11.14). Scoring estimate with the serverless.md table prices for Muse Glimmer 30B (prefill $1.96, sample $4.88 per 1M; both are on the Fireworks docs table): about $0.84, assuming ~14 output tokens per case. The aggregator prices ($0.35 / $1.50) were NOT used.
- 16 offline tests pass (`uv run pytest -q tests/test_train*`); the GLM path is unchanged (dry-run still 1,890,970 tokens).

UNKNOWN (cannot test while suspended):
- Whether the free-training promo applies to this account once restored, and whether the SDK default alpha 32 at rank 8 behaves well (not tuned).
- Whether Muse (a reasoning model, "Reasoning strength: high") answers directly after training; the target skips any reasoning channel, the same idea as GLM v1. Untrained Muse behaviour, s/step, checkpoint save time and capacity are unmeasured.
- Sampling is billed at table rates (not free); training-sampler latency is still not serving latency. Tuned Muse LoRAs cannot be served on serverless inference, only through an hourly-billed deployment (NOT created).
- Fair-baseline question: if lora_muse is reported, an open_base on Muse (same base) would be needed from lab-systems.

LAUNCH COMMAND (only when the coordinator says the account is back; first check the models-list call returns 200):
`cd packages/lab && nohup uv run python -m glance_lab.train.run --base-model accounts/fireworks/models/muse-glimmer-30b > ../../results/train/run_muse.log 2>&1 &`
Expected: 158 steps, time per step unknown (GLM-5p3 was 8.8 s/step), then ~1-2 min scoring. Deadline math: a launch must happen at least ~35 min before 14:45 PT only if steps stay near 9 s.

# GEO DECISION LOG
- 13:51:59 PT: the waiter saw `VERDICT: NO-GO` and did not launch lora_geo. At 13:52 results/geo_validation.md was rewritten to `VERDICT: INVALID` (lab-systems: the validation run is void because Fireworks returned HTTP 412 "Account buivo is suspended, possibly due to reaching the monthly spending limit..." for the geo calls (300/300) and 54/300 plain calls). INVALID is neither GO nor NO-GO: lora_geo was NOT launched, nothing was spent on it. v1 training/scoring finished at 13:40, before the 412s appeared.
- Because of the 412 account suspension, any Fireworks call from this lane would likely fail until the account is restored; the auto-launch waiter (glance_lab.train.wait_and_launch_geo) was STOPPED at 13:53 on the coordinator's order; nothing launches automatically. Launch is manual, only after a new validation writes `VERDICT: GO` AND billing is restored (a models-list call returning 200; at 13:52:56 it still returned 412). The leaked flash session ts-a68b32b079324c94b3ffcda39151c19b cannot be deleted while the account is suspended (nothing trained in it).

# LORA v1 OUTCOME (honest summary, as relayed by the coordinator from lab-systems' comparison)
- LoRA v1 (plain prompt, glm-5p3): 52.8% (190/360) vs the untuned base glm-5p3 at 56.4%. Unparseable outputs: 0 for the LoRA vs 26 for the base. Discordant pairs: 22 vs 35 (the larger count favours the base; pair counts as given by the coordinator, not recomputed by me). Exact two-sided binomial test on 22 vs 35 gives p = 0.111 (recomputed by me), i.e. not significant. So v1 did not beat the base on accuracy; it fixed the output-format failures but not the choice of element.
- CORRECTION: v1 training loss spiked to 2.35 at step 124 (1.86 at step 121, about 0.4-0.5 until step 137). It was NOT normal noise; the 10-step-sampled curve in the RESULT section below hides it. Constant lr 1e-4 with grad clip 1.0 is the suspected cause (unverified).

# LORA_GEO (v2) PREPARED, NOT LAUNCHED (13:43 PT)
- Run only if results/geo_validation.md first line is exactly `VERDICT: GO` (criterion by lab-systems: geo beats plain by >= 5.0 points on glm-5p3 on the train-site validation holdout). If `VERDICT: NO-GO`: do not launch.
- Command: `cd packages/lab && nohup uv run python -m glance_lab.train.run --prompt-variant geo --lr 5e-5 --lr-schedule linear > ../../results/train/run_geo.log 2>&1 &`
- Same base (glm-5p3), rank 16, alpha 32, batch 16, 1 epoch, 158 steps; lr 5e-5 decaying linearly to ~0 (lr * (158-step)/158); same locked-dataset checks, retry wrapper, 40-step checkpoints. Outputs: results/rows/lora_geo.jsonl (system `lora_geo`), results/train/status_geo.json, summary_geo.json. v1 files untouched.
- Dry-run (measured): geo train tokens 2,249,368 vs 1,890,970 plain (+19%) -> train cost ESTIMATE 2.249M x $14.58/1M = $32.80. Scoring 360 cases: geo prompt 499,503 tokens (avg 1388/case) vs plain 421,360 (avg 1170) -> ~$2.46 estimate. Expected time ~25-27 min training (slightly slower than v1's 8.8 s/step because of ~19% more tokens) + ~1.5 min scoring.

# DECISION (13:15 PT): BASE MODEL = accounts/fireworks/models/glm-5p3  (NOT glm-5p3-flash)
- Why: at the real-run start (12:42 PT) glm-5p3-flash returned 409 capacity_exhausted again (earlier it had needed 347 s to get a session and ran ~44 s/step + 63 s per checkpoint save in the smoke); a network outage at ~13:03 then killed the run at step 0. glm-5p3 got capacity within seconds in every probe and ran ~9 s/step on the smoke. Coordinator ordered the fallback at 13:15.
- Same GLM-5.3 family, same tokenizer (zai-org/GLM-5.3-Flash tokenizer verified to work with it in the smoke) and chat template. lab-systems must use `accounts/fireworks/models/glm-5p3` for the open_base baseline.
- Real run launched 13:15:08 PT: 2520 train cases, 1.89M tokens (measured by --dry-run), 158 steps, rank 16, alpha 32, lr 1e-4, batch 16, 1 epoch. Cost ESTIMATE: 1.89M x $14.58/1M = ~$27.6 train + ~$1.5 scoring (glm-5p3 prices: prefill $4.86, sample $12.15, train $14.58 per 1M).
- MEASURED at 13:16: 9.2-10.3 s/step on the real data (16 cases x ~750 tokens), so 158 steps ~ 25 min: training ends ~13:41, scoring of 360 cases ~2-4 min after, expected rows ~13:45. Loss/response-token: step 1 = 2.55, step 5 = 0.29.
- Robustness: every SDK call wrapped in retry_call (exponential backoff 5-60 s on connection errors, timeouts, 409/429, 5xx; logged in status.json `retries`/`errors`); sampler checkpoint every 40 steps (jobs.log); resume with `--score-only --snapshot <path>`; session kept open if the run fails after a checkpoint exists. Caveat: retrying fwd/bwd or optim after an ambiguous failure could apply an update twice (rare, accepted).
- NOTE: the figures further down that say "flash ... ~2030 train" are from before this decision and the dataset lock (final: 2520 train / 360 test).

# RESULT (13:40 PT): glm-5p3 LoRA, test accuracy 190/360 = 52.8% (measured)
- Run: run-fd1f9b4e7b5b447a8c8731f4d43e9393, 158 steps, 1429 s train (8.5-9.2 s/step, measured), final checkpoint `buivo/run-fd1f9b4e7b5b447a8c8731f4d43e9393/glance-lora-v1-fab941eb` (checkpoints at steps 40/80/120 in jobs.log). Save 8.9 s, sampler startup 0.03 s, scoring 360 cases at concurrency 8 in 73.6 s. No retries needed (0 transient errors), 0 unparseable, 0 sample errors. Session deleted after the run.
- Rows: results/rows/lora.jsonl, 360 rows, ids identical and in the same order as data/dataset/test.jsonl (sha256 checked against manifest before running). Accuracy by sigma (measured): 60 px 54.1% (n=122), 120 px 53.2% (n=124), 180 px 50.9% (n=114).
- Sampling latency per row (training sampler, NOT serving latency): median 1572 ms, p95 2210 ms at concurrency 8.
- Cost ESTIMATES (price table, not billed): train 1,890,970 tokens x $14.58/1M = $27.57; scoring $2.0828 (sum of per-row cost_usd, prefill $4.86 + sample $12.15 per 1M). The run process had loaded the flash prices, so per-row cost_usd were recomputed after the run with glm-5p3 prices (recomputation under flash prices reproduced the stored values for all 360 rows first).
- Loss per response token by step (measured; 1 batch of 16 each): 1:2.55, 11:0.21, 21:0.20, 31:0.19, 41:0.24, 51:0.14, 61:0.13, 71:0.18, 81:0.13, 91:0.17, 101:0.13, 111:0.16, 121:1.86, 131:0.46, 141:0.20, 151:0.16, 158:0.14.
- SURPRISING: training loss spiked at steps ~121-137 (1.86 at step 121, 2.35 at 124, ~0.4-0.5 until step 137) then recovered to ~0.15-0.25. Constant lr 1e-4, grad clip 1.0, no warmup; not investigated (no time). Final-checkpoint accuracy could differ from step-80/120 checkpoints; those were NOT scored (would be test-set selection anyway).
- Loss floor ~0.1-0.2/token mostly reflects the uncertain choice of element id; format (`</think>{"target": N}`) was learned within ~5 steps.
- The flash smoke (2 steps, synthetic data) is in smoke.json: client creation 347 s (waited through 409s), step 1 80 s, step 2 43.5 s (fwd/bwd 12.6 s + optim 31 s), checkpoint save 62.6 s, per-sample 0.8 s. That slowness (about 4-5x slower than glm-5p3) is a second reason flash was dropped.
- Leaked sessions: the aborted flash real run (ts-a68b32b079324c94b3ffcda39151c19b) lost its connection at ~13:03 and could not be deleted; it holds a concurrent-run slot until it expires. It never trained.

# lab-train notes (updated 12:37 PT, 2026-11-02)

All numbers below marked (measured) come from results/train/smoke_glm5p3.json, probe.json, jobs.log.

## BASE MODEL DECISION (needs coordinator)
- Requested base: `accounts/fireworks/models/glm-5p3-flash` (tokenizer `zai-org/GLM-5.3-Flash`). It is in the serverless training price table.
- Since 12:30 PT `create_lora_training_client` for glm-5p3-flash returns HTTP 409 `capacity_exhausted` ("training capacity for new models is temporarily unavailable"), each attempt ~70-85 s. 4 attempts over ~6 min, all 409 (measured). Retrying with backoff continues; status.json state `waiting_for_capacity`.
- Other bases got capacity immediately in the same minute (probe, 1 step on dummy tokens, measured):

| model | client creation | 1 step |
|---|---|---|
| glm-5p3 | 1.1 s | 8.8 s |
| muse-glimmer-30b | 0.9 s | 11.2 s |
| qwen3p6-35b-a3b | 11.0 s | 36.4 s |
| qwen3p8-27b | 1.6 s | 55.4 s (cold) |

- NO base switch has been made. Recommended fallback if flash has no capacity by launch time: `accounts/fireworks/models/glm-5p3` (same GLM-5.3 family, same tokenizer/chat template, full pipeline verified end to end, see below). Train price $14.58/1M tokens vs $8.89 for flash (table in serverless.md); still only a few dollars for ~2000 short cases. If used, lab-systems' open_base baseline must use `glm-5p3` too.

## Pipeline smoke on glm-5p3 (measured, 16 synthetic cases, 2 steps, rank 16)
- tokenizer load 3.3 s; client creation 4.0 s; step 1: forward_backward 6.6 s + optim 2.5 s; step 2: 7.1 s + 1.4 s (about 9 s/step for 16 x ~200 tokens); save_weights_for_sampler 8.6 s; sampler startup 0.02 s; per-sample latency 1.2 s (first 4.0 s), 24 tokens, sequential.
- loss/response-token went 300.1/128 = 2.34 to 244.4/128 = 1.91 in 2 steps (so gradients move; nothing else is concluded from synthetic data).
- After 2 steps the model still "thinks" in free text ("We need answer JSON only..."), as expected untrained. The real run trains it to emit `</think>{"target": N}` immediately; max_tokens=24 is enough only if that is learned, so the scorer counts unparseable outputs as score 0 (reported separately as `unparseable`).
- Session deleted after smoke (`session_deleted: true`).

## SDK calls that worked (fireworks-ai 1.2.30)
```python
service = FiretitanServiceClient(api_key=KEY, base_url="https://api.fireworks.ai/training/v1/serverless")
tc = service.create_lora_training_client(base_model=..., rank=16)        # alpha defaults to 32
datum = Datum(model_input=ModelInput.from_ints(tokens[:-1]),
              loss_fn_inputs={"target_tokens": tokens[1:], "weights": w[1:]})
fb = tc.forward_backward(datums, "cross_entropy").result()                # fb.metrics["loss:sum"], ["response_tokens"]
tc.optim_step(AdamParams(learning_rate=1e-4, beta1=.9, beta2=.999, eps=1e-8, weight_decay=0, grad_clip_norm=1.0)).result()
snap = tc.save_weights_for_sampler("name").result().path                  # name <= 17 chars
sampler = service.create_sampling_client(model_path=snap, tokenizer=tok)
res = sampler.sample(prompt=ModelInput.from_ints(ids), num_samples=1,
                     sampling_params=SamplingParams(max_tokens=24, temperature=0.0, stop=[user_tag_id])).result()
service.delete_training_session()   # releases the run slot; also removes checkpoint access
```
No cookbook `training` package is needed (it is not installed); tokenization is done directly with the HF tokenizer.

## Prompt format (verified)
Context = `tokenizer.apply_chat_template([user], add_generation_prompt=True)` for GLM-5.3-Flash (verified byte-equal and token-equal, including the shipped `<|system|>Reasoning Effort: Max` line):
`[gMASK]<sop><|system|>Reasoning Effort: Max<|user|>{build_prompt(case)}<|assistant|><think>`.
Target = `</think>{"target": N}<|user|>`; loss only on target tokens (`</think>`, the JSON, and the `<|user|>` stop token). Context tokens have weight 0.
Training only on the assistant completion is done via weights; prompts longer than 8192 tokens are dropped, not truncated.

## Hyperparameters (run.py defaults)
rank 16, alpha 32 (SDK default), lr 1e-4 constant, AdamW beta2 0.999, grad clip 1.0, 1 epoch, batch 16, cap 3000 cases (dataset currently ~2030 train, so ~127 steps; at ~9-10 s/step that is ~20 min if real prompts are not much longer than the smoke ones). Periodic sampler checkpoints every 40 steps are logged to jobs.log; if scoring fails use `--score-only --snapshot <path>`; the session is kept open on failure after a checkpoint exists.

## Cost (ESTIMATE from serverless price table, GLM 5.3 Flash: prefill $2.96, sample $7.41, train $8.89 per 1M tokens)
Training ~2030 cases x ~700 tokens (guess until the real dry-run) = ~1.4M tokens = ~$12.6 flash / ~$20.7 for glm-5p3. Scoring 360 cases: ~360 x 700 prefill + ~20 sample tokens each = ~$0.8 flash. `run.py --dry-run` prints the real token count and estimate once the dataset is locked. Per-row `cost_usd` in lora.jsonl is this estimate, not a billed amount.

## Latency caveat
Sampling latency here is the training sampler on shared serverless GPUs (single-session, non-chat endpoint). It is NOT serving latency and must not be compared with production inference latencies.

## Plan B (managed SFT) not started
Serverless has capacity on every base except glm-5p3-flash, so managed SFT (separate pool, but scoring needs a deployment that bills hourly) is not needed unless all serverless bases lose capacity. Not launched; nothing that bills hourly has been created.
