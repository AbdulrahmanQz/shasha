// Cinemap: الواجهة. تقرأ data/showtimes.json اللي يحدّثه GitHub Actions كل ساعة.
"use strict";

const CONFIG = {
  tzOffsetMin: 180,   // الرياض UTC+3
  cutoffHour: 5,      // العروض قبل 5 الفجر تابعة لليلة اللي قبل
  windowMin: 90,      // "يبدأ خلال" ساعة ونص من الوقت المختار
  quickHours: [17, 18, 19, 20, 21, 22, 23, 0],
};
const EXP_AR = { Standard: "عادي", Kids: "أطفال", Premium: "بريميوم", Theatre: "ثياتر", VIP: "VIP",
  IMAX: "IMAX", MAX: "MAX", "4DX": "4DX", ScreenX: "ScreenX", Dolby: "Dolby" };
const PH_COLORS = ["#2A3150", "#283A4A", "#3A3150", "#2F3B45", "#33304A", "#253447"];

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };

let DATA = null;
const IDX = { movie: {}, cinema: {} };
const state = { time: "any", custom: "", formats: new Set(), langs: new Set(), q: "", city: null, mvFormat: "all" };

// ---------- الوقت ----------
const parts = (ms) => { const d = new Date(ms + CONFIG.tzOffsetMin * 60000); return { y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours() }; };
function dayStart(nowMs) {
  const p = parts(nowMs);
  let b = Date.UTC(p.y, p.mo, p.d) - CONFIG.tzOffsetMin * 60000;
  if (p.h < CONFIG.cutoffHour) b -= 86400000;
  return b;
}
function atHour(hhmm, nowMs) {
  const [h, m] = hhmm.split(":").map(Number);
  let t = dayStart(nowMs) + (h * 60 + m) * 60000;
  if (h < CONFIG.cutoffHour) t += 86400000;
  return t;
}
function fmt(iso) {
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  let h = +m[1]; const ap = h < 12 ? "ص" : "م"; h = h % 12 || 12;
  return { hm: `${h}:${m[2]}`, ap };
}
const fmtTxt = (iso) => { const f = fmt(iso); return `${f.hm} ${f.ap}`; };
const hourLabel = (h) => (h === 0 ? "12 ص" : h < 12 ? `${h} ص` : h === 12 ? "12 م" : `${h - 12} م`);
function ago(iso) {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 1) return { t: "محدّث الحين", min };
  if (min < 60) return { t: `آخر تحديث قبل ${min} دقيقة`, min };
  const h = Math.round(min / 60);
  return { t: `آخر تحديث قبل ${h === 1 ? "ساعة" : h === 2 ? "ساعتين" : h + " ساعات"}`, min };
}
const runtimeTxt = (m) => (m ? `${Math.floor(m / 60)}س ${m % 60}د` : "");
const plural = (n, one, two, few, many) => (n === 1 ? one : n === 2 ? two : n <= 10 ? `${n} ${few}` : `${n} ${many}`);
const norm = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[ً-ٟ̀-ͯ]/g, "")
  .replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
const titleOf = (m) => m.title_ar || m.title;
const enOf = (m) => (m.title_ar ? (m.title_en || m.title) : "");
const phColor = (id) => PH_COLORS[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % PH_COLORS.length];

// ---------- تحميل ----------
async function load() {
  try {
    const r = await fetch("data/showtimes.json", { cache: "no-store" });
    if (!r.ok) throw new Error(r.status);
    DATA = await r.json();
  } catch (e) {
    $("countText").textContent = "تعذّر تحميل المواعيد";
    $("grid").innerHTML = "";
    showEmpty("ما قدرنا نحمّل المواعيد", "حدّث الصفحة بعد شوي.");
    return;
  }
  DATA.movies.forEach((m) => (IDX.movie[m.id] = m));
  DATA.cinemas.forEach((c) => (IDX.cinema[c.id] = c));
  DATA.shows.forEach((s) => (s.ms = new Date(s.t).getTime()));
  $("sampleBanner").hidden = !DATA.sample;

  const sel = $("city");
  sel.innerHTML = DATA.cities.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");
  const saved = store.get("city");
  state.city = DATA.cities.some((c) => c.id === saved) ? saved : DATA.cities[0]?.id;
  sel.value = state.city;

  buildChips();
  route();
}

function buildChips() {
  const fm = [...new Set(DATA.shows.map((s) => s.f))].sort((a, b) => (a === "Standard" ? -1 : b === "Standard" ? 1 : a.localeCompare(b)));
  $("formatChips").innerHTML = fm.map((f) => `<button type="button" class="chip" data-k="${esc(f)}" aria-pressed="false">${esc(EXP_AR[f] || f)}</button>`).join("");
  $("langChips").innerHTML = [["عربي", "عربي"], ["إنجليزي", "إنجليزي"]].map(([k, v]) => `<button type="button" class="chip" data-k="${k}" aria-pressed="false">${v}</button>`).join("");
  renderTimeChips();
}
function renderTimeChips() {
  const now = Date.now();
  const opts = [["any", "أي وقت"], ["now", "الحين"]];
  CONFIG.quickHours.forEach((h) => {
    const k = `${String(h).padStart(2, "0")}:00`;
    if (atHour(k, now) + 30 * 60000 > now) opts.push([k, hourLabel(h)]);
  });
  $("timeChips").innerHTML = opts.map(([k, v]) => `<button type="button" class="chip" data-t="${k}" aria-pressed="${state.time === k && !state.custom}">${v}</button>`).join("");
}

// ---------- الفلترة ----------
function showOk(s, { ignoreTime = false } = {}) {
  const c = IDX.cinema[s.c];
  if (!c || c.city !== state.city) return false;
  if (s.ms < Date.now() - 10 * 60000) return false;
  if (state.formats.size && !state.formats.has(s.f)) return false;
  if (state.langs.size) {
    const lang = s.l || IDX.movie[s.m]?.language || "";
    if (![...state.langs].some((l) => lang.includes(l))) return false;
  }
  return true;
}
function timeWindow() {
  const now = Date.now();
  const key = state.custom || state.time;
  if (key === "any") return [now - 10 * 60000, Infinity];
  const t0 = key === "now" ? now : atHour(key, now);
  return [t0 - 10 * 60000, t0 + CONFIG.windowMin * 60000];
}

// ---------- الرئيسية ----------
function renderHome() {
  const [a, b] = timeWindow();
  const q = norm(state.q);
  const cityName = DATA.cities.find((c) => c.id === state.city)?.name || "";
  $("homeTitle").textContent = `الأفلام في ${cityName} اليوم`;

  const byMovie = new Map();
  for (const s of DATA.shows) {
    if (!showOk(s)) continue;
    const m = IDX.movie[s.m]; if (!m) continue;
    if (q && !norm(m.title).includes(q) && !norm(m.title_ar).includes(q)) continue;
    let e = byMovie.get(s.m);
    if (!e) byMovie.set(s.m, (e = { m, next: null, cinemas: new Set() }));
    e.cinemas.add(s.c);
    if (s.ms >= a && s.ms <= b && (!e.next || s.ms < e.next.ms)) e.next = s;
  }
  const list = [...byMovie.values()].filter((e) => e.next).sort((x, y) => x.next.ms - y.next.ms);
  const branches = new Set(DATA.shows.filter((s) => showOk(s)).map((s) => s.c)).size;
  $("countText").textContent = `${plural(list.length, "فلم واحد", "فلمين", "أفلام", "فلم")} · ${plural(branches, "فرع واحد", "فرعين", "فروع", "فرع")}`;

  const isAny = (state.custom || state.time) === "any" || state.time === "now";
  $("grid").innerHTML = list.map(({ m, next, cinemas }) => `
    <a class="card" href="#/movie/${esc(m.id)}">
      ${posterHTML(m)}
      <div class="card-info">
        <span class="card-title">${esc(titleOf(m))}</span>
        <span class="card-sub">${esc([(m.genres || [])[0], runtimeTxt(m.runtime)].filter(Boolean).join(" · ") || m.language || "")}</span>
        <span class="card-next"><b>${isAny ? "أقرب عرض" : "يبدأ"} ${fmtTxt(next.t)}</b> <span>· ${plural(cinemas.size, "فرع واحد", "فرعين", "فروع", "فرع")}</span></span>
      </div>
    </a>`).join("");

  if (!list.length) {
    const any = byMovie.size > 0;
    showEmpty(q && !byMovie.size ? `ما لقينا "${state.q}"` : "ما فيه عروض تبدأ في هالوقت",
      any ? "جرّب وقت ثاني أو اختر \"أي وقت\"." : "جرّب تشيل بعض الفلاتر، أو تكتب اسم الفلم بالإنجليزي.");
  } else $("empty").hidden = true;
}
function posterHTML(m) {
  const badges = `${m.imdb_rating ? `<span class="badge-imdb">IMDb ${esc(m.imdb_rating)}</span>` : ""}${m.rating ? `<span class="badge-age">${esc(m.rating)}</span>` : ""}`;
  if (m.poster) return `<div class="poster"><img src="${esc(m.poster)}" alt="ملصق ${esc(titleOf(m))}" loading="lazy">${badges}</div>`;
  return `<div class="poster" style="background:${phColor(m.id)}"><div class="ph"><b>${esc(titleOf(m))}</b><i>${esc(enOf(m))}</i></div>${badges}</div>`;
}
function showEmpty(title, body) {
  const e = $("empty");
  e.innerHTML = `<strong>${esc(title)}</strong>${esc(body)}`;
  e.hidden = false;
}

// ---------- صفحة الفلم ----------
function renderMovie(id) {
  const m = IDX.movie[id];
  const view = $("movieView");
  if (!m) { view.innerHTML = `<a class="back" href="#/">→ كل الأفلام</a><div class="empty"><strong>الفلم مو موجود</strong>ممكن خلصت عروضه.</div>`; return; }
  document.title = `${titleOf(m)} | Cinemap`;

  const shows = DATA.shows.filter((s) => s.m === id && showOk(s) && (state.mvFormat === "all" || s.f === state.mvFormat));
  const allFormats = [...new Set(DATA.shows.filter((s) => s.m === id && showOk(s)).map((s) => s.f))];
  const byCin = new Map();
  shows.forEach((s) => {
    if (!byCin.has(s.c)) byCin.set(s.c, new Map());
    const g = byCin.get(s.c); if (!g.has(s.f)) g.set(s.f, []); g.get(s.f).push(s);
  });
  const rows = [...byCin.entries()].map(([cid, g]) => ({ c: IDX.cinema[cid], groups: [...g.entries()].map(([f, ss]) => ({ f, ss: ss.sort((x, y) => x.ms - y.ms) })) }))
    .sort((x, y) => Math.min(...x.groups.map((g) => g.ss[0].ms)) - Math.min(...y.groups.map((g) => g.ss[0].ms)));
  const totalBranches = new Set(DATA.shows.filter((s) => s.m === id && showOk(s)).map((s) => s.c)).size;
  const totalShows = DATA.shows.filter((s) => s.m === id && showOk(s)).length;
  const now = Date.now();
  const linkChains = [...new Set(DATA.cinemas.filter((c) => c.mode === "link" && (c.city === state.city || c.city === "other")).map((c) => c.chain))];

  view.innerHTML = `
  <div class="mv">
    <a class="back" href="#/">→ كل الأفلام</a>
    <div class="mv-top">
      <div class="mv-poster">${posterHTML(m)}</div>
      <div class="mv-info">
        <div><h1>${esc(titleOf(m))}</h1>${enOf(m) || m.release_date ? `<div class="mv-en">${esc([enOf(m), (m.release_date || "").slice(0, 4)].filter(Boolean).join(" · "))}</div>` : ""}</div>
        <div class="tags">
          ${m.rating ? `<span class="tag age">${esc(m.rating)}</span>` : ""}
          ${(m.genres || []).map((g) => `<span class="tag">${esc(g)}</span>`).join("")}
          ${m.runtime ? `<span class="tag">${runtimeTxt(m.runtime)}</span>` : ""}
          ${m.language ? `<span class="tag">${esc(m.language)}</span>` : ""}
        </div>
        <div class="stats">
          ${m.imdb_rating ? `<div class="stat"><span class="imdb-mark">IMDb</span><span class="big">${esc(m.imdb_rating)}<small>/10</small></span>${m.imdb_votes ? `<span class="lbl">من ${votesTxt(m.imdb_votes)} تقييم</span>` : ""}</div>` : ""}
          <div class="stat"><span class="lbl">عروض اليوم</span><span class="big">${totalShows}</span><span class="lbl">في ${plural(totalBranches, "فرع واحد", "فرعين", "فروع", "فرع")}</span></div>
        </div>
        ${m.overview ? `<p class="overview">${esc(m.overview)}</p>` : ""}
        ${m.director || (m.cast || []).length ? `<dl class="credits">
          ${m.director ? `<dt>الإخراج</dt><dd>${esc(m.director)}</dd>` : ""}
          ${(m.cast || []).length ? `<dt>البطولة</dt><dd>${esc(m.cast.join("، "))}</dd>` : ""}</dl>` : ""}
        <div class="actions">
          <a class="btn primary" href="#showtimes" data-scroll>شوف المواعيد</a>
          ${m.trailer ? `<a class="btn" href="${esc(m.trailer)}" target="_blank" rel="noopener"><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4v16l13-8z"/></svg>الإعلان</a>` : ""}
          ${m.imdb_id ? `<a class="btn" href="https://www.imdb.com/title/${esc(m.imdb_id)}/" target="_blank" rel="noopener">صفحته في IMDb ↗</a>` : ""}
        </div>
      </div>
    </div>

    <section id="showtimes" style="display:flex;flex-direction:column;gap:16px">
      <div class="st-head"><h2>مواعيد اليوم في ${esc(DATA.cities.find((c) => c.id === state.city)?.name || "")}</h2><p>اضغط الوقت وتكمل الحجز في موقع الدار</p></div>
      ${allFormats.length > 1 ? `<div class="chips" id="mvFormats">${[["all", "الكل"], ...allFormats.map((f) => [f, EXP_AR[f] || f])].map(([k, v]) => `<button type="button" class="chip" data-f="${esc(k)}" aria-pressed="${state.mvFormat === k}">${esc(v)}</button>`).join("")}</div>` : ""}
      ${rows.length ? `<div class="st-list">${rows.map((r) => { const ch = DATA.chains[r.c.chain] || {}; return `
        <div class="st-row">
          <div class="st-cin"><b>${esc(r.c.name)}</b><span>${esc(ch.name || "")}</span></div>
          <div class="st-groups">${r.groups.map((g) => `
            <div class="st-group"><span class="st-fmt">${esc(EXP_AR[g.f] || g.f)}</span>
              <div class="times">${g.ss.map((s) => { const f = fmt(s.t); const soon = s.ms - now < 45 * 60000; return `<a class="time${soon ? " soon" : ""}" href="${esc(s.u || ch.url)}" target="_blank" rel="noopener" aria-label="احجز ${f.hm} ${f.ap} في ${esc(r.c.name)}">${f.hm}<small>${f.ap}</small></a>`; }).join("")}</div>
            </div>`).join("")}</div>
        </div>`; }).join("")}</div>` : `<div class="empty"><strong>ما فيه عروض باقية اليوم بهالفلاتر</strong>جرّب "الكل" أو مدينة ثانية.</div>`}
      ${linkChains.length ? `<p class="st-note">ممكن يعرض كمان في ${linkChains.map((k) => `<a href="${esc(DATA.chains[k]?.url)}" target="_blank" rel="noopener">${esc(DATA.chains[k]?.name || k)}</a>`).join("، ")}. مواعيدها في مواقعها.</p>` : ""}
    </section>
  </div>`;
}
const votesTxt = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(".0", "")} مليون` : n >= 1000 ? `${Math.round(n / 1000)} ألف` : String(n));

function renderLinks() {
  const chains = [...new Set(DATA.cinemas.filter((c) => c.mode === "link" && (c.city === state.city || c.city === "other")).map((c) => c.chain))];
  $("linkList").innerHTML = chains.map((k) => `<a href="${esc(DATA.chains[k]?.url)}" target="_blank" rel="noopener">${esc(DATA.chains[k]?.name || k)}</a>`).join("");
  $("elsewhere").hidden = !chains.length || location.hash.startsWith("#/movie");
}
function setFresh() {
  const a = ago(DATA.generated_at);
  const failed = Object.values(DATA.sources || {}).some((v) => v.status !== "ok");
  $("fresh").textContent = a.t;
  $("fresh").className = "fresh " + (a.min <= 90 && !failed ? "ok" : "stale");
}

// ---------- التنقل ----------
function route() {
  if (!DATA) return;
  const m = /^#\/movie\/([\w-]+)/.exec(location.hash);
  $("homeView").hidden = !!m;
  $("movieView").hidden = !m;
  setFresh(); renderLinks();
  if (m) { state.mvFormat = "all"; renderMovie(m[1]); window.scrollTo(0, 0); }
  else { document.title = "Cinemap | مواعيد السينما في السعودية"; renderHome(); }
}
window.addEventListener("hashchange", route);

// ---------- الأحداث ----------
$("timeChips").addEventListener("click", (e) => {
  const b = e.target.closest(".chip"); if (!b) return;
  state.time = b.dataset.t; state.custom = ""; $("customTime").value = "";
  renderTimeChips(); renderHome();
});
$("customTime").addEventListener("input", (e) => { state.custom = e.target.value || ""; renderTimeChips(); renderHome(); });
function toggleSet(container, set) {
  container.addEventListener("click", (e) => {
    const b = e.target.closest(".chip"); if (!b) return;
    const k = b.dataset.k; set.has(k) ? set.delete(k) : set.add(k);
    b.setAttribute("aria-pressed", set.has(k)); route();
  });
}
toggleSet($("formatChips"), state.formats);
toggleSet($("langChips"), state.langs);
$("q").addEventListener("input", (e) => { state.q = e.target.value; if (location.hash.startsWith("#/movie")) location.hash = "#/"; else renderHome(); });
$("city").addEventListener("change", (e) => { state.city = e.target.value; store.set("city", state.city); route(); });
$("movieView").addEventListener("click", (e) => {
  const f = e.target.closest("[data-f]");
  if (f) { state.mvFormat = f.dataset.f; const y = window.scrollY; renderMovie(/^#\/movie\/([\w-]+)/.exec(location.hash)[1]); window.scrollTo(0, y); return; }
  if (e.target.closest("[data-scroll]")) { e.preventDefault(); $("showtimes").scrollIntoView({ behavior: "smooth" }); }
});

setInterval(() => { if (DATA) { setFresh(); if (!location.hash.startsWith("#/movie")) { renderTimeChips(); renderHome(); } } }, 60000);
load();
