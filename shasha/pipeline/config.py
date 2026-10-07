from __future__ import annotations

from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "config" / "sources.yaml"
SITE_DATA = ROOT / "site" / "data"
HISTORY_DIR = ROOT / "data" / "history"


def load_config(path: Path = CONFIG_PATH) -> dict:
    with open(path, encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    cfg.setdefault("settings", {})
    cfg.setdefault("chains", {})
    return cfg
