"""توحيد الفلم نفسه بين الدور: "Mission Impossible" و "Mission: Impossible (IMAX)" = فلم واحد."""
from __future__ import annotations

import hashlib
from difflib import SequenceMatcher

import pandas as pd

try:
    from rapidfuzz import fuzz

    def similarity(a: str, b: str) -> float:
        return fuzz.token_set_ratio(a, b)
except ImportError:  # بديل أبطأ لو rapidfuzz مو مثبتة
    def similarity(a: str, b: str) -> float:
        sa, sb = " ".join(sorted(a.split())), " ".join(sorted(b.split()))
        return 100 * SequenceMatcher(None, sa, sb).ratio()


def assign_movie_ids(df: pd.DataFrame, threshold: float = 92) -> pd.DataFrame:
    """يجمع المفاتيح المتشابهة في مجموعة وحدة ويعطيها معرّف ثابت."""
    if df.empty:
        return df.assign(movie_id=pd.Series(dtype=str))
    keys = df["title_key"].value_counts().index.tolist()  # الأكثر تكراراً أول
    canon: dict[str, str] = {}
    reps: list[str] = []
    for k in keys:
        best = max(reps, key=lambda r: similarity(k, r), default=None)
        # نطلب نفس الطول تقريباً عشان ما نخلط "Toy Story 4" مع "Toy Story 5"
        if best and similarity(k, best) >= threshold and _same_numbers(k, best):
            canon[k] = best
        else:
            canon[k] = k
            reps.append(k)
    out = df.copy()
    out["canon_key"] = out["title_key"].map(canon)
    out["movie_id"] = out["canon_key"].map(lambda k: hashlib.md5(k.encode()).hexdigest()[:8])
    return out


def _same_numbers(a: str, b: str) -> bool:
    na = [w for w in a.split() if w.isdigit()]
    nb = [w for w in b.split() if w.isdigit()]
    return na == nb
