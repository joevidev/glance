#!/usr/bin/env python3
"""Preflight: is an API key set, and does one tiny real call work?

Usage: python3 scripts/preflight/api_check.py openai|fireworks

Prints exactly one line:  <STATE>|<detail>
  STATE is OK, NOKEY, FAIL or SUSPENDED. The detail holds a status code and a plain-English
  cause, never a key. Exit code is always 0; the caller reads STATE.

The key is read from the process environment first, then from the repo-root .env, inside this
process only. It is never printed, logged, or passed on a command line.
Cost: one request of at most a few tokens (a fraction of a cent).
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
TIMEOUT = 15


def load_dotenv_values() -> dict[str, str]:
    """Tiny .env reader: KEY=VALUE lines, optional quotes and `export `. Values stay in memory."""
    out: dict[str, str] = {}
    p = REPO / ".env"
    try:
        text = p.read_text()
    except OSError:
        return out
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[7:]
        k, v = line.split("=", 1)
        v = v.strip()
        if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
            v = v[1:-1]
        out[k.strip()] = v
    return out


def get_key(name: str) -> str | None:
    v = os.environ.get(name)
    if v:
        return v
    return load_dotenv_values().get(name) or None


def post(url: str, key: str, body: dict) -> tuple[int | None, str]:
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return r.status, ""
    except urllib.error.HTTPError as e:
        return e.code, ""
    except Exception as e:  # network down, DNS, timeout
        return None, type(e).__name__


def check_openai() -> str:
    key = get_key("OPENAI_API_KEY")
    if not key:
        return "NOKEY|OPENAI_API_KEY is not set (process env or repo-root .env)"
    model = os.environ.get("GLANCE_MODEL") or "gpt-6-astra"
    # Same request shape as the app: no temperature, max_completion_tokens. 200 is a pass even if it is cut off.
    code, err = post(
        "https://api.openai.com/v1/chat/completions",
        key,
        {"model": model, "messages": [{"role": "user", "content": "Reply with the single word: ok"}], "max_completion_tokens": 64},
    )
    if code == 200:
        return f"OK|key set, one call to {model} returned HTTP 200"
    causes = {
        401: "key rejected (wrong or revoked key)",
        403: "key has no permission for this model",
        404: f"this key has no access to model {model}",
        429: "rate limit or out of quota/credit",
    }
    if code is None:
        return f"FAIL|key set but the call did not complete ({err}): no network?"
    return f"FAIL|key set, HTTP {code}: {causes.get(code, 'unexpected error')}"


def check_fireworks() -> str:
    key = get_key("FIREWORKS_API_KEY")
    if not key:
        return "NOKEY|FIREWORKS_API_KEY is not set"
    code, err = post(
        "https://api.fireworks.ai/inference/v1/chat/completions",
        key,
        {"model": "accounts/fireworks/models/glm-5p3", "messages": [{"role": "user", "content": "ok"}], "max_tokens": 1},
    )
    if code == 200:
        return "OK|key set, one call returned HTTP 200 (Fireworks is back: plain `pnpm desktop` would work)"
    if code == 412:
        return "SUSPENDED|key set, HTTP 412: account suspended. The demo runs on OpenAI; say so in the video"
    if code is None:
        return f"FAIL|key set but the call did not complete ({err}): no network?"
    return f"FAIL|key set, HTTP {code}"


if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else ""
    if which == "openai":
        print(check_openai())
    elif which == "fireworks":
        print(check_fireworks())
    else:
        print("FAIL|usage: api_check.py openai|fireworks")
