"""تنظيف البيانات الخام وتوحيدها: الأوقات، أسماء الأفلام، أنواع الشاشات، اللغات."""
from __future__ import annotations

import re
import unicodedata
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pandas as pd

TIME_RE = re.compile(r"(\d{1,2}):(\d{2})\s*([ap])?\.?\s*m?\.?", re.I)
ISO_RE = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}")

EXPERIENCE_MAP = {
    "standard": "Standard", "2d": "Standard", "regular": "Standard",
    "imax": "IMAX", "imax with laser": "IMAX", "max": "MAX",
    "gold": "VIP", "vip": "VIP", "platinum": "VIP", "platinum suites": "VIP",
    "lux": "VIP", "premium": "Premium", "theatre": "Theatre",
    "4dx": "4DX", "screenx": "ScreenX", "dolby": "Dolby", "dolby cinema": "Dolby",
    "kids": "Kids", "reel junior": "Kids", "junior": "Kids", "family": "Kids",
}
LANG_MAP = {
    "english": "إنجليزي", "arabic": "عربي", "hindi": "هندي", "malayalam": "مالايالامي",
    "tamil": "تاميلي", "telugu": "تيلوغو", "korean": "كوري", "japanese": "ياباني",
    "french": "فرنسي", "turkish": "تركي", "urdu": "أوردو", "egyptian": "عربي",
}
# لواحق تنضاف لاسم الفلم وما هي جزء منه
TITLE_NOISE = re.compile(
    r"\s*[\(\[]\s*(arabic|english|hindi|tamil|telugu|malayalam|dubbed|subtitled|"
    r"imax|3d|2d|4dx|max|screenx|dolby|مدبلج|عربي|مترجم)[^\)\]]*[\)\]]"
    r"|\s*[-–:|]\s*(imax|3d|4dx|screenx|the imax experience|dubbed|arabic)\s*$",
    re.I,
)


def strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def clean_title(title: str) -> str:
    t = " ".join((title or "").split())
    prev = None
    while prev != t:
        prev, t = t, TITLE_NOISE.sub("", t).strip()
    return t


def title_key(title: str) -> str:
    """مفتاح للمقارنة: حروف صغيرة، بدون تشكيل ورموز، وتوحيد الهمزات والتاء المربوطة."""
    t = strip_accents(clean_title(title)).lower()
    t = re.sub(r"[أإآ]", "ا", t).replace("ة", "ه").replace("ى", "ي")
    t = t.replace("&", " and ")
    t = re.sub(r"[^\w\s]", " ", t)
    t = re.sub(r"^(the|a|an|ال)\s+", "", t.strip())
    return " ".join(t.split())


def norm_experience(x: str) -> str:
    k = " ".join((x or "").split()).lower()
    return EXPERIENCE_MAP.get(k, (x or "Standard").strip().title() or "Standard")


def norm_language(x: str) -> str:
    if not x:
        return ""
    parts = [p.strip().lower() for p in re.split(r"[/,]", x)]
    return " / ".join(LANG_MAP.get(p, p.title()) for p in parts if p)


def business_date(now: datetime, cutoff_hour: int) -> date:
    """قبل الساعة الفاصلة (مثلاً 5 الفجر) لسا نعتبر الليلة تابعة لليوم اللي قبل."""
    return (now - timedelta(days=1)).date() if now.hour < cutoff_hour else now.date()


def parse_start(time_text: str, bdate: date, tz: ZoneInfo, cutoff_hour: int) -> datetime | None:
    if not time_text:
        return None
    if ISO_RE.search(time_text):
        try:
            dt = datetime.fromisoformat(time_text.replace("Z", "+00:00"))
            return dt.astimezone(tz) if dt.tzinfo else dt.replace(tzinfo=tz)
        except ValueError:
            pass
    m = TIME_RE.search(time_text)
    if not m:
        return None
    h, mi, ap = int(m.group(1)), int(m.group(2)), (m.group(3) or "").lower()
    if ap == "p" and h != 12:
        h += 12
    elif ap == "a" and h == 12:
        h = 0
    if h > 23 or mi > 59:
        return None
    d = bdate + timedelta(days=1) if h < cutoff_hour else bdate
    return datetime(d.year, d.month, d.day, h, mi, tzinfo=tz)


def clean(raw: pd.DataFrame, now: datetime, tz_name: str = "Asia/Riyadh", cutoff_hour: int = 5) -> pd.DataFrame:
    tz = ZoneInfo(tz_name)
    now = now.astimezone(tz)
    bdate = business_date(now, cutoff_hour)
    df = raw.copy()
    if df.empty:
        return df.assign(start=pd.Series(dtype="object"))
    df["title_clean"] = df["movie_title"].map(clean_title)
    df["title_key"] = df["movie_title"].map(title_key)
    df["experience"] = df["experience"].map(norm_experience)
    df["language"] = df["language"].fillna("").map(norm_language)
    df["start"] = df["time_text"].map(lambda t: parse_start(t, bdate, tz, cutoff_hour))
    df = df.dropna(subset=["start"])
    df = df[df["title_key"].str.len() > 0]
    df = df.drop_duplicates(subset=["chain", "cinema_slug", "title_key", "start", "experience"])
    return df.sort_values("start").reset_index(drop=True)
