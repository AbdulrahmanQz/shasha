"""إثراء بيانات الأفلام: الملصق والقصة والممثلين والإعلان من TMDB، وتقييم IMDb من OMDb.

المفاتيح تنقرأ من متغيرات البيئة (في GitHub تنحط كـ Secrets):
    TMDB_API_KEY   مفتاح v3 أو "Read Access Token" من themoviedb.org/settings/api
    OMDB_API_KEY   من omdbapi.com/apikey.aspx (المجاني يكفي: 1000 طلب يومياً)
لو المفتاح مو موجود، الخطوة تنتخطى والموقع يشتغل بدون ملصقات وتقييمات.

النتائج تنحفظ في data/movie_meta.json عشان ما نطلب نفس الفلم كل ساعة:
  - بيانات TMDB تتحدث كل 7 أيام
  - تقييم IMDb يتحدث كل 24 ساعة
  - الفلم اللي ما لقيناه نعيد البحث عنه بعد 24 ساعة
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
from datetime import datetime, timedelta
from difflib import SequenceMatcher
from pathlib import Path

import requests

log = logging.getLogger(__name__)

TMDB = "https://api.themoviedb.org/3"
IMG = "https://image.tmdb.org/t/p"
TMDB_TTL = timedelta(days=7)
OMDB_TTL = timedelta(hours=24)
MISS_TTL = timedelta(hours=24)


class Enricher:
    def __init__(self, cache_path: Path, tmdb_key: str | None = None, omdb_key: str | None = None):
        self.cache_path = cache_path
        self.tmdb_key = tmdb_key if tmdb_key is not None else os.environ.get("TMDB_API_KEY", "").strip()
        self.omdb_key = omdb_key if omdb_key is not None else os.environ.get("OMDB_API_KEY", "").strip()
        self.s = requests.Session()
        if self.tmdb_key and len(self.tmdb_key) > 40:  # Read Access Token
            self.s.headers["Authorization"] = f"Bearer {self.tmdb_key}"
        try:
            self.cache = json.loads(cache_path.read_text(encoding="utf-8"))
        except Exception:
            self.cache = {}

    # ---------- TMDB ----------
    def _tmdb(self, path: str, **params) -> dict:
        if not self.s.headers.get("Authorization"):
            params["api_key"] = self.tmdb_key
        r = self.s.get(f"{TMDB}{path}", params=params, timeout=20)
        r.raise_for_status()
        time.sleep(0.15)
        return r.json()

    def _search(self, title: str, year_hint: int) -> dict | None:
        res = self._tmdb("/search/movie", query=title, include_adult="false", language="en-US").get("results", [])
        if not res:
            return None
        key = _norm(title)

        def score(m: dict) -> float:
            s = SequenceMatcher(None, key, _norm(m.get("title", ""))).ratio()
            s = max(s, SequenceMatcher(None, key, _norm(m.get("original_title", ""))).ratio())
            y = int((m.get("release_date") or "0")[:4] or 0)
            if y and abs(year_hint - y) <= 1:
                s += 0.3  # الأفلام اللي تعرض الحين غالباً نازلة هالسنة أو اللي قبلها
            s += min(m.get("popularity", 0), 200) / 2000
            return s

        best = max(res, key=score)
        return best if score(best) >= 0.75 else None

    def _details(self, tmdb_id: int) -> dict:
        ar = self._tmdb(f"/movie/{tmdb_id}", language="ar-SA",
                        append_to_response="credits,videos,external_ids,release_dates",
                        include_video_language="ar,en,null")
        overview = (ar.get("overview") or "").strip()
        title_ar = (ar.get("title") or "").strip()
        if not overview:
            en = self._tmdb(f"/movie/{tmdb_id}", language="en-US")
            overview = (en.get("overview") or "").strip()
        vids = [v for v in ar.get("videos", {}).get("results", []) if v.get("site") == "YouTube"]
        vids.sort(key=lambda v: (v.get("type") != "Trailer", not v.get("official", False), v.get("iso_639_1") != "ar"))
        crew = ar.get("credits", {}).get("crew", [])
        cast = ar.get("credits", {}).get("cast", [])
        return {
            "tmdb_id": tmdb_id,
            "imdb_id": ar.get("external_ids", {}).get("imdb_id") or ar.get("imdb_id"),
            "title_ar": title_ar if re.search(r"[؀-ۿ]", title_ar) else "",
            "title_en": ar.get("original_title") if ar.get("original_language") == "en" else "",
            "original_title": ar.get("original_title", ""),
            "overview": overview,
            "genres": [g["name"] for g in ar.get("genres", [])][:3],
            "runtime": ar.get("runtime") or None,
            "release_date": ar.get("release_date") or "",
            "poster": f"{IMG}/w500{ar['poster_path']}" if ar.get("poster_path") else "",
            "backdrop": f"{IMG}/w1280{ar['backdrop_path']}" if ar.get("backdrop_path") else "",
            "director": next((c["name"] for c in crew if c.get("job") == "Director"), ""),
            "cast": [c["name"] for c in cast[:4]],
            "trailer": f"https://www.youtube.com/watch?v={vids[0]['key']}" if vids else "",
        }

    # ---------- OMDb ----------
    def _omdb(self, imdb_id: str) -> dict:
        r = self.s.get("https://www.omdbapi.com/", params={"i": imdb_id, "apikey": self.omdb_key}, timeout=20,
                       headers={"Authorization": ""})
        r.raise_for_status()
        d = r.json()
        rating = d.get("imdbRating")
        votes = (d.get("imdbVotes") or "").replace(",", "")
        return {
            "imdb_rating": rating if rating and rating != "N/A" else "",
            "imdb_votes": int(votes) if votes.isdigit() else None,
        }

    # ---------- الواجهة ----------
    def enrich(self, movies: dict[str, dict], now: datetime) -> dict[str, dict]:
        """movies: {movie_id: {"title": ..., ...}} ← يرجع {movie_id: meta}"""
        if not self.tmdb_key:
            log.info("TMDB_API_KEY غير موجود: تم تخطي الملصقات والتفاصيل")
            return {mid: self.cache.get(_norm(m["title"]), {}) for mid, m in movies.items()}
        out = {}
        for mid, m in movies.items():
            key = _norm(m["title"])
            c = self.cache.get(key, {})
            try:
                fetched = _ts(c.get("fetched_at"))
                if c.get("missing"):
                    stale = not fetched or now - fetched > MISS_TTL
                else:
                    stale = not fetched or now - fetched > TMDB_TTL
                if stale:
                    hit = self._search(m["title"], now.year)
                    if hit:
                        c = {**c, **self._details(hit["id"]), "missing": False}
                    else:
                        c = {"missing": True}
                        log.info("TMDB: ما لقينا %s", m["title"])
                    c["fetched_at"] = now.isoformat()
                if self.omdb_key and c.get("imdb_id"):
                    of = _ts(c.get("omdb_at"))
                    if not of or now - of > OMDB_TTL:
                        c.update(self._omdb(c["imdb_id"]))
                        c["omdb_at"] = now.isoformat()
            except requests.RequestException as e:
                log.warning("الإثراء فشل لـ %s: %s", m["title"], e)
            self.cache[key] = c
            out[mid] = c
        self.save()
        return out

    def save(self):
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        self.cache_path.write_text(json.dumps(self.cache, ensure_ascii=False, indent=1), encoding="utf-8")


def _norm(s: str) -> str:
    s = re.sub(r"[^\w\s]", " ", (s or "").lower())
    s = re.sub(r"^(the|a|an)\s+", "", s.strip())
    return " ".join(s.split())


def _ts(v):
    try:
        return datetime.fromisoformat(v) if v else None
    except ValueError:
        return None
