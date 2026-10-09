// Cinemap: الواجهة. تقرأ data/showtimes.json اللي يحدّثه GitHub Actions كل ساعة.
// الصفحات: #/  #/movies  #/times  #/cinemas  #/cinema/<id>  #/movie/<id>  #/about
"use strict";

const CONFIG = { tzOffsetMin: 180, cutoffHour: 5, windowMin: 90, quickHours: [17, 18, 19, 20, 21, 22, 23, 0], contact: "cinemap.app@gmail.com" };
const EXP_AR = { Standard: "عادي", Kids: "أطفال", Premium: "بريميوم", Theatre: "ثياتر", VIP: "VIP", IMAX: "IMAX", MAX: "MAX", "4DX": "4DX", ScreenX: "ScreenX", Dolby: "Dolby" };
const PH_COLORS = ["#2A3150", "#283A4A", "#3A3150", "#2F3B45", "#33304A", "#253447"];

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };

let DATA = null;
const IDX = { movie: {}, cinema: {} };
const state = { city: null, cinema: "all", formats: new Set(), langs: new Set(), genre: "all", q: "", time: "now", custom: "", sort: "next", mvFormat: "all", filtersOpen: false };

// ---------- أدوات الوقت والنص ----------
const parts = (ms) => { const d = new Date(ms + CONFIG.tzOffsetMin * 60000); return { y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours() }; };
function dayStart(nowMs) { const p = parts(nowMs); let b = Date.UTC(p.y, p.mo, p.d) - CONFIG.tzOffsetMin * 60000; if (p.h < CONFIG.cutoffHour) b -= 86400000; return b; }
function atHour(hhmm, nowMs) { const [h, m] = hhmm.split(":").map(Number); let t = dayStart(nowMs) + (h * 60 + m) * 60000; if (h < CONFIG.cutoffHour) t += 86400000; return t; }
function fmt(iso) { const m = /T(\d{2}):(\d{2})/.exec(iso); let h = +m[1]; const ap = h < 12 ? "ص" : "م"; h = h % 12 || 12; return { hm: `${h}:${m[2]}`, ap }; }
const fmtTxt = (iso) => { const f = fmt(iso); return `${f.hm} ${f.ap}`; };
const hourLabel = (h) => (h === 0 ? "12 ص" : h < 12 ? `${h} ص` : h === 12 ? "12 م" : `${h - 12} م`);
const runtimeTxt = (m) => (m ? `${Math.floor(m / 60)}س ${m % 60}د` : "");
const plural = (n, one, two, few, many) => (n === 1 ? one : n === 2 ? two : n <= 10 ? `${n} ${few}` : `${n} ${many}`);
const nMovies = (n) => plural(n, "فلم واحد", "فلمين", "أفلام", "فلم");
const nBranches = (n) => plural(n, "فرع واحد", "فرعين", "فروع", "فرع");
const nShows = (n) => plural(n, "عرض واحد", "عرضين", "عروض", "عرض");
const norm = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[ً-ٟ̀-ͯ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
const titleOf = (m) => m.title_ar || m.title;
const enOf = (m) => (m.title_ar ? (m.title_en || m.title) : "");
const phColor = (id) => PH_COLORS[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % PH_COLORS.length];
const cityName = () => DATA.cities.find((c) => c.id === state.city)?.name || "";
const chainOf = (c) => DATA.chains[c?.chain] || {};
const votesTxt = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(".0", "")} مليون` : n >= 1000 ? `${Math.round(n / 1000)} ألف` : String(n));
function ago(iso) {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  const h = Math.round(min / 60);
  const t = min < 1 ? "محدّث الحين" : min < 60 ? `آخر تحديث قبل ${min} دقيقة` : `آخر تحديث قبل ${h === 1 ? "ساعة" : h === 2 ? "ساعتين" : h + " ساعات"}`;
  return { t, min };
}

// ---------- البيانات ----------
function showOk(s, { ignoreCinema = false } = {}) {
  const c = IDX.cinema[s.c];
  if (!c || c.city !== state.city) return false;
  if (!ignoreCinema && state.cinema !== "all" && s.c !== state.cinema) return false;
  if (s.ms < Date.now() - 10 * 60000) return false;
  if (state.formats.size && !state.formats.has(s.f)) return false;
  if (state.langs.size) { const l = s.l || IDX.movie[s.m]?.language || ""; if (![...state.langs].some((x) => l.includes(x))) return false; }
  return true;
}
// لكل فلم: أقرب عرض، عدد العروض، الفروع
function entries({ q = "", from = -Infinity, to = Infinity, cinema } = {}) {
  const map = new Map();
  for (const s of DATA.shows) {
    if (!showOk(s)) continue;
    if (cinema && s.c !== cinema) continue;
    const m = IDX.movie[s.m]; if (!m) continue;
    if (q && !norm(m.title).includes(q) && !norm(m.title_ar).includes(q)) continue;
    let e = map.get(s.m);
    if (!e) map.set(s.m, (e = { m, next: null, n: 0, cinemas: new Set() }));
    e.n++; e.cinemas.add(s.c);
    if (s.ms >= from && s.ms <= to && (!e.next || s.ms < e.next.ms)) e.next = s;
  }
  return [...map.values()].filter((e) => e.next).sort((a, b) => a.next.ms - b.next.ms);
}

// ---------- مكوّنات ----------
function posterHTML(m, rank) {
  const badges = `${m.imdb_rating ? `<span class="badge-imdb">IMDb ${esc(m.imdb_rating)}</span>` : ""}${m.rating ? `<span class="badge-age">${esc(m.rating)}</span>` : ""}${rank ? `<span class="rank" aria-hidden="true">${rank}</span>` : ""}`;
  const rc = rank ? " has-rank" : "";
  if (m.poster) return `<div class="poster${rc}"><img src="${esc(m.poster)}" alt="ملصق ${esc(titleOf(m))}" loading="lazy">${badges}</div>`;
  return `<div class="poster${rc}" style="background:${phColor(m.id)}"><div class="ph"><b>${esc(titleOf(m))}</b><i>${esc(enOf(m))}</i></div>${badges}</div>`;
}
const metaTxt = (m) => [(m.genres || [])[0], runtimeTxt(m.runtime)].filter(Boolean).join(" · ") || m.language || "";
function cardHTML(e, rank) {
  return `<a class="card" href="#/movie/${esc(e.m.id)}">${posterHTML(e.m, rank)}
    <div class="card-info"><span class="card-title">${esc(titleOf(e.m))}</span><span class="card-sub">${esc(metaTxt(e.m))}</span>
    <span class="card-next"><b>أقرب عرض ${fmtTxt(e.next.t)}</b> <span>· ${nBranches(e.cinemas.size)}</span></span></div></a>`;
}
function secHead(kicker, a, b, link) {
  return `<div class="sec-head"><div class="ttl"><span class="kicker">${kicker}</span><h2>${a}${b ? ` <em>${b}</em>` : ""}</h2></div>${link ? `<a class="more" href="${link[0]}">${link[1]} ←</a>` : ""}</div>`;
}
let railSeq = 0;
function railHTML(title, sub, items, ranked) {
  const id = "tr" + railSeq++;
  return `<section class="rail"><div class="rail-head"><h3>${esc(title)}${sub ? `<span class="sub">${esc(sub)}</span>` : ""}</h3>
    <div class="rail-nav"><button type="button" data-rail="${id}" data-dir="1" aria-label="السابق">›</button><button type="button" data-rail="${id}" data-dir="-1" aria-label="التالي">‹</button></div></div>
    <div class="rail-track" id="${id}">${items.map((e, k) => cardHTML(e, ranked ? k + 1 : 0)).join("")}</div></section>`;
}
function timeBtn(s, label) {
  const f = fmt(s.t), c = IDX.cinema[s.c];
  return `<a class="time${s.ms - Date.now() < 45 * 60000 ? " soon" : ""}" href="${esc(s.u || chainOf(c).url)}" target="_blank" rel="noopener" aria-label="احجز ${f.hm} ${f.ap}${label ? " في " + esc(label) : ""}">${f.hm}<small>${f.ap}</small></a>`;
}
function emptyHTML(t, b) { return `<div class="empty"><strong>${esc(t)}</strong>${esc(b)}</div>`; }
function freshHTML() {
  const a = ago(DATA.generated_at);
  const failed = Object.values(DATA.sources || {}).some((v) => v.status !== "ok");
  return `<span class="fresh ${a.min <= 90 && !failed ? "ok" : "stale"}">${a.t}</span>`;
}

// اختيار السينما: كل دار وتحتها فروعها
function cinemaOptions(ids) {
  const cins = DATA.cinemas.filter((c) => c.mode === "auto" && c.city === state.city && (!ids || ids.has(c.id)));
  const by = {}; cins.forEach((c) => (by[c.chain] ||= []).push(c));
  return `<option value="all">كل السينمات</option>` + Object.entries(by).map(([k, list]) => `<optgroup label="${esc(DATA.chains[k]?.name || k)}">${list.sort((a, b) => a.name.localeCompare(b.name, "ar")).map((c) => `<option value="${esc(c.id)}"${state.cinema === c.id ? " selected" : ""}>${esc(c.name)}</option>`).join("")}</optgroup>`).join("");
}
function toolbarHTML({ times = false, genres = [], sort = false } = {}) {
  const fmts = [...new Set(DATA.shows.filter((s) => IDX.cinema[s.c]?.city === state.city).map((s) => s.f))].sort((a, b) => (a === "Standard" ? -1 : b === "Standard" ? 1 : a.localeCompare(b)));
  const nF = state.formats.size + state.langs.size;
  const now = Date.now();
  const tOpts = [["any", "أي وقت"], ["now", "الحين"]];
  CONFIG.quickHours.forEach((h) => { const k = `${String(h).padStart(2, "0")}:00`; if (atHour(k, now) + 30 * 60000 > now) tOpts.push([k, hourLabel(h)]); });
  return `<section class="toolbar" aria-label="الفلاتر">
    ${times ? `<div class="trow"><span class="flabel">متى؟</span><div class="chips">${tOpts.map(([k, v]) => `<button type="button" class="chip" data-time="${k}" aria-pressed="${!state.custom && state.time === k}">${v}</button>`).join("")}</div>
      <label class="pick${state.custom ? " on" : ""}" for="customTime"><span>وقت آخر</span><input type="time" id="customTime" step="900" value="${esc(state.custom)}"></label></div>` : ""}
    ${genres.length > 1 ? `<div class="trow"><span class="flabel">النوع</span><div class="chips">${[["all", "الكل"], ...genres.map((g) => [g, g])].map(([k, v]) => `<button type="button" class="chip" data-genre="${esc(k)}" aria-pressed="${state.genre === k}">${esc(v)}</button>`).join("")}</div></div>` : ""}
    <div class="trow split">
      <label class="pick${state.cinema !== "all" ? " on" : ""}" for="cinemaSel"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8"/></svg><select id="cinemaSel" aria-label="السينما">${cinemaOptions()}</select></label>
      <div class="trow" style="gap:8px">
        ${sort ? `<label class="pick" for="sortSel"><span>الترتيب</span><select id="sortSel"><option value="next"${state.sort === "next" ? " selected" : ""}>الأقرب وقتاً</option><option value="rating"${state.sort === "rating" ? " selected" : ""}>الأعلى تقييماً</option><option value="popular"${state.sort === "popular" ? " selected" : ""}>الأكثر عرضاً</option></select></label>` : ""}
        <button type="button" class="filter-btn${nF ? " on" : ""}" id="filterBtn" aria-expanded="${state.filtersOpen}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"/></svg>فلاتر${nF ? ` <span class="count">${nF}</span>` : ""}</button>
      </div>
    </div>
    <div class="more-filters"${state.filtersOpen ? "" : " hidden"} id="moreFilters">
      <div class="trow"><span class="flabel">الشاشة</span><div class="chips">${fmts.map((f) => `<button type="button" class="chip" data-fmt="${esc(f)}" aria-pressed="${state.formats.has(f)}">${esc(EXP_AR[f] || f)}</button>`).join("")}</div></div>
      <div class="trow"><span class="flabel">اللغة</span><div class="chips">${["عربي", "إنجليزي"].map((l) => `<button type="button" class="chip" data-lang="${l}" aria-pressed="${state.langs.has(l)}">${l}</button>`).join("")}</div></div>
    </div>
  </section>`;
}
function linkChains() { return [...new Set(DATA.cinemas.filter((c) => c.mode === "link" && (c.city === state.city || c.city === "all")).map((c) => c.chain))]; }

// ---------- البلبورد ----------
const hero = { list: [], i: 0, timer: null };
function billboardHTML() {
  hero.list = entries().map((e) => ({ ...e, score: e.n * ((parseFloat(e.m.imdb_rating) || 6) / 7) * (e.m.poster ? 1.3 : 1) })).sort((a, b) => b.score - a.score).slice(0, 5);
  if (!hero.list.length) return "";
  hero.i = Math.min(hero.i, hero.list.length - 1);
  return `<section class="billboard" id="billboard" aria-label="فلم مميز">${billboardInner()}</section>`;
}
function billboardInner() {
  const e = hero.list[hero.i], m = e.m;
  const next = DATA.shows.filter((s) => s.m === m.id && showOk(s)).sort((a, b) => a.ms - b.ms).slice(0, 4);
  const bg = m.backdrop ? `<div class="bb-bg" style="background-image:url('${esc(m.backdrop)}')"></div>` : m.poster ? `<div class="bb-bg soft" style="background-image:url('${esc(m.poster)}')"></div>` : `<div class="bb-bg" style="background:${phColor(m.id)}"></div>`;
  return `${bg}<div class="wrap bb-in">
    <a class="bb-poster" href="#/movie/${esc(m.id)}" aria-label="${esc(titleOf(m))}">${posterHTML(m)}</a>
    <div class="bb-txt"><span class="kicker">${hero.i === 0 ? `الأكثر عرضاً اليوم في ${esc(cityName())}` : `من أبرز أفلام اليوم في ${esc(cityName())}`}</span>
      <h2>${esc(titleOf(m))}</h2>
      <div class="tags">${m.imdb_rating ? `<span class="imdb-mark">IMDb ${esc(m.imdb_rating)}</span>` : ""}${m.rating ? `<span class="tag age">${esc(m.rating)}</span>` : ""}${(m.genres || []).slice(0, 2).map((g) => `<span class="tag">${esc(g)}</span>`).join("")}${m.runtime ? `<span class="tag">${runtimeTxt(m.runtime)}</span>` : ""}</div>
      ${m.overview ? `<p>${esc(m.overview)}</p>` : ""}
      <div class="bb-next"><span>أقرب العروض</span>${next.map((s) => timeBtn(s, IDX.cinema[s.c]?.name)).join("")}</div>
      <div class="actions"><a class="btn primary" href="#/movie/${esc(m.id)}">كل المواعيد والتفاصيل</a>${m.trailer ? `<a class="btn ghost" href="${esc(m.trailer)}" target="_blank" rel="noopener"><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4v16l13-8z"/></svg>الإعلان</a>` : ""}</div>
    </div></div>
    ${hero.list.length > 1 ? `<div class="bb-dots">${hero.list.map((x, i) => `<button type="button" data-hero="${i}" aria-label="${esc(titleOf(x.m))}" aria-current="${i === hero.i}"></button>`).join("")}</div>` : ""}`;
}
function startHero() {
  clearInterval(hero.timer);
  if (hero.list.length > 1 && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    hero.timer = setInterval(() => { const el = $("billboard"); if (!el) return clearInterval(hero.timer); hero.i = (hero.i + 1) % hero.list.length; el.innerHTML = billboardInner(); }, 8000);
  }
}

// ---------- الصفحات ----------
function pageHome() {
  const list = entries();
  const now = Date.now();
  const totalShows = DATA.shows.filter((s) => showOk(s)).length;
  const branches = new Set(DATA.shows.filter((s) => showOk(s)).map((s) => s.c)).size;
  const showcase = [...list].sort((a, b) => b.n - a.n).slice(0, 4);
  const rails = [];
  const soon = list.filter((e) => e.next.ms - now <= 75 * 60000);
  if (soon.length >= 2) rails.push(railHTML("يبدأ قريب", "خلال ساعة وربع", soon));
  if (list.length >= 5) rails.push(railHTML("الأكثر عرضاً اليوم", "", [...list].sort((a, b) => b.n - a.n).slice(0, 10), true));
  const top = list.filter((e) => parseFloat(e.m.imdb_rating) >= 6.5).sort((a, b) => parseFloat(b.m.imdb_rating) - parseFloat(a.m.imdb_rating));
  if (top.length >= 3) rails.push(railHTML("الأعلى تقييماً", "على IMDb", top));
  const fam = list.filter((e) => /^(G|PG)$/i.test(e.m.rating || ""));
  if (fam.length >= 3) rails.push(railHTML("للعائلة", "مناسب لكل الأعمار", fam));
  const gc = {}; list.forEach((e) => (e.m.genres || []).forEach((g) => (gc[g] = (gc[g] || 0) + 1)));
  Object.entries(gc).filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 2).forEach(([g]) => rails.push(railHTML(g, "", list.filter((e) => (e.m.genres || []).includes(g)))));
  const collage = list.slice(0, 12).map((e) => posterHTML(e.m)).join("");

  return `${billboardHTML()}
  <div class="wrap page">
    ${list.length ? `<section style="display:flex;flex-direction:column;gap:24px">
      ${secHead(`في ${esc(cityName())} اليوم`, "يعرض", "الآن", ["#/movies", "كل الأفلام"])}
      <div class="showcase">${showcase.map((e) => `<a class="sc-card" href="#/movie/${esc(e.m.id)}">${posterHTML(e.m)}
        <span class="rate">${e.m.imdb_rating ? `<b>★ ${esc(e.m.imdb_rating)}</b>` : ""}<span>${esc(metaTxt(e.m))}</span></span>
        <h3>${esc(titleOf(e.m))}</h3>${e.m.overview ? `<p>${esc(e.m.overview)}</p>` : ""}
        <span class="card-next"><b>أقرب عرض ${fmtTxt(e.next.t)}</b> <span>· ${nShows(e.n)}</span></span></a>`).join("")}</div>
    </section>` : emptyHTML("ما فيه عروض باقية اليوم في هالمدينة", "جرّب مدينة ثانية، أو ارجع بكرة.")}

    ${rails.length ? `<section style="display:flex;flex-direction:column;gap:24px">${secHead("تصفح", "اختر على", "مزاجك")}<div class="rails">${rails.join("")}</div></section>` : ""}

    <section class="why">
      <div class="why-art" aria-hidden="true"><div class="collage">${collage}${collage}</div></div>
      <div class="feat">
        ${secHead("ليش Cinemap", "أكثر من", "مواعيد")}
        <div class="feat-item"><span class="feat-ic"><svg viewBox="0 0 24 24"><path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/></svg></span><div><h3>كل الدور في خريطة وحدة</h3><p>بدال ما تفتح موقع كل سينما لحاله، تشوف كل الأفلام وأوقاتها في صفحة وحدة.</p></div></div>
        <div class="feat-item"><span class="feat-ic"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></span><div><h3>ابدأ من الوقت</h3><p>عندك موعد الساعة 9؟ اختر الوقت ونوريك كل اللي يعرض فيه، في كل الفروع.</p></div></div>
        <div class="feat-item"><span class="feat-ic"><svg viewBox="0 0 24 24"><path d="M4 7h16v4a2 2 0 0 0 0 4v4H4v-4a2 2 0 0 0 0-4z"/><path d="M10 7v12"/></svg></span><div><h3>احجز من الدار مباشرة</h3><p>نوديك لصفحة الحجز الرسمية للعرض نفسه. بدون رسوم، وبدون حسابات.</p></div></div>
      </div>
    </section>

    <section class="stats" aria-label="أرقام اليوم">
      <div class="stat"><b>${list.length}</b><span>فلم يعرض اليوم</span></div>
      <div class="stat"><b>${totalShows}</b><span>عرض باقي اليوم</span></div>
      <div class="stat"><b>${branches}</b><span>فرع في ${esc(cityName())}</span></div>
      <div class="stat"><b>${DATA.cities.length}</b><span>مدينة في المملكة</span></div>
    </section>

    <section class="two-col faq">
      ${secHead("عندك سؤال؟", "الأسئلة", "الشائعة", ["#/about", "كل الأسئلة"])}
      <div class="faq-list">${FAQ.slice(0, 4).map(faqItem).join("")}</div>
    </section>
  </div>`;
}

function pageMovies() {
  const q = norm(state.q);
  let list = entries({ q });
  const genres = [...new Set(list.flatMap((e) => e.m.genres || []))];
  if (state.genre !== "all") list = list.filter((e) => (e.m.genres || []).includes(state.genre));
  if (state.sort === "rating") list.sort((a, b) => (parseFloat(b.m.imdb_rating) || 0) - (parseFloat(a.m.imdb_rating) || 0));
  if (state.sort === "popular") list.sort((a, b) => b.n - a.n);
  const cin = state.cinema !== "all" ? IDX.cinema[state.cinema] : null;
  return `<div class="wrap page tight">
    <div class="page-head"><span class="kicker">${q ? "نتائج البحث" : "تصفح"}</span>
      <h1>${q ? `"${esc(state.q)}"` : `أفلام <em>${esc(cin ? cin.name : cityName())}</em>`}</h1>
      <p class="meta-line">${nMovies(list.length)} اليوم · ${freshHTML()}</p></div>
    ${toolbarHTML({ genres, sort: true })}
    ${list.length ? `<div class="grid">${list.map((e) => cardHTML(e)).join("")}</div>` : emptyHTML(q ? `ما لقينا "${state.q}"` : "ما فيه أفلام بهالفلاتر", "جرّب تكتب الاسم بالإنجليزي، أو شيل بعض الفلاتر.")}
  </div>`;
}

function timeWindow() {
  const now = Date.now(), key = state.custom || state.time;
  if (key === "any") return [now - 10 * 60000, Infinity];
  const t0 = key === "now" ? now : atHour(key, now);
  return [t0 - 10 * 60000, t0 + CONFIG.windowMin * 60000];
}
function pageTimes() {
  const [a, b] = timeWindow();
  const now = Date.now();
  const list = DATA.shows.filter((s) => showOk(s) && s.ms >= a && s.ms <= b && IDX.movie[s.m]).sort((x, y) => x.ms - y.ms);
  const key = state.custom || state.time;
  const label = key === "any" ? "الليلة" : key === "now" ? "الحين" : (() => { const f = fmt(`T${key}`); return `الساعة ${f.hm} ${f.ap}`; })();
  let body;
  if (list.length) {
    body = `<div class="rows">${list.slice(0, 150).map((s) => {
      const m = IDX.movie[s.m], c = IDX.cinema[s.c], f = fmt(s.t), mins = Math.round((s.ms - now) / 60000);
      return `<article class="row"><div class="when"><b>${f.hm}</b><small>${f.ap}</small></div>
        <a class="thumb" href="#/movie/${esc(m.id)}" tabindex="-1" aria-hidden="true">${m.poster ? `<img src="${esc(m.poster)}" alt="" loading="lazy">` : `<span style="display:block;width:100%;height:100%;background:${phColor(m.id)}"></span>`}</a>
        <div class="what"><a href="#/movie/${esc(m.id)}">${esc(titleOf(m))}</a>
          <span class="where"><a href="#/cinema/${esc(c.id)}" style="color:inherit">${esc(c.name)}</a> · ${esc(chainOf(c).name || "")}${mins >= 0 && mins <= 30 ? ` <span class="soon-tag">· يبدأ بعد ${mins} د</span>` : ""}</span>
          <span class="mini-tags"><span class="fmt">${esc(EXP_AR[s.f] || s.f)}</span>${m.imdb_rating ? `<span class="imdb">IMDb ${esc(m.imdb_rating)}</span>` : ""}${m.rating ? `<span>${esc(m.rating)}</span>` : ""}${s.l || m.language ? `<span>${esc(s.l || m.language)}</span>` : ""}</span></div>
        <a class="btn primary" href="${esc(s.u || chainOf(c).url)}" target="_blank" rel="noopener">احجز ↗</a></article>`;
    }).join("")}</div>`;
  } else {
    const nx = DATA.shows.filter((s) => showOk(s) && s.ms > b).sort((x, y) => x.ms - y.ms)[0];
    body = emptyHTML("ما فيه عروض تبدأ في هالوقت", nx ? `أقرب عرض بعده الساعة ${fmtTxt(nx.t)}. جرّب وقت ثاني.` : "جرّب سينما ثانية أو شيل بعض الفلاتر.");
  }
  return `<div class="wrap page tight">
    <div class="page-head"><span class="kicker">ابحث بالوقت</span><h1>وش يعرض <em>${esc(label)}</em>؟</h1>
      <p class="meta-line">${nShows(list.length)} تبدأ ${key === "any" ? "باقي اليوم" : "خلال ساعة ونص"} · ${freshHTML()}</p></div>
    ${toolbarHTML({ times: true })}
    ${body}
  </div>`;
}

function pageCinemas() {
  const cins = DATA.cinemas.filter((c) => c.mode === "auto" && c.city === state.city);
  const cards = cins.map((c) => {
    const ss = DATA.shows.filter((s) => s.c === c.id && showOk(s, { ignoreCinema: true }));
    const ms = [...new Set(ss.map((s) => s.m))];
    return { c, n: ss.length, movies: ms, next: ss.sort((a, b) => a.ms - b.ms)[0] };
  }).sort((a, b) => b.n - a.n);
  const links = linkChains();
  return `<div class="wrap page tight">
    <div class="page-head"><span class="kicker">${esc(cityName())}</span><h1>السينمات <em>وفروعها</em></h1>
      <p>اختر الفرع اللي تفضله وشوف كل أفلامه ومواعيده اليوم.</p></div>
    <div class="cin-grid">
      ${cards.map(({ c, n, movies, next }) => `<a class="cin-card" href="#/cinema/${esc(c.id)}">
        <span class="kicker">${esc(chainOf(c).name || "")}</span><h3>${esc(c.name)}</h3>
        <span class="cnt">${n ? `${nMovies(movies.length)} · ${nShows(n)} اليوم${next ? ` · أقرب عرض ${fmtTxt(next.t)}` : ""}` : "خلصت عروض اليوم"}</span>
        <div class="thumbs">${movies.slice(0, 6).map((id) => posterHTML(IDX.movie[id])).join("")}</div>
        <span class="go">شوف الأفلام والمواعيد ←</span></a>`).join("")}
      ${links.map((k) => `<a class="cin-card link" href="${esc(DATA.chains[k]?.url)}" target="_blank" rel="noopener">
        <span class="kicker">مواعيدها في موقعها</span><h3>${esc(DATA.chains[k]?.name || k)}</h3>
        <span class="cnt">نشتغل على إضافة مواعيدها هنا.</span><span class="go">افتح موقعهم ↗</span></a>`).join("")}
    </div>
  </div>`;
}

function showtimesBlock(rowsData) {
  return `<div class="st-list">${rowsData.map((r) => `<div class="st-row">
      <div class="st-cin">${r.poster || ""}<div><b>${r.title}</b><span>${r.sub}</span></div></div>
      <div class="st-groups">${r.groups.map((g) => `<div class="st-group"><span class="st-fmt">${esc(EXP_AR[g.f] || g.f)}</span><div class="times">${g.ss.map((s) => timeBtn(s, r.label)).join("")}</div></div>`).join("")}</div>
    </div>`).join("")}</div>`;
}
function groupShows(shows, keyFn) {
  const m = new Map();
  shows.forEach((s) => { const k = keyFn(s); if (!m.has(k)) m.set(k, new Map()); const g = m.get(k); if (!g.has(s.f)) g.set(s.f, []); g.get(s.f).push(s); });
  return [...m.entries()].map(([k, g]) => ({ k, groups: [...g.entries()].map(([f, ss]) => ({ f, ss: ss.sort((a, b) => a.ms - b.ms) })) }))
    .sort((a, b) => Math.min(...a.groups.map((g) => g.ss[0].ms)) - Math.min(...b.groups.map((g) => g.ss[0].ms)));
}

function pageCinema(id) {
  const c = IDX.cinema[id];
  if (!c) return `<div class="wrap page">${emptyHTML("الفرع مو موجود", "ارجع لصفحة السينمات واختر فرع ثاني.")}</div>`;
  const shows = DATA.shows.filter((s) => s.c === id && showOk(s, { ignoreCinema: true }));
  const rows = groupShows(shows, (s) => s.m).map(({ k, groups }) => { const m = IDX.movie[k]; return { poster: `<a href="#/movie/${esc(m.id)}" tabindex="-1" aria-hidden="true">${posterHTML(m)}</a>`, title: `<a href="#/movie/${esc(m.id)}">${esc(titleOf(m))}</a>`, sub: esc([m.imdb_rating ? "IMDb " + m.imdb_rating : "", m.rating, metaTxt(m)].filter(Boolean).join(" · ")), label: c.name, groups }; });
  return `<div class="wrap page tight">
    <a class="back" href="#/cinemas">→ كل السينمات</a>
    <div class="page-head"><span class="kicker">${esc(chainOf(c).name || "")} · ${esc(cityName())}</span><h1>${esc(c.name)}</h1>
      <p class="meta-line">${nMovies(rows.length)} · ${nShows(shows.length)} باقية اليوم · ${freshHTML()}</p></div>
    <div class="actions"><button type="button" class="btn${state.cinema === id ? " primary" : ""}" data-fav="${esc(id)}">${state.cinema === id ? "✓ هذي سينماك في كل الموقع" : "اعرض أفلام هالفرع بس في كل الموقع"}</button>
      <a class="btn" href="${esc(chainOf(c).url)}" target="_blank" rel="noopener">موقع ${esc(chainOf(c).name || "الدار")} ↗</a></div>
    ${rows.length ? showtimesBlock(rows) : emptyHTML("خلصت عروض اليوم في هالفرع", "ارجع بكرة، أو شوف فرع ثاني.")}
  </div>`;
}

function pageMovie(id) {
  const m = IDX.movie[id];
  if (!m) return `<div class="wrap page">${emptyHTML("الفلم مو موجود", "ممكن خلصت عروضه.")}</div>`;
  const base = DATA.shows.filter((s) => s.m === id && showOk(s, { ignoreCinema: true }));
  const cinIds = new Set(base.map((s) => s.c));
  if (state.cinema !== "all") cinIds.add(state.cinema);
  const visible = base.filter((s) => (state.cinema === "all" || s.c === state.cinema) && (state.mvFormat === "all" || s.f === state.mvFormat));
  const fmts = [...new Set(base.map((s) => s.f))];
  const rows = groupShows(visible, (s) => s.c).map(({ k, groups }) => { const c = IDX.cinema[k]; return { title: `<a href="#/cinema/${esc(c.id)}">${esc(c.name)}</a>`, sub: esc(chainOf(c).name || ""), label: c.name, groups }; });
  const others = entries().filter((e) => e.m.id !== id).sort((a, b) => b.n - a.n).slice(0, 12);
  const links = linkChains();
  document.title = `${titleOf(m)} | Cinemap`;
  return `<div class="wrap page">
    <div style="display:flex;flex-direction:column;gap:24px">
      <a class="back" href="#/movies">→ كل الأفلام</a>
      <div class="mv-top">
        <div class="mv-poster">${posterHTML(m)}</div>
        <div class="mv-info">
          <div><span class="kicker">${esc((m.genres || []).join(" · ") || "يعرض الآن")}</span><h1>${esc(titleOf(m))}</h1>${enOf(m) || m.release_date ? `<div class="mv-en">${esc([enOf(m), (m.release_date || "").slice(0, 4)].filter(Boolean).join(" · "))}</div>` : ""}</div>
          <div class="tags">${m.rating ? `<span class="tag age">${esc(m.rating)}</span>` : ""}${m.runtime ? `<span class="tag">${runtimeTxt(m.runtime)}</span>` : ""}${m.language ? `<span class="tag">${esc(m.language)}</span>` : ""}</div>
          <div class="stat-row">
            ${m.imdb_rating ? `<div class="statbox"><span class="imdb-mark">IMDb</span><span class="big">${esc(m.imdb_rating)}<small>/10</small></span>${m.imdb_votes ? `<span class="lbl">من ${votesTxt(m.imdb_votes)} تقييم</span>` : ""}</div>` : ""}
            <div class="statbox"><span class="lbl">عروض اليوم</span><span class="big">${base.length}</span><span class="lbl">في ${nBranches(cinIds.size - (state.cinema !== "all" && !base.some((s) => s.c === state.cinema) ? 1 : 0))}</span></div>
          </div>
          ${m.overview ? `<p class="overview">${esc(m.overview)}</p>` : ""}
          ${m.director || (m.cast || []).length ? `<dl class="credits">${m.director ? `<dt>الإخراج</dt><dd>${esc(m.director)}</dd>` : ""}${(m.cast || []).length ? `<dt>البطولة</dt><dd>${esc(m.cast.join("، "))}</dd>` : ""}</dl>` : ""}
          <div class="actions"><a class="btn primary" href="#showtimes" data-scroll>شوف المواعيد</a>
            ${m.trailer ? `<a class="btn" href="${esc(m.trailer)}" target="_blank" rel="noopener"><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4v16l13-8z"/></svg>الإعلان</a>` : ""}
            ${m.imdb_id ? `<a class="btn" href="https://www.imdb.com/title/${esc(m.imdb_id)}/" target="_blank" rel="noopener">صفحته في IMDb ↗</a>` : ""}</div>
        </div>
      </div>
    </div>

    <section id="showtimes" style="display:flex;flex-direction:column;gap:18px">
      ${secHead(`في ${esc(cityName())}`, "مواعيد", "اليوم")}
      <div class="trow split">
        ${fmts.length > 1 ? `<div class="chips">${[["all", "الكل"], ...fmts.map((f) => [f, EXP_AR[f] || f])].map(([k, v]) => `<button type="button" class="chip" data-mvf="${esc(k)}" aria-pressed="${state.mvFormat === k}">${esc(v)}</button>`).join("")}</div>` : "<span></span>"}
        <label class="pick${state.cinema !== "all" ? " on" : ""}" for="mvCinema"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8"/></svg><select id="mvCinema" aria-label="السينما">${cinemaOptions(cinIds)}</select></label>
      </div>
      ${rows.length ? showtimesBlock(rows) : emptyHTML("ما فيه عروض باقية اليوم بهالاختيار", "اختر \"كل السينمات\" أو نوع شاشة ثاني.")}
      <p class="st-note">اضغط الوقت وتكمل الحجز في موقع الدار.${links.length ? ` ممكن يعرض كمان في ${links.map((k) => `<a href="${esc(DATA.chains[k]?.url)}" target="_blank" rel="noopener">${esc(DATA.chains[k]?.name || k)}</a>`).join("، ")}.` : ""}</p>
    </section>

    ${others.length >= 2 ? `<section style="display:flex;flex-direction:column;gap:20px">${secHead("بعد", "أفلام ثانية", "تعرض اليوم")}<div class="rails">${railHTML("", "", others)}</div></section>` : ""}
  </div>`;
}

const FAQ = [
  ["وش هو Cinemap؟", "موقع مجاني يجمع مواعيد أفلام السينما في السعودية في مكان واحد. تقدر تدور بالفلم، أو تختار الوقت اللي يناسبك وتشوف وش يعرض فيه، وبعدها تحجز من موقع الدار نفسها."],
  ["هل أقدر أحجز من Cinemap؟", "لا. لما تضغط على وقت العرض ننقلك لصفحة الحجز في موقع الدار الرسمي، وهناك تختار مقعدك وتدفع. ما نستلم أي دفع ولا نضيف أي رسوم."],
  ["كل كم تتحدث المواعيد؟", "كل ساعة تقريباً، ووقت آخر تحديث مكتوب في الصفحات. ممكن الدار تعدّل عرض بعد آخر تحديث، فتأكد من الوقت في صفحة الحجز قبل الدفع."],
  ["ليش ما ألقى مواعيد موفي وإمباير وAMC؟", "نعرض حالياً الدور اللي نقدر نجمع مواعيدها بشكل نظامي، ونشتغل على إضافة الباقي. إلى ذاك الحين تلقى روابطها المباشرة في صفحة السينمات."],
  ["عرض الساعة 12:30 بالليل، يتبع أي يوم؟", "العروض اللي بعد منتصف الليل تطلع مع عروض الليلة نفسها، مثل ما تعرضها الدور."],
  ["وش يعني التصنيف العمري مثل PG12 و R15؟", "هو تصنيف الهيئة العامة للإعلام المرئي والمسموع. G للجميع. PG بإشراف الأهل. PG12 و PG15 ينصح بمرافقة الأهل لمن هم أقل من هالعمر. R12 و R15 و R18 ما يسمح بالدخول لمن هم أقل من العمر المذكور، والدار ممكن تطلب الهوية."],
  ["من وين تجي التقييمات ومعلومات الأفلام؟", "تقييم IMDb والملصقات ومعلومات الأفلام من خدمة OMDb، والمواعيد من مواقع الدور. التقييم يتحدث مرة باليوم."],
  ["هل تحفظون أي بيانات عني؟", "لا. ما فيه حسابات ولا تسجيل، ونقيس بس عدد الزيارات بشكل عام. المدينة والسينما اللي تختارها تنحفظ في متصفحك بس، عشان ما تحتاج تختارها كل مرة."],
];
const faqItem = ([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`;

function pageAbout() {
  return `<div class="wrap page">
    <div class="page-head"><span class="kicker">عن Cinemap</span><h1>السينما كلها، <em>في خريطة وحدة</em></h1>
      <p>بدأت الفكرة من موقف بسيط: تجتمع مع أحد وتبون فلم بساعة معينة، وتقعد تفتح موقع كل سينما لحاله. Cinemap يجمع كل هذا في مكان واحد، ويخليك تبدأ من الوقت أو من الفلم.</p></div>
    <section style="display:flex;flex-direction:column;gap:22px">
      ${secHead("كيف يشتغل", "ثلاث", "خطوات")}
      <div class="steps">
        <div class="step"><span class="n">١</span><h3>نجمع المواعيد</h3><p>كل ساعة نحدّث مواعيد الدور من صفحاتها العامة، ونوحّد أسماء الأفلام بين الدور.</p></div>
        <div class="step"><span class="n">٢</span><h3>تختار بطريقتك</h3><p>بالفلم، أو بالوقت، أو بالسينما اللي تحبها. وكل فلم معه تقييمه وقصته.</p></div>
        <div class="step"><span class="n">٣</span><h3>تحجز من الدار</h3><p>تضغط الوقت وننقلك لصفحة الحجز الرسمية. بدون رسوم وبدون حساب.</p></div>
      </div>
    </section>
    <section class="two-col faq" id="faq">
      ${secHead("عندك سؤال؟", "الأسئلة", "الشائعة")}
      <div class="faq-list">${FAQ.map(faqItem).join("")}</div>
    </section>
    <section class="two-col">
      ${secHead("تواصل معنا", "عندك", "ملاحظة؟")}
      <div class="faq-list"><p style="margin:0;color:var(--ink-2);line-height:1.9">لقيت موعد غلط، أو عندك اقتراح، أو تمثل دار سينما وتبي تتعاون معنا؟ راسلنا على
        <a href="mailto:${CONFIG.contact}" dir="ltr">${CONFIG.contact}</a></p></div>
    </section>
  </div>`;
}

// ---------- التنقل ----------
function route() {
  if (!DATA) return;
  clearInterval(hero.timer); railSeq = 0;
  const h = location.hash || "#/";
  let m, html, nav = "home";
  document.title = "Cinemap | مواعيد السينما في السعودية";
  if ((m = /^#\/movie\/([\w-]+)/.exec(h))) { html = pageMovie(m[1]); nav = "movies"; }
  else if ((m = /^#\/cinema\/([\w:.-]+)/.exec(h))) { html = pageCinema(decodeURIComponent(m[1])); nav = "cinemas"; }
  else if (h.startsWith("#/movies")) { html = pageMovies(); nav = "movies"; }
  else if (h.startsWith("#/times")) { html = pageTimes(); nav = "times"; }
  else if (h.startsWith("#/cinemas")) { html = pageCinemas(); nav = "cinemas"; }
  else if (h.startsWith("#/about")) { html = pageAbout(); nav = "about"; }
  else if (h.startsWith("#/") || h === "#") { html = pageHome(); nav = "home"; }
  else return; // روابط داخل الصفحة مثل #showtimes
  $("view").innerHTML = html;
  document.querySelectorAll("[data-nav]").forEach((a) => (a.dataset.nav === nav ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  if (nav === "home") startHero();
  footer();
}
function go(rerenderOnly) {
  const y = window.scrollY;
  route();
  if (rerenderOnly) window.scrollTo(0, y);
}
window.addEventListener("hashchange", () => {
  const h = location.hash;
  if (!h.startsWith("#/")) return; // قفزة داخل الصفحة
  route();
  const faq = h.includes("#faq") && $("faq");
  window.scrollTo(0, faq ? faq.getBoundingClientRect().top + window.scrollY - 80 : 0);
});
function footer() {
  $("footChains").innerHTML = Object.entries(DATA.chains).map(([, c]) => `<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.name)} ↗</a>`).join("");
}

// ---------- الأحداث (تفويض) ----------
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-time],[data-fmt],[data-lang],[data-genre],[data-mvf],[data-hero],[data-rail],[data-scroll],[data-fav],#filterBtn");
  if (!t) return;
  if (t.id === "filterBtn") { state.filtersOpen = !state.filtersOpen; return go(true); }
  if (t.dataset.time) { state.time = t.dataset.time; state.custom = ""; return go(true); }
  if (t.dataset.fmt) { state.formats.has(t.dataset.fmt) ? state.formats.delete(t.dataset.fmt) : state.formats.add(t.dataset.fmt); return go(true); }
  if (t.dataset.lang) { state.langs.has(t.dataset.lang) ? state.langs.delete(t.dataset.lang) : state.langs.add(t.dataset.lang); return go(true); }
  if (t.dataset.genre) { state.genre = t.dataset.genre; return go(true); }
  if (t.dataset.mvf) { state.mvFormat = t.dataset.mvf; return go(true); }
  if (t.dataset.fav) { setCinema(state.cinema === t.dataset.fav ? "all" : t.dataset.fav); return go(true); }
  if (t.dataset.hero) { clearInterval(hero.timer); hero.i = +t.dataset.hero; $("billboard").innerHTML = billboardInner(); return; }
  if (t.dataset.rail) { const tr = $(t.dataset.rail); tr.scrollBy({ left: +t.dataset.dir * tr.clientWidth * -0.8, behavior: "smooth" }); return; }
  if (t.dataset.scroll !== undefined) { e.preventDefault(); $("showtimes")?.scrollIntoView({ behavior: "smooth" }); }
});
document.addEventListener("change", (e) => {
  const t = e.target;
  if (t.id === "cinemaSel" || t.id === "mvCinema") { setCinema(t.value); return go(true); }
  if (t.id === "sortSel") { state.sort = t.value; return go(true); }
  if (t.id === "customTime") { state.custom = t.value || ""; return go(true); }
  if (t.id === "city") { state.city = t.value; store.set("city", state.city); setCinema("all"); hero.i = 0; return go(true); }
});
function setCinema(id) { state.cinema = id; store.set("cinema", id); }

$("searchForm").addEventListener("submit", (e) => { e.preventDefault(); $("q").blur(); });
$("q").addEventListener("input", (e) => {
  state.q = e.target.value;
  if (!location.hash.startsWith("#/movies")) location.hash = "#/movies"; else go(true);
});

// ---------- التحميل ----------
async function load() {
  try {
    const r = await fetch("data/showtimes.json", { cache: "no-store" });
    if (!r.ok) throw new Error(r.status);
    DATA = await r.json();
  } catch (e) {
    $("view").innerHTML = `<div class="wrap page">${emptyHTML("ما قدرنا نحمّل المواعيد", "حدّث الصفحة بعد شوي.")}</div>`;
    return;
  }
  DATA.movies.forEach((m) => (IDX.movie[m.id] = m));
  DATA.cinemas.forEach((c) => (IDX.cinema[c.id] = c));
  DATA.shows.forEach((s) => (s.ms = new Date(s.t).getTime()));
  $("sampleBanner").hidden = !DATA.sample;
  const saved = store.get("city");
  state.city = DATA.cities.some((c) => c.id === saved) ? saved : DATA.cities[0]?.id;
  $("city").innerHTML = DATA.cities.map((c) => `<option value="${esc(c.id)}"${c.id === state.city ? " selected" : ""}>${esc(c.name)}</option>`).join("");
  const sc = store.get("cinema");
  state.cinema = sc && IDX.cinema[sc]?.city === state.city ? sc : "all";
  route();
}
setInterval(() => { if (DATA && !location.hash.startsWith("#/movie/") && document.visibilityState === "visible" && !document.activeElement?.matches("input,select")) go(true); }, 120000);
load();
