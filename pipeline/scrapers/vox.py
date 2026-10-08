"""سحب مواعيد ڤوكس السعودية.

ما نسحبه (كله مسموح في robots.txt وقت كتابة الكود):
  - خريطة الموقع: assets.voxcinemas.com/sitemap/sitemap.SA.xml  → قائمة الفروع
  - صفحة كل فرع:  ksa.voxcinemas.com/showtimes/<فرع>          → مواعيد اليوم
ما لا نسحبه:
  - أي رابط فيه "?" (منها اختيار التاريخ ?d=) وصفحات /booking/  (ممنوعة في robots.txt)
  روابط الحجز نحفظها فقط كروابط يضغطها المستخدم، ما نزورها.

المحلّل ما يعتمد على أسماء classes معيّنة لأنها تتغير. يبدأ من روابط الحجز
ويطلع للأعلى عشان يلقى الفلم ونوع الشاشة. لو تغيّر الموقع كثير، شغّل
notebooks/01_scrape.ipynb وشوف وين انكسر.
"""
from __future__ import annotations

import logging
import re
import xml.etree.ElementTree as ET
from urllib.parse import urljoin

from bs4 import BeautifulSoup, Tag

from ..http import PoliteSession
from . import RawShow, city_from_slug

log = logging.getLogger(__name__)

BASE = "https://ksa.voxcinemas.com"
EXPERIENCES = {
    "standard", "imax", "imax with laser", "max", "gold", "kids", "theatre",
    "4dx", "screenx", "vip", "premium", "dolby", "dolby cinema", "outdoor",
    "lux", "deluxe", "family", "rooftop",
}
DETAILS_RE = re.compile(
    r"\b(G|PG|PG12|PG13|PG15|R12|R15|R18|R21|T|TBC|E)\b\s+"
    r"([A-Za-z؀-ۿ]+(?:\s*/\s*[A-Za-z؀-ۿ]+)?)\s+(\d{2,3})\s*min",
    re.I,
)
TIME_RE = re.compile(r"\b(\d{1,2}):(\d{2})\s*([ap]\.?m\.?)?", re.I)


def list_branches(session: PoliteSession, sitemap_url: str) -> list[str]:
    r = session.get(sitemap_url)
    root = ET.fromstring(r.content)
    slugs = []
    for loc in root.iter():
        if loc.tag.endswith("loc") and loc.text and "/showtimes/" in loc.text:
            slug = loc.text.rstrip("/").split("/showtimes/")[-1]
            if slug and "?" not in slug:
                slugs.append(slug)
    return sorted(set(slugs))


def _movie_slug(a: Tag) -> str | None:
    href = a.get("href") or ""
    m = re.search(r"/movies/([a-z0-9\-]+)", href)
    if m and m.group(1) not in {"whatson", "comingsoon"}:
        return m.group(1)
    return None


def _movie_container(link: Tag) -> Tag | None:
    """أقرب عنصر أب يحتوي رابط فلم واحد بالضبط."""
    node = link.parent
    while isinstance(node, Tag) and node.name not in ("body", "html"):
        slugs = {s for a in node.find_all("a", href=True) if (s := _movie_slug(a))}
        if len(slugs) == 1:
            return node
        if len(slugs) > 1:
            return None
        node = node.parent
    return None


def _experience_for(link: Tag, container: Tag) -> str:
    for el in link.find_all_previous(string=True):
        if isinstance(el.parent, Tag) and container not in el.parent.parents and el.parent is not container:
            break
        txt = " ".join(el.split()).strip().lower()
        if txt in EXPERIENCES:
            return " ".join(el.split()).strip()
    return "Standard"


# نصوص أزرار وروابط عامة، مستحيل تكون اسم فلم
GENERIC = {
    "info", "more info", "details", "more details", "trailer", "watch trailer", "book",
    "book now", "buy tickets", "tickets", "view times", "view times and book", "showtimes",
    "more", "read more", "play", "see all", "معلومات", "التفاصيل", "احجز", "احجز الآن",
    "الإعلان", "المزيد", "عرض الأوقات",
}


def _is_title_like(t: str) -> bool:
    t = " ".join((t or "").split())
    if len(t) < 2 or t.lower() in GENERIC or TIME_RE.fullmatch(t):
        return False
    if DETAILS_RE.search(t) or t.lower() in EXPERIENCES:
        return False
    return True


def _slug_title(slug: str) -> str:
    return slug.replace("-", " ").title()


def _title_for(container: Tag, slug: str, cinema_slug: str = "") -> str:
    """نجمع كل النصوص المرشحة ونختار أنسبها لاسم الفلم."""
    cands: list[tuple[int, str]] = []
    slug_words = set(slug.split("-"))
    cinema_words = set(cinema_slug.split("-")) - {"the", "mall", "al"}
    for a in container.find_all("a", href=True):
        if _movie_slug(a) != slug:
            continue
        cands.append((3, a.get_text(" ", strip=True)))
        cands.append((3, a.get("title", "")))
        cands.append((3, a.get("aria-label", "")))
    for img in container.find_all("img"):
        cands.append((2, img.get("alt", "")))
    for h in container.find_all(["h1", "h2", "h3", "h4"]):
        cands.append((4, h.get_text(" ", strip=True)))
    best, best_score = None, -1
    for weight, t in cands:
        t = " ".join((t or "").split())
        if not _is_title_like(t):
            continue
        # نفضّل النص اللي كلماته قريبة من الـ slug
        words = set(re.sub(r"[^a-z0-9 ]", " ", t.lower()).split())
        # عنوان الفرع (مثل "Riyadh Park - Riyadh") مو اسم فلم
        if cinema_words and len(words & cinema_words) >= min(2, len(cinema_words)) and not (words & slug_words):
            continue
        overlap = len(words & slug_words)
        score = weight + overlap * 2
        if score > best_score:
            best, best_score = t, score
    return best or _slug_title(slug)


CINEMA_AR = {
    "riyadh-park": "الرياض بارك", "kingdom-centre": "المملكة سنتر", "al-qasr-mall": "القصر مول",
    "sahara-mall": "صحارى مول", "atyaf-mall": "أطياف مول", "century-corner": "سنتشري كورنر",
    "roshn-front": "روشن فرونت", "the-roof": "ذا روف", "the-spot-sheikh-jaber": "ذا سبوت",
    "via": "ڤيا رياض", "red-sea-mall": "رد سي مول", "mall-of-arabia": "العرب مول",
    "jubail-galleria-mall": "جاليريا مول الجبيل",
}


def cinema_name_from_slug(slug: str) -> str:
    parts = slug.split("-")
    city = city_from_slug(slug)
    if len(parts) > 1 and parts[-1] in (city, "riyadh", "jeddah", "dammam", "khobar", "jubail"):
        parts = parts[:-1]
    key = "-".join(parts)
    return CINEMA_AR.get(key) or " ".join(p.capitalize() for p in parts)


def parse_showtimes_html(html: str, cinema_slug: str, source_url: str = "") -> list[RawShow]:
    soup = BeautifulSoup(html, "lxml")
    cinema_name = cinema_name_from_slug(cinema_slug)
    city = city_from_slug(cinema_slug)
    out: list[RawShow] = []
    for link in soup.select('a[href*="/booking/"]'):
        time_text = link.get_text(" ", strip=True)
        if not TIME_RE.search(time_text):
            continue
        container = _movie_container(link)
        if container is None:
            continue
        slug = next(s for a in container.find_all("a", href=True) if (s := _movie_slug(a)))
        details = DETAILS_RE.search(container.get_text(" ", strip=True))
        out.append(RawShow(
            chain="vox",
            cinema_slug=cinema_slug,
            cinema_name=cinema_name,
            city=city,
            movie_title=_title_for(container, slug, cinema_slug),
            movie_slug=slug,
            time_text=time_text,
            experience=_experience_for(link, container),
            rating=details.group(1).upper() if details else "",
            language=details.group(2) if details else "",
            runtime_min=int(details.group(3)) if details else None,
            booking_url=urljoin(BASE, link["href"]),
            source_url=source_url,
        ))
    return out


def scrape(session: PoliteSession, chain_cfg: dict, cities: list[str] | None = None) -> list[RawShow]:
    overrides = chain_cfg.get("city_overrides", {}) or {}
    slugs = list_branches(session, chain_cfg["sitemap"])
    log.info("ڤوكس: %d فرع في خريطة الموقع", len(slugs))
    shows: list[RawShow] = []
    for slug in slugs:
        city = overrides.get(slug) or city_from_slug(slug)
        if cities and city not in cities:
            continue
        url = f"{BASE}/showtimes/{slug}"
        try:
            html = session.get(url).text
        except Exception as e:  # فرع واحد فاشل ما يوقف الباقي
            log.warning("ڤوكس: فشل %s: %s", slug, e)
            continue
        found = parse_showtimes_html(html, slug, url)
        for s in found:
            s.city = city
        log.info("ڤوكس: %s → %d عرض", slug, len(found))
        shows.extend(found)
    return shows
