"""طلبات HTTP مؤدبة: تحترم robots.txt، وتنتظر بين الطلبات، وتعيد المحاولة عند الفشل المؤقت."""
from __future__ import annotations

import logging
import time
import urllib.robotparser
from urllib.parse import urlparse

import requests

log = logging.getLogger(__name__)


class RobotsDisallowed(Exception):
    pass


class PoliteSession:
    def __init__(self, user_agent: str, delay: float = 3.0, timeout: float = 30.0):
        self.user_agent = user_agent
        self.delay = delay
        self.timeout = timeout
        self._last = 0.0
        self._robots: dict[str, urllib.robotparser.RobotFileParser] = {}
        self.s = requests.Session()
        self.s.headers.update({
            "User-Agent": user_agent,
            "Accept-Language": "ar,en;q=0.8",
        })

    def _robots_for(self, url: str) -> urllib.robotparser.RobotFileParser:
        p = urlparse(url)
        base = f"{p.scheme}://{p.netloc}"
        if base not in self._robots:
            rp = urllib.robotparser.RobotFileParser()
            try:
                r = self.s.get(base + "/robots.txt", timeout=self.timeout)
                rp.parse(r.text.splitlines() if r.ok else [])
            except requests.RequestException as e:
                log.warning("تعذّر قراءة robots.txt لـ %s: %s", base, e)
                rp.parse([])
            self._robots[base] = rp
        return self._robots[base]

    def allowed(self, url: str) -> bool:
        # urllib.robotparser لا يفهم النجمة (*) داخل المسارات، فنفحص قاعدة "?" بأنفسنا
        if "?" in url and self._blocks_query(url):
            return False
        return self._robots_for(url).can_fetch(self.user_agent, url)

    def _blocks_query(self, url: str) -> bool:
        rp = self._robots_for(url)
        entries = list(getattr(rp, "entries", []))
        if getattr(rp, "default_entry", None):
            entries.append(rp.default_entry)
        for e in entries:
            for line in e.rulelines:
                if not line.allowance and "?" in line.path:
                    return True
        return False

    def get(self, url: str, retries: int = 3) -> requests.Response:
        if not self.allowed(url):
            raise RobotsDisallowed(url)
        for attempt in range(1, retries + 1):
            wait = self.delay - (time.monotonic() - self._last)
            if wait > 0:
                time.sleep(wait)
            self._last = time.monotonic()
            try:
                r = self.s.get(url, timeout=self.timeout)
                if r.status_code in (429, 500, 502, 503, 504):
                    raise requests.HTTPError(f"HTTP {r.status_code}")
                r.raise_for_status()
                return r
            except requests.RequestException as e:
                if attempt == retries:
                    raise
                backoff = self.delay * (2 ** attempt)
                log.warning("فشل %s (%s)، إعادة بعد %.0f ث", url, e, backoff)
                time.sleep(backoff)
        raise RuntimeError("unreachable")
