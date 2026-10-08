"""تجهيز ملف JSON اللي يقراه الموقع، وحفظ الأرشيف التاريخي."""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta
from pathlib import Path

import pandas as pd

log = logging.getLogger(__name__)

CITY_AR = {
    "riyadh": "الرياض", "jeddah": "جدة", "dammam": "الدمام", "khobar": "الخبر",
    "jubail": "الجبيل", "makkah": "مكة المكرمة", "madinah": "المدينة المنورة",
    "abha": "أبها", "tabuk": "تبوك", "taif": "الطائف", "qassim": "القصيم",
    "hail": "حائل", "jazan": "جازان", "ahsa": "الأحساء", "najran": "نجران",
    "yanbu": "ينبع", "other": "مدن أخرى",
}
HISTORY_COLS = ["scraped_at", "chain", "cinema_slug", "city", "movie_id", "title_clean",
                "experience", "language", "rating", "start"]


def _cinema_id(chain: str, slug: str) -> str:
    return f"{chain}:{slug}"


def load_previous(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


META_KEYS = ["title_ar", "title_en", "overview", "genres", "release_date", "poster", "backdrop",
             "director", "cast", "trailer", "imdb_id", "imdb_rating", "imdb_votes"]


def build_payload(df: pd.DataFrame, cfg: dict, statuses: dict[str, dict], now: datetime,
                  previous: dict | None = None, enricher=None) -> dict:
    chains_cfg = cfg["chains"]
    previous = previous or {}
    if previous.get("sample"):  # لا نعيد استخدام البيانات التجريبية أبداً
        previous = {}
    keep_after = now - timedelta(minutes=15)

    movies: dict[str, dict] = {}
    cinemas: dict[str, dict] = {}
    shows: list[dict] = []

    if not df.empty:
        df = df[df["start"] >= keep_after]
        # أوضح اسم لكل فلم: الأكثر تكراراً بعد التنظيف
        for mid, g in df.groupby("movie_id"):
            title = g["title_clean"].mode().iat[0]
            movies[mid] = {
                "id": mid,
                "title": title,
                "rating": next((r for r in g["rating"] if r), ""),
                "language": next((l for l in g["language"] if l), ""),
                "runtime": int(g["runtime_min"].dropna().iat[0]) if g["runtime_min"].notna().any() else None,
            }
        if enricher is not None:
            metas = enricher.enrich(movies, now)
            for mid, meta in metas.items():
                for k in META_KEYS:
                    if meta.get(k) not in (None, "", []):
                        movies[mid][k] = meta[k]
                if not movies[mid].get("runtime") and meta.get("runtime"):
                    movies[mid]["runtime"] = meta["runtime"]
        for (chain, slug), g in df.groupby(["chain", "cinema_slug"]):
            cid = _cinema_id(chain, slug)
            cinemas[cid] = {"id": cid, "chain": chain, "name": g["cinema_name"].iat[0],
                            "city": g["city"].iat[0], "mode": "auto"}
        for r in df.itertuples():
            shows.append({
                "m": r.movie_id, "c": _cinema_id(r.chain, r.cinema_slug),
                "t": r.start.isoformat(timespec="minutes"), "f": r.experience,
                "u": r.booking_url, "l": r.language,
            })

    # دار فشل سحبها هالمرة؟ نرجّع بياناتها السابقة اللي لسا ما فات وقتها
    for chain, st in statuses.items():
        if st["status"] != "failed":
            continue
        prev_c = {c["id"]: c for c in previous.get("cinemas", []) if c.get("chain") == chain}
        prev_s = [s for s in previous.get("shows", []) if s["c"] in prev_c
                  and datetime.fromisoformat(s["t"]) >= keep_after]
        if prev_s:
            cinemas.update(prev_c)
            prev_m = {m["id"]: m for m in previous.get("movies", [])}
            for s in prev_s:
                if s["m"] in prev_m:
                    movies.setdefault(s["m"], prev_m[s["m"]])
            shows.extend(prev_s)
            st["status"] = "stale"
            st["note"] = "عرضنا آخر بيانات ناجحة"

    # الدور اللي بدون سحب تلقائي: تطلع بفروعها (لو معروفة) مع رابط لموقعها
    city_filter = cfg["settings"].get("cities") or []
    for chain, c in chains_cfg.items():
        if c.get("mode") == "auto":
            continue
        branches = c.get("branches") or [{"name": "كل الفروع", "city": city_filter[0] if len(city_filter) == 1 else "other"}]
        for i, b in enumerate(branches):
            cid = _cinema_id(chain, f"link-{i}")
            cinemas[cid] = {"id": cid, "chain": chain, "name": b["name"], "city": b["city"],
                            "mode": "link", "url": c["url"]}

    shows.sort(key=lambda s: s["t"])
    used_cities = sorted({c["city"] for c in cinemas.values()},
                         key=lambda x: (x != "riyadh", x == "other", x))
    return {
        "generated_at": now.isoformat(timespec="seconds"),
        "chains": {k: {"name": v["name_ar"], "name_en": v.get("name_en", ""), "url": v["url"],
                       "mode": v.get("mode", "link")} for k, v in chains_cfg.items()},
        "cities": [{"id": c, "name": CITY_AR.get(c, c)} for c in used_cities],
        "sources": statuses,
        "movies": sorted(movies.values(), key=lambda m: m["title"]),
        "cinemas": sorted(cinemas.values(), key=lambda c: (c["mode"] != "auto", c["chain"], c["name"])),
        "shows": shows,
    }


def write_payload(payload: dict, out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "showtimes.json"
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    tmp.replace(path)
    return path


def append_history(df: pd.DataFrame, history_dir: Path, now: datetime) -> Path | None:
    """أرشيف شهري لكل عرض شفناه مرة وحدة. هذا أساس تقارير البيانات مستقبلاً."""
    if df.empty:
        return None
    history_dir.mkdir(parents=True, exist_ok=True)
    path = history_dir / f"shows_{now:%Y-%m}.csv"
    new = df.assign(scraped_at=now.isoformat(timespec="seconds"),
                    start=df["start"].map(lambda d: d.isoformat(timespec="minutes")))[HISTORY_COLS]
    key = ["chain", "cinema_slug", "movie_id", "experience", "start"]
    if path.exists():
        old = pd.read_csv(path, dtype=str)
        # تنظيف صفوف قديمة انحفظت بأسماء غلط (نسخة سابقة أخذت زر "Info" كاسم فلم)
        old = old[~old["title_clean"].str.strip().str.lower().isin({"info", "view times and book"})]
        new = new.astype(str)
        merged = pd.concat([old, new]).drop_duplicates(subset=key, keep="first")
    else:
        merged = new
    merged.to_csv(path, index=False)
    return path
