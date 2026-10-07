"""كل سحّاب يرجّع قائمة من RawShow بنفس الشكل، مهما كان شكل موقع الدار."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field


@dataclass
class RawShow:
    chain: str
    cinema_slug: str
    cinema_name: str
    city: str
    movie_title: str
    time_text: str
    experience: str = "Standard"
    movie_slug: str = ""
    rating: str = ""
    language: str = ""
    runtime_min: int | None = None
    booking_url: str = ""
    source_url: str = ""
    extra: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)


CITY_ALIASES = {
    "riyadh": "riyadh", "jeddah": "jeddah", "dammam": "dammam",
    "khobar": "khobar", "alkhobar": "khobar", "jubail": "jubail",
    "makkah": "makkah", "mecca": "makkah", "madinah": "madinah", "medina": "madinah",
    "abha": "abha", "tabuk": "tabuk", "taif": "taif", "buraidah": "qassim",
    "qassim": "qassim", "hail": "hail", "jazan": "jazan", "jizan": "jazan",
    "ahsa": "ahsa", "alahsa": "ahsa", "hofuf": "ahsa", "najran": "najran",
    "yanbu": "yanbu", "khamis": "abha", "dhahran": "khobar",
}


def city_from_slug(slug: str) -> str:
    for part in reversed(slug.lower().split("-")):
        if part in CITY_ALIASES:
            return CITY_ALIASES[part]
    return "other"
