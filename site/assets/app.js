// Cinemap: الواجهة. تقرأ data/showtimes.json اللي يحدّثه GitHub Actions كل ساعة.
// الصفحات: #/  #/movies  #/times  #/cinemas  #/cinema/<id>  #/movie/<id>  #/about
"use strict";

const CONFIG = { tzOffsetMin: 180, cutoffHour: 5, windowMin: 90, quickHours: [17, 18, 19, 20, 21, 22, 23, 0], contact: "cinemap.app@gmail.com" };
const EXP_AR = { Standard: "عادي", Kids: "أطفال", Premium: "بريميوم", Theatre: "ثياتر", VIP: "VIP", IMAX: "IMAX", MAX: "MAX", "4DX": "4DX", ScreenX: "ScreenX", Dolby: "Dolby" };
const PH_COLORS = ["#2A3150", "#283A4A", "#3A3150", "#2F3B45", "#33304A", "#253447"];

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };

// ---------- اللغة: عربي / English ----------
// ?lang=en في الرابط، وإلا اختيار الزائر المحفوظ، وإلا لغة المتصفح
const LANG = (() => {
  const q = new URLSearchParams(location.search).get("lang");
  if (q === "en" || q === "ar") { store.set("lang", q); return q; }
  const s = store.get("lang");
  if (s === "en" || s === "ar") return s;
  return /^ar/i.test(navigator.language || "ar") ? "ar" : "en";
})();
const EN = LANG === "en";
const L = (ar, en) => (EN ? en : ar);
const GENRE_EN = { "أكشن": "Action", "مغامرة": "Adventure", "أنميشن": "Animation", "سيرة": "Biography", "كوميدي": "Comedy", "جريمة": "Crime", "وثائقي": "Documentary", "دراما": "Drama", "عائلي": "Family", "فانتازيا": "Fantasy", "تاريخي": "History", "رعب": "Horror", "موسيقى": "Music", "موسيقي": "Musical", "غموض": "Mystery", "رومانسي": "Romance", "خيال علمي": "Sci-Fi", "رياضة": "Sport", "إثارة": "Thriller", "حرب": "War", "غرب أمريكي": "Western" };
const LANG_EN = { "عربي": "Arabic", "إنجليزي": "English", "هندي": "Hindi", "مالايالامي": "Malayalam", "تاميلي": "Tamil", "تيلوغو": "Telugu", "فلبيني": "Filipino", "فرنسي": "French", "كوري": "Korean", "ياباني": "Japanese", "تركي": "Turkish" };
const CITY_EN = { riyadh: "Riyadh", jeddah: "Jeddah", dammam: "Dammam", khobar: "Khobar & Dhahran", jubail: "Jubail", makkah: "Makkah", madinah: "Madinah", abha: "Abha & Khamis Mushait", tabuk: "Tabuk", taif: "Taif", qassim: "Qassim", hail: "Hail", jazan: "Jazan", ahsa: "Al Ahsa", najran: "Najran", yanbu: "Yanbu", arar: "Arar", jouf: "Al Jouf", qatif: "Qatif", hafr: "Hafr Al Batin", baha: "Al Baha", other: "Other cities" };
const CINEMA_EN = { via: "VIA Riyadh", "the-spot-sheikh-jaber": "The Spot", "kingdom-centre": "Kingdom Centre" };
const G = (g) => (EN ? GENRE_EN[g] || g : g);
const LNG = (l) => (EN ? String(l || "").split(" / ").map((x) => LANG_EN[x] || x).join(" / ") : l || "");
const EXP = (f) => (EN ? f : EXP_AR[f] || f);
function cinName(c) {
  if (!c) return "";
  if (!EN) return c.name;
  let slug = String(c.id).split(":").pop();
  if (c.city) slug = slug.replace(new RegExp(`-${c.city}$`), "");
  return CINEMA_EN[slug] || slug.split("-").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
}
const chainName = (k) => { const ch = DATA.chains[k] || {}; return (EN && ch.name_en) || ch.name || k || ""; };

let DATA = null;
const IDX = { movie: {}, cinema: {} };
const state = { city: null, cinema: "all", formats: new Set(), langs: new Set(), genre: "all", q: "", time: "now", custom: "", sort: "next", mvFormat: "all", filtersOpen: false };

// ---------- أدوات الوقت والنص ----------
const parts = (ms) => { const d = new Date(ms + CONFIG.tzOffsetMin * 60000); return { y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours() }; };
function dayStart(nowMs) { const p = parts(nowMs); let b = Date.UTC(p.y, p.mo, p.d) - CONFIG.tzOffsetMin * 60000; if (p.h < CONFIG.cutoffHour) b -= 86400000; return b; }
function atHour(hhmm, nowMs) { const [h, m] = hhmm.split(":").map(Number); let t = dayStart(nowMs) + (h * 60 + m) * 60000; if (h < CONFIG.cutoffHour) t += 86400000; return t; }
function fmt(iso) { const m = /T(\d{2}):(\d{2})/.exec(iso); let h = +m[1]; const ap = h < 12 ? L("ص", "AM") : L("م", "PM"); h = h % 12 || 12; return { hm: `${h}:${m[2]}`, ap }; }
const fmtTxt = (iso) => { const f = fmt(iso); return `${f.hm} ${f.ap}`; };
const hourLabel = (h) => { const a = h < 12 ? L("ص", "AM") : L("م", "PM"); return `${h % 12 || 12} ${a}`; };
const runtimeTxt = (m) => (m ? (EN ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 60)}س ${m % 60}د`) : "");
const plural = (n, one, two, few, many) => (n === 1 ? one : n === 2 ? two : n <= 10 ? `${n} ${few}` : `${n} ${many}`);
const enN = (n, w) => `${n} ${w}${n === 1 ? "" : w.endsWith("ch") ? "es" : "s"}`;
const nMovies = (n) => (EN ? enN(n, "movie") : plural(n, "فلم واحد", "فلمين", "أفلام", "فلم"));
const nBranches = (n) => (EN ? enN(n, "branch") : plural(n, "فرع واحد", "فرعين", "فروع", "فرع"));
const nShows = (n) => (EN ? enN(n, "show") : plural(n, "عرض واحد", "عرضين", "عروض", "عرض"));
const norm = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[ً-ٟ̀-ͯ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
const titleOf = (m) => (EN ? m.title_en || m.title : m.title_ar || m.title);
const enOf = (m) => (!EN && m.title_ar ? m.title_en || m.title : "");
const phColor = (id) => PH_COLORS[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % PH_COLORS.length];
const cityLabel = (c) => (EN ? CITY_EN[c.id] || c.id : c.name);
const cityName = () => { const c = DATA.cities.find((x) => x.id === state.city); return c ? cityLabel(c) : ""; };
const chainOf = (c) => DATA.chains[c?.chain] || {};
const votesTxt = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(".0", "")}${L(" مليون", "M")}` : n >= 1000 ? `${Math.round(n / 1000)}${L(" ألف", "K")}` : String(n));
function ago(iso) {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  const h = Math.round(min / 60);
  const t = EN
    ? (min < 1 ? "Updated just now" : min < 60 ? `Updated ${min} min ago` : `Updated ${h} hour${h === 1 ? "" : "s"} ago`)
    : (min < 1 ? "محدّث الحين" : min < 60 ? `آخر تحديث قبل ${min} دقيقة` : `آخر تحديث قبل ${h === 1 ? "ساعة" : h === 2 ? "ساعتين" : h + " ساعات"}`);
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
  if (m.poster) return `<div class="poster${rc}"><img src="${esc(m.poster)}" alt="${L("ملصق", "Poster:")} ${esc(titleOf(m))}" loading="lazy">${badges}</div>`;
  return `<div class="poster${rc}" style="background:${phColor(m.id)}"><div class="ph"><b>${esc(titleOf(m))}</b><i>${esc(enOf(m))}</i></div>${badges}</div>`;
}
const metaTxt = (m) => [G((m.genres || [])[0]), runtimeTxt(m.runtime)].filter(Boolean).join(" · ") || LNG(m.language);
function cardHTML(e, rank) {
  return `<a class="card" href="#/movie/${esc(e.m.id)}">${posterHTML(e.m, rank)}
    <div class="card-info"><span class="card-title">${esc(titleOf(e.m))}</span><span class="card-sub">${esc(metaTxt(e.m))}</span>
    <span class="card-next"><b>${L("أقرب عرض", "Next")} ${fmtTxt(e.next.t)}</b> <span>· ${nBranches(e.cinemas.size)}</span></span></div></a>`;
}
function secHead(kicker, a, b, link) {
  return `<div class="sec-head"><div class="ttl"><span class="kicker">${kicker}</span><h2>${a}${b ? ` <em>${b}</em>` : ""}</h2></div>${link ? `<a class="more" href="${link[0]}">${link[1]} ${L("←", "→")}</a>` : ""}</div>`;
}
let railSeq = 0;
function railHTML(title, sub, items, ranked) {
  const id = "tr" + railSeq++;
  return `<section class="rail"><div class="rail-head"><h3>${esc(title)}${sub ? `<span class="sub">${esc(sub)}</span>` : ""}</h3>
    <div class="rail-nav">${EN ? `<button type="button" data-rail="${id}" data-dir="-1" aria-label="Previous">‹</button><button type="button" data-rail="${id}" data-dir="1" aria-label="Next">›</button>` : `<button type="button" data-rail="${id}" data-dir="1" aria-label="السابق">›</button><button type="button" data-rail="${id}" data-dir="-1" aria-label="التالي">‹</button>`}</div></div>
    <div class="rail-track" id="${id}">${items.map((e, k) => cardHTML(e, ranked ? k + 1 : 0)).join("")}</div></section>`;
}
function timeBtn(s, label) {
  const f = fmt(s.t), c = IDX.cinema[s.c];
  return `<a class="time${s.ms - Date.now() < 45 * 60000 ? " soon" : ""}" href="${esc(s.u || chainOf(c).url)}" target="_blank" rel="noopener" aria-label="${L("احجز", "Book")} ${f.hm} ${f.ap}${label ? L(" في ", " at ") + esc(label) : ""}">${f.hm}<small>${f.ap}</small></a>`;
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
  return `<option value="all">${L("كل السينمات", "All cinemas")}</option>` + Object.entries(by).map(([k, list]) => `<optgroup label="${esc(chainName(k))}">${list.sort((a, b) => cinName(a).localeCompare(cinName(b), LANG)).map((c) => `<option value="${esc(c.id)}"${state.cinema === c.id ? " selected" : ""}>${esc(cinName(c))}</option>`).join("")}</optgroup>`).join("");
}
function toolbarHTML({ times = false, genres = [], sort = false } = {}) {
  const fmts = [...new Set(DATA.shows.filter((s) => IDX.cinema[s.c]?.city === state.city).map((s) => s.f))].sort((a, b) => (a === "Standard" ? -1 : b === "Standard" ? 1 : a.localeCompare(b)));
  const nF = state.formats.size + state.langs.size;
  const now = Date.now();
  const tOpts = [["any", L("أي وقت", "Any time")], ["now", L("الحين", "Now")]];
  CONFIG.quickHours.forEach((h) => { const k = `${String(h).padStart(2, "0")}:00`; if (atHour(k, now) + 30 * 60000 > now) tOpts.push([k, hourLabel(h)]); });
  return `<section class="toolbar" aria-label="${L("الفلاتر", "Filters")}">
    ${times ? `<div class="trow"><span class="flabel">${L("متى؟", "When?")}</span><div class="chips">${tOpts.map(([k, v]) => `<button type="button" class="chip" data-time="${k}" aria-pressed="${!state.custom && state.time === k}">${v}</button>`).join("")}</div>
      <label class="pick${state.custom ? " on" : ""}" for="customTime"><span>${L("وقت آخر", "Other time")}</span><input type="time" id="customTime" step="900" value="${esc(state.custom)}"></label></div>` : ""}
    ${genres.length > 1 ? `<div class="trow"><span class="flabel">${L("النوع", "Genre")}</span><div class="chips">${[["all", L("الكل", "All")], ...genres.map((g) => [g, G(g)])].map(([k, v]) => `<button type="button" class="chip" data-genre="${esc(k)}" aria-pressed="${state.genre === k}">${esc(v)}</button>`).join("")}</div></div>` : ""}
    <div class="trow split">
      <label class="pick${state.cinema !== "all" ? " on" : ""}" for="cinemaSel"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8"/></svg><select id="cinemaSel" aria-label="${L("السينما", "Cinema")}">${cinemaOptions()}</select></label>
      <div class="trow" style="gap:8px">
        ${sort ? `<label class="pick" for="sortSel"><span>${L("الترتيب", "Sort")}</span><select id="sortSel"><option value="next"${state.sort === "next" ? " selected" : ""}>${L("الأقرب وقتاً", "Soonest")}</option><option value="rating"${state.sort === "rating" ? " selected" : ""}>${L("الأعلى تقييماً", "Top rated")}</option><option value="popular"${state.sort === "popular" ? " selected" : ""}>${L("الأكثر عرضاً", "Most shows")}</option></select></label>` : ""}
        <button type="button" class="filter-btn${nF ? " on" : ""}" id="filterBtn" aria-expanded="${state.filtersOpen}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"/></svg>${L("فلاتر", "Filters")}${nF ? ` <span class="count">${nF}</span>` : ""}</button>
      </div>
    </div>
    <div class="more-filters"${state.filtersOpen ? "" : " hidden"} id="moreFilters">
      <div class="trow"><span class="flabel">${L("الشاشة", "Screen")}</span><div class="chips">${fmts.map((f) => `<button type="button" class="chip" data-fmt="${esc(f)}" aria-pressed="${state.formats.has(f)}">${esc(EXP(f))}</button>`).join("")}</div></div>
      <div class="trow"><span class="flabel">${L("اللغة", "Language")}</span><div class="chips">${["عربي", "إنجليزي"].map((l) => `<button type="button" class="chip" data-lang="${l}" aria-pressed="${state.langs.has(l)}">${LNG(l)}</button>`).join("")}</div></div>
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
  return `<section class="billboard" id="billboard" aria-label="${L("فلم مميز", "Featured movie")}">${billboardInner()}</section>`;
}
function billboardInner() {
  const e = hero.list[hero.i], m = e.m;
  const next = DATA.shows.filter((s) => s.m === m.id && showOk(s)).sort((a, b) => a.ms - b.ms).slice(0, 4);
  const bg = m.backdrop ? `<div class="bb-bg" style="background-image:url('${esc(m.backdrop)}')"></div>` : m.poster ? `<div class="bb-bg soft" style="background-image:url('${esc(m.poster)}')"></div>` : `<div class="bb-bg" style="background:${phColor(m.id)}"></div>`;
  return `${bg}<div class="wrap bb-in">
    <a class="bb-poster" href="#/movie/${esc(m.id)}" aria-label="${esc(titleOf(m))}">${posterHTML(m)}</a>
    <div class="bb-txt"><span class="kicker">${hero.i === 0 ? L(`الأكثر عرضاً اليوم في ${esc(cityName())}`, `Most shown today in ${esc(cityName())}`) : L(`من أبرز أفلام اليوم في ${esc(cityName())}`, `Top pick today in ${esc(cityName())}`)}</span>
      <h2>${esc(titleOf(m))}</h2>
      <div class="tags">${m.imdb_rating ? `<span class="imdb-mark">IMDb ${esc(m.imdb_rating)}</span>` : ""}${m.rating ? `<span class="tag age">${esc(m.rating)}</span>` : ""}${(m.genres || []).slice(0, 2).map((g) => `<span class="tag">${esc(G(g))}</span>`).join("")}${m.runtime ? `<span class="tag">${runtimeTxt(m.runtime)}</span>` : ""}</div>
      ${m.overview ? `<p>${esc(m.overview)}</p>` : ""}
      <div class="bb-next"><span>${L("أقرب العروض", "Next shows")}</span>${next.map((s) => timeBtn(s, cinName(IDX.cinema[s.c]))).join("")}</div>
      <div class="actions"><a class="btn primary" href="#/movie/${esc(m.id)}">${L("كل المواعيد والتفاصيل", "All showtimes & details")}</a>${m.trailer ? `<a class="btn ghost" href="${esc(m.trailer)}" target="_blank" rel="noopener"><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4v16l13-8z"/></svg>${L("الإعلان", "Trailer")}</a>` : ""}</div>
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
  const totalShows = DATA.shows.filter((s) => showOk(s)).length;
  const branches = new Set(DATA.shows.filter((s) => showOk(s)).map((s) => s.c)).size;
  const feats = EN ? [
    ["All cinemas in one place", "Movies and showtimes from every cinema on one page, instead of jumping between sites and apps."],
    ["Start from the time", "Free at 9? Pick the time and we'll show you every movie starting then, and where."],
    ["Ratings and details", "IMDb rating, plot, runtime and age rating, so you can choose without leaving the site."],
    ["Book on the cinema's site", "We send you to the official booking page for that exact show. No fees, no accounts."],
  ] : [
    ["كل الدور في مكان واحد", "الأفلام وأوقاتها من الدور في صفحة وحدة، بدال التنقل بين المواقع والتطبيقات."],
    ["ابدأ من الوقت", "عندك موعد الساعة 9؟ اختر الوقت ونوريك كل الأفلام اللي تبدأ فيه، وفي أي فرع."],
    ["تقييم وتفاصيل كل فلم", "تقييم IMDb، والقصة، والمدة، والتصنيف العمري، عشان تختار بدون ما تطلع من الموقع."],
    ["احجز من الدار مباشرة", "نوديك لصفحة الحجز الرسمية للعرض نفسه. بدون رسوم، وبدون حسابات."],
  ];
  const icons = ['<path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/>', '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', '<path d="M12 3l2.6 5.6 6.1.6-4.6 4.1 1.3 6-5.4-3.1-5.4 3.1 1.3-6L3.3 9.2l6.1-.6z"/>', '<path d="M4 7h16v4a2 2 0 0 0 0 4v4H4v-4a2 2 0 0 0 0-4z"/><path d="M10 7v12"/>'];
  return `<section class="intro">
    <div class="wrap intro-in">
      <span class="kicker">${L("مواعيد السينما في السعودية", "Cinema showtimes in Saudi Arabia")}</span>
      <h1>${L("كل أفلام السينما، في خريطة وحدة", "Every movie in town, on one map")}</h1>
      <p>${L("بدال ما تفتح موقع كل سينما لحاله، Cinemap يجمع لك الأفلام ومواعيدها من الدور في مكان واحد. اختر الفلم أو الوقت اللي يناسبك، واحجز من موقع الدار مباشرة.", "Instead of opening every cinema's site one by one, Cinemap brings movies and showtimes from all cinemas into one place. Pick the movie or the time that suits you, then book directly on the cinema's own site.")}</p>
      <div class="actions"><a class="btn primary" href="#/movies">${L("تصفح الأفلام", "Browse movies")}</a><a class="btn" href="#/times">${L("وش يعرض الحين؟", "What's on now?")}</a></div>
      <div class="intro-stats">
        ${EN
          ? `<span><b>${list.length}</b> movies today</span><span><b>${totalShows}</b> shows left</span><span><b>${branches}</b> branches in ${esc(cityName())}</span><span><b>${DATA.cities.length}</b> ${DATA.cities.length === 1 ? "city" : "cities"}</span>`
          : `<span><b>${list.length}</b> فلم اليوم</span><span><b>${totalShows}</b> عرض باقي</span><span><b>${branches}</b> فرع في ${esc(cityName())}</span><span><b>${DATA.cities.length}</b> مدينة</span>`}
      </div>
    </div>
  </section>
  <div class="wrap page">
    <section class="why-grid">
      ${secHead(L("ليش Cinemap", "Why Cinemap"), L("أكثر من مواعيد", "More than showtimes"))}
      <div class="feat-cards">
        ${feats.map(([h, p], i) => `<div class="feat-card"><span class="feat-ic"><svg viewBox="0 0 24 24">${icons[i]}</svg></span><h3>${h}</h3><p>${p}</p></div>`).join("")}
      </div>
    </section>
    <section class="two-col faq">
      ${secHead(L("عندك سؤال؟", "Questions?"), L("الأسئلة الشائعة", "FAQ"), "", ["#/about", L("كل الأسئلة", "All questions")])}
      <div class="faq-list">${FAQ().slice(0, 5).map(faqItem).join("")}</div>
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
  const showFeatured = !q && state.genre === "all";
  return `${showFeatured ? billboardHTML() : ""}
  <div class="wrap page tight">
    <div class="page-head"><span class="kicker">${q ? L("نتائج البحث", "Search results") : L("تصفح", "Browse")}</span>
      <h1>${q ? `"${esc(state.q)}"` : L(`أفلام ${esc(cin ? cinName(cin) : cityName())}`, `Movies in ${esc(cin ? cinName(cin) : cityName())}`)}</h1>
      <p class="meta-line">${nMovies(list.length)} ${L("اليوم", "today")} · ${freshHTML()}</p></div>
    ${toolbarHTML({ genres, sort: true })}
    ${list.length ? `<div class="grid">${list.map((e) => cardHTML(e)).join("")}</div>` : emptyHTML(q ? L(`ما لقينا "${state.q}"`, `No results for "${state.q}"`) : L("ما فيه أفلام بهالفلاتر", "No movies match these filters"), L("جرّب تكتب الاسم بالإنجليزي، أو شيل بعض الفلاتر.", "Try another spelling, or clear some filters."))}
  </div>`;
}

// خيارات الوقت: الحين، ثم كل نص ساعة لين 1:30 بعد منتصف الليل
function timeOptions() {
  const now = Date.now(), out = [["now", L("الحين", "Now")]];
  const start = Math.ceil((now + 15 * 60000) / 1800000) * 1800000;
  for (let t = start; t <= dayStart(now) + (25 * 60 + 30) * 60000; t += 1800000) {
    const d = new Date(t + CONFIG.tzOffsetMin * 60000);
    const hh = String(d.getUTCHours()).padStart(2, "0"), mm = String(d.getUTCMinutes()).padStart(2, "0");
    out.push([`${hh}:${mm}`, fmtTxt(`T${hh}:${mm}`)]);
  }
  out.push(["any", L("كل اللي باقي اليوم", "Rest of today")]);
  return out;
}
function timeWindow() {
  const now = Date.now(), key = state.time;
  if (key === "any") return [now - 10 * 60000, Infinity];
  const t0 = key === "now" ? now : atHour(key, now);
  return [t0 - 10 * 60000, t0 + CONFIG.windowMin * 60000];
}
function pageTimes() {
  const opts = timeOptions();
  if (!opts.some(([k]) => k === state.time)) state.time = "now";
  const [a, b] = timeWindow();
  const shows = DATA.shows.filter((s) => showOk(s) && s.ms >= a && s.ms <= b && IDX.movie[s.m]);
  // فلم واحد = بطاقة وحدة، وتحته الفروع وأوقاتها
  const byMovie = new Map();
  shows.forEach((s) => { if (!byMovie.has(s.m)) byMovie.set(s.m, []); byMovie.get(s.m).push(s); });
  const movies = [...byMovie.entries()].map(([id, ss]) => ({ m: IDX.movie[id], ss: ss.sort((x, y) => x.ms - y.ms) })).sort((x, y) => x.ss[0].ms - y.ss[0].ms);
  const label = state.time === "any" ? L("الليلة", "tonight") : state.time === "now" ? L("الحين", "now") : L(`الساعة ${fmtTxt(`T${state.time}`)}`, `at ${fmtTxt(`T${state.time}`)}`);
  const t1 = fmtTxt(new Date(a + 10 * 60000 + CONFIG.tzOffsetMin * 60000).toISOString()), t2 = fmtTxt(new Date(b + CONFIG.tzOffsetMin * 60000).toISOString());
  const range = state.time === "any" ? L("باقي اليوم", "for the rest of today") : L(`تبدأ بين ${t1} و${t2}`, `starting between ${t1} and ${t2}`);
  const body = movies.length ? `<div class="tm-list">${movies.map(({ m, ss }) => {
    const byCin = new Map(); ss.forEach((s) => { if (!byCin.has(s.c)) byCin.set(s.c, []); byCin.get(s.c).push(s); });
    return `<article class="tm-card">
      <a class="tm-poster" href="#/movie/${esc(m.id)}" aria-label="${esc(titleOf(m))}">${posterHTML(m)}</a>
      <div class="tm-body">
        <div class="tm-head"><a href="#/movie/${esc(m.id)}"><h2>${esc(titleOf(m))}</h2></a>
          <div class="mini-tags">${m.imdb_rating ? `<span class="imdb">IMDb ${esc(m.imdb_rating)}</span>` : ""}${m.rating ? `<span>${esc(m.rating)}</span>` : ""}${metaTxt(m) ? `<span>${esc(metaTxt(m))}</span>` : ""}</div></div>
        <div class="tm-cins">${[...byCin.entries()].map(([cid, cs]) => { const c = IDX.cinema[cid]; return `<div class="tm-cin">
          <a class="tm-cin-name" href="#/cinema/${esc(c.id)}">${esc(cinName(c))}<span>${esc(chainName(c.chain))}</span></a>
          <div class="times">${cs.map((s) => { const f = fmt(s.t); return `<a class="time" href="${esc(s.u || chainOf(c).url)}" target="_blank" rel="noopener" aria-label="${L("احجز", "Book")} ${f.hm} ${f.ap} ${L("في", "at")} ${esc(cinName(c))}">${f.hm}<small>${f.ap} · ${esc(EXP(s.f))}</small></a>`; }).join("")}</div>
        </div>`; }).join("")}</div>
      </div></article>`;
  }).join("")}</div>` : (() => { const nx = DATA.shows.filter((s) => showOk(s) && s.ms > b).sort((x, y) => x.ms - y.ms)[0];
    return emptyHTML(L("ما فيه عروض تبدأ في هالوقت", "No shows start around this time"), nx ? L(`أقرب عرض بعده الساعة ${fmtTxt(nx.t)}. اختر وقت ثاني.`, `The next show starts at ${fmtTxt(nx.t)}. Try another time.`) : L("جرّب سينما ثانية أو شيل بعض الفلاتر.", "Try another cinema or clear some filters.")); })();
  return `<div class="wrap page tight">
    <div class="page-head"><span class="kicker">${L("ابحث بالوقت", "Search by time")}</span><h1>${L(`وش يعرض ${esc(label)}؟`, `What's showing ${esc(label)}?`)}</h1></div>
    <div class="time-pick">
      <label for="timeSel">${L("أبي أدخل السينما", "I want to go")}</label>
      <div class="pick big"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
        <select id="timeSel">${opts.map(([k, v]) => `<option value="${k}"${k === state.time ? " selected" : ""}>${v}</option>`).join("")}</select></div>
      <span class="meta-line">${nMovies(movies.length)} · ${nShows(shows.length)} ${range} · ${freshHTML()}</span>
    </div>
    ${toolbarHTML()}
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
    <div class="page-head"><span class="kicker">${esc(cityName())}</span><h1>${L("السينمات <em>وفروعها</em>", "Cinemas <em>& branches</em>")}</h1>
      <p>${L("اختر الفرع اللي تفضله وشوف كل أفلامه ومواعيده اليوم.", "Pick your favourite branch to see all its movies and showtimes today.")}</p></div>
    <div class="cin-grid">
      ${cards.map(({ c, n, movies, next }) => `<a class="cin-card" href="#/cinema/${esc(c.id)}">
        <span class="kicker">${esc(chainName(c.chain))}</span><h3>${esc(cinName(c))}</h3>
        <span class="cnt">${n ? `${nMovies(movies.length)} · ${nShows(n)} ${L("اليوم", "today")}${next ? ` · ${L("أقرب عرض", "next at")} ${fmtTxt(next.t)}` : ""}` : L("خلصت عروض اليوم", "No more shows today")}</span>
        <div class="thumbs">${movies.slice(0, 6).map((id) => posterHTML(IDX.movie[id])).join("")}</div>
        <span class="go">${L("شوف الأفلام والمواعيد ←", "See movies & times →")}</span></a>`).join("")}
      ${links.map((k) => `<a class="cin-card link" href="${esc(DATA.chains[k]?.url)}" target="_blank" rel="noopener">
        <span class="kicker">${L("مواعيدها في موقعها", "Showtimes on their site")}</span><h3>${esc(chainName(k))}</h3>
        <span class="cnt">${L("نشتغل على إضافة مواعيدها هنا.", "We're working on adding their showtimes here.")}</span><span class="go">${L("افتح موقعهم ↗", "Open their site ↗")}</span></a>`).join("")}
    </div>
  </div>`;
}

function showtimesBlock(rowsData) {
  return `<div class="st-list">${rowsData.map((r) => `<div class="st-row">
      <div class="st-cin">${r.poster || ""}<div><b>${r.title}</b><span>${r.sub}</span></div></div>
      <div class="st-groups">${r.groups.map((g) => `<div class="st-group"><span class="st-fmt">${esc(EXP(g.f))}</span><div class="times">${g.ss.map((s) => timeBtn(s, r.label)).join("")}</div></div>`).join("")}</div>
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
  if (!c) return `<div class="wrap page">${emptyHTML(L("الفرع مو موجود", "Branch not found"), L("ارجع لصفحة السينمات واختر فرع ثاني.", "Go back to cinemas and pick another branch."))}</div>`;
  const shows = DATA.shows.filter((s) => s.c === id && showOk(s, { ignoreCinema: true }));
  const rows = groupShows(shows, (s) => s.m).map(({ k, groups }) => { const m = IDX.movie[k]; return { poster: `<a href="#/movie/${esc(m.id)}" tabindex="-1" aria-hidden="true">${posterHTML(m)}</a>`, title: `<a href="#/movie/${esc(m.id)}">${esc(titleOf(m))}</a>`, sub: esc([m.imdb_rating ? "IMDb " + m.imdb_rating : "", m.rating, metaTxt(m)].filter(Boolean).join(" · ")), label: cinName(c), groups }; });
  return `<div class="wrap page tight">
    <a class="back" href="#/cinemas">${L("→ كل السينمات", "← All cinemas")}</a>
    <div class="page-head"><span class="kicker">${esc(chainName(c.chain))} · ${esc(cityName())}</span><h1>${esc(cinName(c))}</h1>
      <p class="meta-line">${nMovies(rows.length)} · ${nShows(shows.length)} ${L("باقية اليوم", "left today")} · ${freshHTML()}</p></div>
    <div class="actions"><button type="button" class="btn${state.cinema === id ? " primary" : ""}" data-fav="${esc(id)}">${state.cinema === id ? L("✓ هذي سينماك في كل الموقع", "✓ Your cinema across the site") : L("اعرض أفلام هالفرع بس في كل الموقع", "Show only this branch across the site")}</button>
      <a class="btn" href="${esc(chainOf(c).url)}" target="_blank" rel="noopener">${L(`موقع ${esc(chainName(c.chain) || "الدار")}`, `${esc(chainName(c.chain) || "Cinema")} website`)} ↗</a></div>
    ${rows.length ? showtimesBlock(rows) : emptyHTML(L("خلصت عروض اليوم في هالفرع", "No more shows today at this branch"), L("ارجع بكرة، أو شوف فرع ثاني.", "Check back tomorrow, or try another branch."))}
  </div>`;
}

function pageMovie(id) {
  const m = IDX.movie[id];
  if (!m) return `<div class="wrap page">${emptyHTML(L("الفلم مو موجود", "Movie not found"), L("ممكن خلصت عروضه.", "It may have finished its run."))}</div>`;
  const base = DATA.shows.filter((s) => s.m === id && showOk(s, { ignoreCinema: true }));
  const cinIds = new Set(base.map((s) => s.c));
  if (state.cinema !== "all") cinIds.add(state.cinema);
  const visible = base.filter((s) => (state.cinema === "all" || s.c === state.cinema) && (state.mvFormat === "all" || s.f === state.mvFormat));
  const fmts = [...new Set(base.map((s) => s.f))];
  const rows = groupShows(visible, (s) => s.c).map(({ k, groups }) => { const c = IDX.cinema[k]; return { title: `<a href="#/cinema/${esc(c.id)}">${esc(cinName(c))}</a>`, sub: esc(chainName(c.chain)), label: cinName(c), groups }; });
  const others = entries().filter((e) => e.m.id !== id).sort((a, b) => b.n - a.n).slice(0, 12);
  const links = linkChains();
  document.title = `${titleOf(m)} | Cinemap`;
  return `<div class="wrap page">
    <div style="display:flex;flex-direction:column;gap:24px">
      <a class="back" href="#/movies">${L("→ كل الأفلام", "← All movies")}</a>
      <div class="mv-top">
        <div class="mv-poster">${posterHTML(m)}</div>
        <div class="mv-info">
          <div><span class="kicker">${esc((m.genres || []).map(G).join(" · ") || L("يعرض الآن", "Now showing"))}</span><h1>${esc(titleOf(m))}</h1>${enOf(m) || m.release_date ? `<div class="mv-en">${esc([enOf(m), (m.release_date || "").slice(0, 4)].filter(Boolean).join(" · "))}</div>` : ""}</div>
          <div class="tags">${m.rating ? `<span class="tag age">${esc(m.rating)}</span>` : ""}${m.runtime ? `<span class="tag">${runtimeTxt(m.runtime)}</span>` : ""}${m.language ? `<span class="tag">${esc(LNG(m.language))}</span>` : ""}</div>
          <div class="stat-row">
            ${m.imdb_rating ? `<div class="statbox"><span class="imdb-mark">IMDb</span><span class="big">${esc(m.imdb_rating)}<small>/10</small></span>${m.imdb_votes ? `<span class="lbl">${L(`من ${votesTxt(m.imdb_votes)} تقييم`, `from ${votesTxt(m.imdb_votes)} votes`)}</span>` : ""}</div>` : ""}
            <div class="statbox"><span class="lbl">${L("عروض اليوم", "Shows today")}</span><span class="big">${base.length}</span><span class="lbl">${L("في", "in")} ${nBranches(cinIds.size - (state.cinema !== "all" && !base.some((s) => s.c === state.cinema) ? 1 : 0))}</span></div>
          </div>
          ${m.overview ? `<p class="overview">${esc(m.overview)}</p>` : ""}
          ${m.director || (m.cast || []).length ? `<dl class="credits">${m.director ? `<dt>${L("الإخراج", "Director")}</dt><dd>${esc(m.director)}</dd>` : ""}${(m.cast || []).length ? `<dt>${L("البطولة", "Cast")}</dt><dd>${esc(m.cast.join(L("، ", ", ")))}</dd>` : ""}</dl>` : ""}
          <div class="actions"><a class="btn primary" href="#showtimes" data-scroll>${L("شوف المواعيد", "See showtimes")}</a>
            ${m.trailer ? `<a class="btn" href="${esc(m.trailer)}" target="_blank" rel="noopener"><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4v16l13-8z"/></svg>${L("الإعلان", "Trailer")}</a>` : ""}
            ${m.imdb_id ? `<a class="btn" href="https://www.imdb.com/title/${esc(m.imdb_id)}/" target="_blank" rel="noopener">${L("صفحته في IMDb ↗", "IMDb page ↗")}</a>` : ""}</div>
        </div>
      </div>
    </div>

    <section id="showtimes" style="display:flex;flex-direction:column;gap:18px">
      ${secHead(L(`في ${esc(cityName())}`, `In ${esc(cityName())}`), L("مواعيد", "Showtimes"), L("اليوم", "today"))}
      <div class="trow split">
        ${fmts.length > 1 ? `<div class="chips">${[["all", L("الكل", "All")], ...fmts.map((f) => [f, EXP(f)])].map(([k, v]) => `<button type="button" class="chip" data-mvf="${esc(k)}" aria-pressed="${state.mvFormat === k}">${esc(v)}</button>`).join("")}</div>` : "<span></span>"}
        <label class="pick${state.cinema !== "all" ? " on" : ""}" for="mvCinema"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8"/></svg><select id="mvCinema" aria-label="${L("السينما", "Cinema")}">${cinemaOptions(cinIds)}</select></label>
      </div>
      ${rows.length ? showtimesBlock(rows) : emptyHTML(L("ما فيه عروض باقية اليوم بهالاختيار", "No shows left today for this selection"), L("اختر \"كل السينمات\" أو نوع شاشة ثاني.", "Choose \"All cinemas\" or another screen type."))}
      <p class="st-note">${L("اضغط الوقت وتكمل الحجز في موقع الدار.", "Tap a time to book on the cinema's site.")}${links.length ? L(` ممكن يعرض كمان في `, ` It may also be showing at `) + links.map((k) => `<a href="${esc(DATA.chains[k]?.url)}" target="_blank" rel="noopener">${esc(chainName(k))}</a>`).join(L("، ", ", ")) + "." : ""}</p>
    </section>

    ${others.length >= 2 ? `<section style="display:flex;flex-direction:column;gap:20px">${secHead(L("بعد", "Also"), L("أفلام ثانية", "Other movies"), L("تعرض اليوم", "showing today"))}<div class="rails">${railHTML("", "", others)}</div></section>` : ""}
  </div>`;
}

const FAQ_AR = [
  ["وش هو Cinemap؟", "موقع مجاني يجمع مواعيد أفلام السينما في السعودية في مكان واحد. تقدر تدور بالفلم، أو تختار الوقت اللي يناسبك وتشوف وش يعرض فيه، وبعدها تحجز من موقع الدار نفسها."],
  ["هل أقدر أحجز من Cinemap؟", "لا. لما تضغط على وقت العرض ننقلك لصفحة الحجز في موقع الدار الرسمي، وهناك تختار مقعدك وتدفع. ما نستلم أي دفع ولا نضيف أي رسوم."],
  ["كل كم تتحدث المواعيد؟", "كل ساعة تقريباً، ووقت آخر تحديث مكتوب في الصفحات. ممكن الدار تعدّل عرض بعد آخر تحديث، فتأكد من الوقت في صفحة الحجز قبل الدفع."],
  ["ليش ما ألقى مواعيد موفي وإمباير وAMC؟", "نعرض حالياً الدور اللي نقدر نجمع مواعيدها بشكل نظامي، ونشتغل على إضافة الباقي. إلى ذاك الحين تلقى روابطها المباشرة في صفحة السينمات."],
  ["عرض الساعة 12:30 بالليل، يتبع أي يوم؟", "العروض اللي بعد منتصف الليل تطلع مع عروض الليلة نفسها، مثل ما تعرضها الدور."],
  ["وش يعني التصنيف العمري مثل PG12 و R15؟", "هو تصنيف الهيئة العامة للإعلام المرئي والمسموع. G للجميع. PG بإشراف الأهل. PG12 و PG15 ينصح بمرافقة الأهل لمن هم أقل من هالعمر. R12 و R15 و R18 ما يسمح بالدخول لمن هم أقل من العمر المذكور، والدار ممكن تطلب الهوية."],
  ["من وين تجي التقييمات ومعلومات الأفلام؟", "تقييم IMDb والملصقات ومعلومات الأفلام من خدمة OMDb، والمواعيد من مواقع الدور. التقييم يتحدث مرة باليوم."],
  ["هل تحفظون أي بيانات عني؟", "لا. ما فيه حسابات ولا تسجيل، ونقيس بس عدد الزيارات بشكل عام. المدينة والسينما اللي تختارها تنحفظ في متصفحك بس، عشان ما تحتاج تختارها كل مرة."],
];
const FAQ_EN = [
  ["What is Cinemap?", "A free site that brings cinema showtimes across Saudi Arabia into one place. Search by movie, or pick the time that suits you and see what's showing, then book on the cinema's own site."],
  ["Can I book on Cinemap?", "No. When you tap a showtime we take you to the cinema's official booking page, where you pick your seat and pay. We don't take any payment or add any fees."],
  ["How often are showtimes updated?", "Roughly every hour, and the last update time is shown on each page. A cinema may change a show after our last update, so double-check the time on the booking page before paying."],
  ["Why can't I find muvi, Empire or AMC showtimes?", "For now we show the cinemas whose showtimes we can collect properly, and we're working on adding the rest. Until then, you'll find direct links to them on the Cinemas page."],
  ["Which day does a 12:30 AM show belong to?", "Shows after midnight are listed with the same night's shows, just like the cinemas list them."],
  ["What do age ratings like PG12 and R15 mean?", "They're set by the General Authority for Media Regulation. G is for everyone. PG means parental guidance. PG12 and PG15 recommend a parent for anyone under that age. R12, R15 and R18 don't allow entry under the stated age, and the cinema may ask for ID."],
  ["Where do ratings and movie info come from?", "IMDb ratings, posters and movie info come from OMDb, and showtimes from the cinemas' websites. Ratings refresh once a day."],
  ["Do you store any data about me?", "No. There are no accounts or sign-ups, and we only measure overall visit counts. Your chosen city and cinema are saved in your browser only, so you don't have to pick them every time."],
];
const FAQ = () => (EN ? FAQ_EN : FAQ_AR);
const faqItem = ([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`;

function pageAbout() {
  const steps = EN ? [
    ["We collect showtimes", "Every hour we refresh showtimes from the cinemas' public pages and match movie titles across cinemas."],
    ["You choose your way", "By movie, by time, or by your favourite cinema. Every movie comes with its rating and plot."],
    ["You book with the cinema", "Tap a time and we take you to the official booking page. No fees, no account."],
  ] : [
    ["نجمع المواعيد", "كل ساعة نحدّث مواعيد الدور من صفحاتها العامة، ونوحّد أسماء الأفلام بين الدور."],
    ["تختار بطريقتك", "بالفلم، أو بالوقت، أو بالسينما اللي تحبها. وكل فلم معه تقييمه وقصته."],
    ["تحجز من الدار", "تضغط الوقت وننقلك لصفحة الحجز الرسمية. بدون رسوم وبدون حساب."],
  ];
  return `<div class="wrap page">
    <div class="page-head"><span class="kicker">${L("عن Cinemap", "About Cinemap")}</span><h1>${L("السينما كلها، <em>في خريطة وحدة</em>", "Every cinema, <em>on one map</em>")}</h1>
      <p>${L("بدأت الفكرة من موقف بسيط: تجتمع مع أحد وتبون فلم بساعة معينة، وتقعد تفتح موقع كل سينما لحاله. Cinemap يجمع كل هذا في مكان واحد، ويخليك تبدأ من الوقت أو من الفلم.", "It started with a simple situation: you're meeting someone, you want a movie at a certain time, and you end up opening every cinema's site one by one. Cinemap brings it all into one place, and lets you start from the time or from the movie.")}</p></div>
    <section style="display:flex;flex-direction:column;gap:22px">
      ${secHead(L("كيف يشتغل", "How it works"), L("ثلاث", "Three"), L("خطوات", "steps"))}
      <div class="steps">
        ${steps.map(([h, p], i) => `<div class="step"><span class="n">${EN ? i + 1 : "١٢٣"[i]}</span><h3>${h}</h3><p>${p}</p></div>`).join("")}
      </div>
    </section>
    <section class="two-col faq" id="faq">
      ${secHead(L("عندك سؤال؟", "Questions?"), L("الأسئلة", "Frequently asked"), L("الشائعة", "questions"))}
      <div class="faq-list">${FAQ().map(faqItem).join("")}</div>
    </section>
    <section class="two-col">
      ${secHead(L("تواصل معنا", "Contact us"), L("عندك", "Got"), L("ملاحظة؟", "feedback?"))}
      <div class="faq-list"><p style="margin:0;color:var(--ink-2);line-height:1.9">${L("لقيت موعد غلط، أو عندك اقتراح، أو تمثل دار سينما وتبي تتعاون معنا؟ راسلنا على", "Found a wrong showtime, have a suggestion, or represent a cinema and want to work with us? Email us at")}
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
  document.title = L("Cinemap | مواعيد السينما في السعودية", "Cinemap | Cinema showtimes in Saudi Arabia");
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
  if ($("billboard")) startHero();
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
  $("footChains").innerHTML = Object.keys(DATA.chains).map((k) => `<a href="${esc(DATA.chains[k].url)}" target="_blank" rel="noopener">${esc(chainName(k))} ↗</a>`).join("");
}

// ---------- الأحداث (تفويض) ----------
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-fmt],[data-lang],[data-genre],[data-mvf],[data-hero],[data-rail],[data-scroll],[data-fav],#filterBtn");
  if (!t) return;
  if (t.id === "filterBtn") { state.filtersOpen = !state.filtersOpen; return go(true); }
  if (t.dataset.fmt) { state.formats.has(t.dataset.fmt) ? state.formats.delete(t.dataset.fmt) : state.formats.add(t.dataset.fmt); return go(true); }
  if (t.dataset.lang) { state.langs.has(t.dataset.lang) ? state.langs.delete(t.dataset.lang) : state.langs.add(t.dataset.lang); return go(true); }
  if (t.dataset.genre) { state.genre = t.dataset.genre; return go(true); }
  if (t.dataset.mvf) { state.mvFormat = t.dataset.mvf; return go(true); }
  if (t.dataset.fav) { setCinema(state.cinema === t.dataset.fav ? "all" : t.dataset.fav); return go(true); }
  if (t.dataset.hero) { clearInterval(hero.timer); hero.i = +t.dataset.hero; $("billboard").innerHTML = billboardInner(); return; }
  if (t.dataset.rail) { const tr = $(t.dataset.rail); tr.scrollBy({ left: +t.dataset.dir * tr.clientWidth * (EN ? 0.8 : -0.8), behavior: "smooth" }); return; }
  if (t.dataset.scroll !== undefined) { e.preventDefault(); $("showtimes")?.scrollIntoView({ behavior: "smooth" }); }
});
document.addEventListener("change", (e) => {
  const t = e.target;
  if (t.id === "cinemaSel" || t.id === "mvCinema") { setCinema(t.value); return go(true); }
  if (t.id === "sortSel") { state.sort = t.value; return go(true); }
  if (t.id === "timeSel") { state.time = t.value; return go(true); }
  if (t.id === "city") { state.city = t.value; store.set("city", state.city); setCinema("all"); hero.i = 0; return go(true); }
});
function setCinema(id) { state.cinema = id; store.set("cinema", id); }

$("searchForm").addEventListener("submit", (e) => { e.preventDefault(); $("q").blur(); });
$("q").addEventListener("input", (e) => {
  state.q = e.target.value;
  if (!location.hash.startsWith("#/movies")) location.hash = "#/movies"; else go(true);
});

// ---------- النصوص الثابتة وزر اللغة ----------
function applyLang() {
  document.documentElement.lang = LANG;
  document.documentElement.dir = EN ? "ltr" : "rtl";
  if (EN) {
    document.querySelectorAll("[data-en]").forEach((el) => (el.innerHTML = el.dataset.en));
    document.querySelectorAll("[data-en-aria]").forEach((el) => el.setAttribute("aria-label", el.dataset.enAria));
    document.querySelectorAll("[data-en-ph]").forEach((el) => (el.placeholder = el.dataset.enPh));
  }
  const b = $("langBtn");
  if (b) {
    b.textContent = EN ? "عربي" : "EN";
    b.setAttribute("aria-label", EN ? "التحويل للعربي" : "Switch to English");
    b.lang = EN ? "ar" : "en";
    b.addEventListener("click", () => {
      const to = EN ? "ar" : "en";
      store.set("lang", to);
      const u = new URL(location.href); u.searchParams.set("lang", to);
      location.replace(u.toString());
    });
  }
}
applyLang();

// ---------- التحميل ----------
async function load() {
  try {
    const r = await fetch("data/showtimes.json", { cache: "no-store" });
    if (!r.ok) throw new Error(r.status);
    DATA = await r.json();
  } catch (e) {
    $("view").innerHTML = `<div class="wrap page">${emptyHTML(L("ما قدرنا نحمّل المواعيد", "We couldn't load showtimes"), L("حدّث الصفحة بعد شوي.", "Please refresh in a moment."))}</div>`;
    return;
  }
  DATA.movies.forEach((m) => (IDX.movie[m.id] = m));
  DATA.cinemas.forEach((c) => (IDX.cinema[c.id] = c));
  DATA.shows.forEach((s) => (s.ms = new Date(s.t).getTime()));
  $("sampleBanner").hidden = !DATA.sample;
  const saved = store.get("city");
  state.city = DATA.cities.some((c) => c.id === saved) ? saved : DATA.cities[0]?.id;
  $("city").innerHTML = DATA.cities.map((c) => `<option value="${esc(c.id)}"${c.id === state.city ? " selected" : ""}>${esc(cityLabel(c))}</option>`).join("");
  const sc = store.get("cinema");
  state.cinema = sc && IDX.cinema[sc]?.city === state.city ? sc : "all";
  route();
}
setInterval(() => { if (DATA && !location.hash.startsWith("#/movie/") && document.visibilityState === "visible" && !document.activeElement?.matches("input,select")) go(true); }, 120000);
load();
