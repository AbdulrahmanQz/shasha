"""تشغيل الخط كامل: سحب ← تنظيف ← توحيد ← نشر.

    python -m pipeline.run                 # تشغيل عادي
    python -m pipeline.run --only vox      # دار وحدة
    python -m pipeline.run --fixture tests/fixtures/vox_showtimes.html   # بدون إنترنت
"""
from __future__ import annotations

import argparse
import logging
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd

from . import build, clean, match
from .config import HISTORY_DIR, SITE_DATA, load_config
from .http import PoliteSession
from .scrapers import reel, vox

SCRAPERS = {"vox": vox.scrape, "reel": reel.scrape}
log = logging.getLogger("pipeline")


def scrape_all(cfg: dict, only: list[str] | None = None) -> tuple[pd.DataFrame, dict]:
    st = cfg["settings"]
    session = PoliteSession(st["user_agent"], delay=float(st.get("request_delay_seconds", 3)))
    rows, statuses = [], {}
    for chain, ccfg in cfg["chains"].items():
        if ccfg.get("mode") != "auto" or (only and chain not in only):
            continue
        fn = SCRAPERS.get(chain)
        if fn is None:
            log.warning("ما فيه سحّاب لـ %s", chain)
            continue
        try:
            found = fn(session, ccfg, st.get("cities") or None)
            rows += [s.to_dict() for s in found]
            statuses[chain] = {"status": "ok" if found else "failed", "count": len(found)}
            if not found:
                statuses[chain]["note"] = "ما لقينا أي عرض، غالباً تغيّر شكل الموقع"
        except Exception as e:
            log.exception("فشل سحب %s", chain)
            statuses[chain] = {"status": "failed", "count": 0, "note": str(e)[:200]}
    return pd.DataFrame(rows), statuses


def from_fixture(path: Path) -> tuple[pd.DataFrame, dict]:
    shows = vox.parse_showtimes_html(path.read_text(encoding="utf-8"), "riyadh-park-riyadh", str(path))
    return pd.DataFrame([s.to_dict() for s in shows]), {"vox": {"status": "ok", "count": len(shows)}}


def run(only=None, fixture: Path | None = None, now: datetime | None = None,
        out_dir: Path = SITE_DATA, history_dir: Path = HISTORY_DIR) -> dict:
    cfg = load_config()
    st = cfg["settings"]
    tz = ZoneInfo(st.get("timezone", "Asia/Riyadh"))
    now = (now or datetime.now(tz)).astimezone(tz)

    raw, statuses = from_fixture(fixture) if fixture else scrape_all(cfg, only)
    log.info("خام: %d صف", len(raw))
    tidy = clean.clean(raw, now, st.get("timezone", "Asia/Riyadh"), int(st.get("business_day_cutoff_hour", 5)))
    tidy = match.assign_movie_ids(tidy)
    log.info("بعد التنظيف: %d عرض لـ %d فلم", len(tidy), tidy["movie_id"].nunique() if len(tidy) else 0)

    previous = build.load_previous(out_dir / "showtimes.json")
    payload = build.build_payload(tidy, cfg, statuses, now, previous)
    if fixture:
        payload["sample"] = True
    path = build.write_payload(payload, out_dir)
    if not fixture:  # البيانات التجريبية ما تدخل الأرشيف
        build.append_history(tidy, history_dir, now)
    log.info("كُتب %s (%d عرض)", path, len(payload["shows"]))
    return payload


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--fixture", type=Path)
    a = ap.parse_args()
    run(only=a.only, fixture=a.fixture)


if __name__ == "__main__":
    main()
