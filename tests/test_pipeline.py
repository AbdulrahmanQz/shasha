from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd

from pipeline import clean, match
from pipeline.scrapers import vox

FIX = Path(__file__).parent / "fixtures" / "vox_showtimes.html"
TZ = ZoneInfo("Asia/Riyadh")


def test_vox_parser_finds_all_shows():
    shows = vox.parse_showtimes_html(FIX.read_text(encoding="utf-8"), "riyadh-park-riyadh")
    assert len(shows) == 13
    digger = [s for s in shows if s.movie_slug == "digger"]
    assert {s.experience for s in digger} == {"Standard", "IMAX"}
    assert digger[0].rating == "R15" and digger[0].runtime_min == 130
    assert all(s.booking_url.startswith("https://ksa.voxcinemas.com/booking/") for s in shows)
    assert {s.experience for s in shows if s.movie_slug == "verity"} == {"Gold", "Standard"}


def test_after_midnight_belongs_to_next_day():
    now = datetime(2026, 10, 7, 18, 0, tzinfo=TZ)
    raw = pd.DataFrame([s.to_dict() for s in vox.parse_showtimes_html(FIX.read_text(encoding="utf-8"), "riyadh-park-riyadh")])
    df = clean.clean(raw, now)
    late = df[df["time_text"] == "1:00am"].iloc[0]
    assert late["start"].date().day == 8
    assert df[df["time_text"] == "7:15pm"].iloc[0]["start"].hour == 19


def test_run_at_2am_still_uses_previous_business_day():
    now = datetime(2026, 10, 8, 2, 0, tzinfo=TZ)
    assert clean.business_date(now, 5).day == 7


def test_dubbed_version_matches_original_but_sequels_do_not():
    df = pd.DataFrame({"title_key": [clean.title_key("Toy Story 5"), clean.title_key("Toy Story 5 (Arabic)"),
                                     clean.title_key("Toy Story 4")]})
    ids = match.assign_movie_ids(df)["movie_id"].tolist()
    assert ids[0] == ids[1] and ids[0] != ids[2]


def test_arabic_normalization():
    assert clean.title_key("الْمُهِمَّة الأخيرة") == clean.title_key("المهمه الاخيره")
