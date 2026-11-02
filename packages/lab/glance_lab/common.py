"""Shared paths and IO. Every lab module imports from here so paths never drift.

Secrets: keys are loaded from the repo-root .env with python-dotenv, in process.
Never print them, never cat the file.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Iterable, Iterator

from dotenv import load_dotenv

REPO = Path(__file__).resolve().parents[3]          # glance/
CONTRACTS = REPO / "packages" / "contracts"
PROMPTS = CONTRACTS / "prompts"
ELEMENTS_JS = REPO / "packages" / "elements" / "extract.js"
DATA = REPO / "data"
SITES = DATA / "sites"                               # crawl output, one json per site
DATASET = DATA / "dataset"                           # train.jsonl, test.jsonl, manifest.json
RESULTS = REPO / "results"
ROWS = RESULTS / "rows"                              # one <system>.jsonl, one row per case
TRAIN_LOG = RESULTS / "train"                        # training job state, read by the monitor


def load_env() -> None:
    load_dotenv(REPO / ".env")


def require_env(name: str) -> str:
    load_env()
    v = os.environ.get(name)
    if not v:
        raise SystemExit(f"{name} is not set in {REPO / '.env'}")
    return v


def read_jsonl(path: Path) -> list[dict]:
    with path.open() as f:
        return [json.loads(line) for line in f if line.strip()]


def iter_jsonl(path: Path) -> Iterator[dict]:
    with path.open() as f:
        for line in f:
            if line.strip():
                yield json.loads(line)


def write_jsonl(path: Path, rows: Iterable[dict]) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    n = 0
    with path.open("w") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
            n += 1
    return n
