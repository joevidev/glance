# Assistant ("Jarvis"): multi-step tasks

Look at something, say a short thing ("reply yes, tomorrow at 3 works", "schedule it"), the assistant does the multi-step task.

- `loop.ts` runTask: observe -> ONE action from the model -> guard -> execute -> re-observe, max 8 steps (pure, tested).
- `actions.ts` strict JSON parsing and the irreversible guard `/send|submit|save|pay|delete|confirm|buy/i` (and pressing Enter).
- `model.ts` one model call per step. Env `GLANCE_AGENT_MODEL` (default `gpt-5.4-mini` on openai), `GLANCE_AGENT_EFFORT` (default `low`).
  The openai path sends no `temperature`/`max_tokens`, only `max_completion_tokens`, JSON mode, and drops a parameter the model rejects.
- `runtime.ts` Electron side: observation (shared extractor + page text + form values + what the gaze is on), real native click,
  DOM typing (value set + input/change events, read back), the confirm channel (left wink / Enter / panel button; Esc / right wink cancels).
- `e2e.ts` `GLANCE_AGENT_E2E=1`: runs both scenarios on `resources/demo/` and reads the page state afterwards.

## Run

```bash
GLANCE_PROVIDER=openai pnpm desktop        # Browse > debug panel > Assistant (typed box, chips, voice switch, live step trace)
GLANCE_AGENT_E2E=1 GLANCE_PROVIDER=openai GLANCE_AGENT_REPEAT=3 pnpm desktop   # automated end to end, screenshots in .screens/
```
"open demo mail" in the Assistant panel opens `resources/demo/index.html` (the older `demo.html` is untouched).

Voice (Option+Space) runs the assistant when the "Voice runs the assistant" switch is on (default), else the single-click intent path.
