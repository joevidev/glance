# lab-systems status (updated 13:58 PT)

## Scored rows on the locked test set (360 cases, 8 sites, sha256 verified against manifest)
| system | rows | accuracy | cost / 1k cmds (measured tokens x list price) | latency p50 |
|---|---|---|---|---|
| raw_gaze | 360 | 8.3% | 0 | local |
| nearest | 360 | 26.7% | 0 | local |
| open_cmd_only (glm-5p3) | 360 | 45.8% | $5.62 | 3.0 s |
| open_base (glm-5p3) | 360 | 56.4% | $7.76 | 4.4 s |
| frontier (gpt-6-astra) | 360 | 57.2% | $12.20 | 1.6 s |
| lora (lab-train) | 360 | 52.8% | $5.79 (lab-train estimate) | 1.6 s (sampled inside a training session, NOT serving latency) |
| harness_top5 (glm-5p3) | 360 | 39.7% | $6.28 | 4.6 s |
| frontier_geo (gpt-6-astra, geo prompt) | 360 | 54.4% | $13.79 | 1.5 s |
| open_base_flash (extra, glm-5p3-flash base, not in comparison) | 360 | 58.9% | $0.65 | 2.8 s |
| harness_vote (glm-5p3) | PENDING | - | - | - |
| open_base_geo (glm-5p3, geo prompt) | PENDING | - | - | - |

## Incident: Fireworks account suspended (HTTP 412) from ~13:48 PT
- All Fireworks calls fail with 412 "Account buivo is suspended, possibly reaching the monthly spending limit". Billing must be fixed by Joel (fireworks.ai/account/billing).
- harness_vote lost 46/360 rows (written to results/rows_incomplete/harness_vote.jsonl, NOT in results/rows). Cache keeps the 1754 sample calls that succeeded, so the rerun only repeats the missing ones. 412/402 are treated as infrastructure errors: never scored wrong, rows kept out of results/rows until resolved.
- My own geo-prompt validation (13:46) is VOID (every geo call got 412, plain got 412 on 54/300): results/geo_validation.md was overwritten with "VERDICT: INVALID" so no false NO-GO reaches lab-train. The coordinator's own validation (glance_lab.validation.geo) must be checked for 412 errors too.
- Rows in results/rows were all produced before the suspension and contain 0 API errors.

## Settings / honesty notes
- open model glm-5p3: temperature 0, max_tokens 8192, thinking-only, so 26/360 open_base replies (7.2%) and 9/360 open_cmd_only were cut off at 8192 tokens with no answer and are scored wrong (reported as n_truncated_length). A probe with max_tokens 32768 on 8 of the truncated cases did not return within ~25 minutes (killed), so a bigger budget does not obviously fix it (inconclusive). The LoRA answers directly without thinking.
- frontier gpt-6-astra: rejects temperature != 1 (not sent, default 1), uses max_completion_tokens 4096; 0 truncations.
- Flash first run lost 9/360 rows to 429/connection errors during the network outage; they were retried (not scored wrong) and all 360 rows exist.
- Transient errors are retried (14 in-call attempts with backoff + up to 6 extra passes).
- frontier_geo: geo prompt did NOT help the frontier model (54.4% vs 57.2%; paired: only plain right 12, only geo right 2, p=0.013).

## 14:10 PT update
- results/summary.json + 3 charts regenerated on everything complete (harness_vote and open_base_geo are null / listed in `not_run`; their partial rows are NOT used). Pairs added: open_base_flash vs frontier (+1.7 pts, p=0.21, no reliable difference), open_base vs frontier (-0.8, p=0.51, no reliable difference), lora vs open_base_flash (-6.1, p=0.005, flash better, real). Flash = untrained flash base, not the LoRA's base.
- Accuracy vs cost: flash 58.9% at $0.65/1k, glm-5p3 56.4% at $7.76/1k, frontier 57.2% at $12.20/1k. Latency: open reasoning models are SLOWER (glm-5p3 4.4 s, flash 2.8 s p50) than frontier (1.6 s); no latency win is claimed.
- Still blocked: Fireworks 412 (suspended). Pending when it is back (one command): `uv run python -m glance_lab.systems.run --systems open_base_geo,harness_vote --open-model accounts/fireworks/models/glm-5p3` then `python -m glance_lab.systems.verify` and `python -m glance_lab.stats.report`.
