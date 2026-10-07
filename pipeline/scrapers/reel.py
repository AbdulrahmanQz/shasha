"""سحب تجريبي لريل سينما (السعودية). غير مفعّل افتراضياً.

ليش تجريبي؟ موقع ريل يعرض المواعيد بـ JavaScript، فالصفحة نفسها فاضية.
الطريقة هنا: نفتح الصفحة بمتصفح Playwright، ونلتقط ردود JSON اللي يطلبها
الموقع، وندوّر فيها على أي قائمة فيها أفلام وأوقات.

robots.txt حق ريل يسمح بـ /ar-sa/ و /en-sa/ ويمنع صفحات الحجز والدفع.

كيف تفعّله:
  1) pip install playwright && playwright install chromium
  2) شغّل:  python -m pipeline.scrapers.reel --debug
     يحفظ كل ردود JSON في data/debug/reel/ عشان تشوف شكلها
  3) عدّل FIELD_HINTS أو _extract تحت حسب الأسماء الحقيقية للحقول
  4) غيّر mode: link إلى mode: auto في config/sources.yaml
"""
from __future__ import annotations

import json
import logging
import re
from pathlib import Path

from . import RawShow

log = logging.getLogger(__name__)

PAGE = "https://www.reelcinemas.com/en-sa/showtime"
FIELD_HINTS = {
    "title": ["movieName", "MovieName", "filmTitle", "title", "Title", "name"],
    "time": ["showTime", "ShowTime", "sessionTime", "startTime", "StartTime",
             "showDateTime", "ShowDateTime", "sessionDateTime"],
    "experience": ["experience", "Experience", "format", "screenType", "attribute"],
    "cinema": ["cinemaName", "CinemaName", "locationName", "theatreName"],
    "booking": ["bookingUrl", "BookingUrl", "deeplink", "url"],
}
TIME_LIKE = re.compile(r"\d{1,2}:\d{2}")


def _pick(d: dict, keys: list[str]):
    for k in keys:
        if k in d and d[k] not in (None, ""):
            return d[k]
    return None


def _walk(obj, parent_title=None):
    """يمشي على أي JSON ويطلع (عنوان، وقت، عنصر) لكل جلسة يلقاها."""
    if isinstance(obj, dict):
        title = _pick(obj, FIELD_HINTS["title"]) or parent_title
        t = _pick(obj, FIELD_HINTS["time"])
        if title and isinstance(t, str) and TIME_LIKE.search(t):
            yield title, t, obj
        for v in obj.values():
            yield from _walk(v, title if isinstance(title, str) else parent_title)
    elif isinstance(obj, list):
        for v in obj:
            yield from _walk(v, parent_title)


def _extract(payloads: list) -> list[RawShow]:
    shows, seen = [], set()
    for p in payloads:
        for title, t, obj in _walk(p):
            key = (title, t, str(_pick(obj, FIELD_HINTS["experience"])))
            if key in seen:
                continue
            seen.add(key)
            shows.append(RawShow(
                chain="reel",
                cinema_slug="reel-granada-riyadh",
                cinema_name=str(_pick(obj, FIELD_HINTS["cinema"]) or "Reel Cinemas - The Granada Mall"),
                city="riyadh",
                movie_title=str(title),
                time_text=t,
                experience=str(_pick(obj, FIELD_HINTS["experience"]) or "Standard"),
                booking_url=str(_pick(obj, FIELD_HINTS["booking"]) or PAGE),
                source_url=PAGE,
            ))
    return shows


def scrape(session=None, chain_cfg: dict | None = None, cities=None, debug_dir: Path | None = None) -> list[RawShow]:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        log.warning("ريل: Playwright غير مثبّت، تم التخطي")
        return []
    payloads = []
    ua = (session.user_agent if session else None)
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(user_agent=ua) if ua else browser.new_page()

        def on_response(resp):
            if "json" in (resp.headers.get("content-type") or ""):
                try:
                    payloads.append(resp.json())
                except Exception:
                    pass

        page.on("response", on_response)
        page.goto(PAGE, wait_until="networkidle", timeout=60000)
        page.wait_for_timeout(3000)
        browser.close()
    if debug_dir:
        debug_dir.mkdir(parents=True, exist_ok=True)
        for i, p in enumerate(payloads):
            (debug_dir / f"response_{i:02d}.json").write_text(
                json.dumps(p, ensure_ascii=False, indent=2), encoding="utf-8")
        log.info("ريل: حُفظت %d رد JSON في %s", len(payloads), debug_dir)
    shows = _extract(payloads)
    log.info("ريل: %d عرض", len(shows))
    return shows


if __name__ == "__main__":
    import argparse
    from ..config import ROOT
    logging.basicConfig(level=logging.INFO)
    ap = argparse.ArgumentParser()
    ap.add_argument("--debug", action="store_true")
    a = ap.parse_args()
    res = scrape(debug_dir=ROOT / "data" / "debug" / "reel" if a.debug else None)
    for s in res[:20]:
        print(s.movie_title, s.time_text, s.experience)
