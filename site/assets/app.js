// شاشة واحدة: الواجهة. تقرأ data/showtimes.json اللي يحدّثه GitHub Actions كل ساعة.
"use strict";

const CONFIG = {
  // رابط استقبال نموذج التنبيهات (مثلاً من Formspree). اتركه فاضي ويختفي النموذج.
  formEndpoint: "",
  tzOffsetMin: 180,       // الرياض UTC+3 بدون توقيت صيفي
  cutoffHour: 5,          // العروض قبل 5 الفجر تابعة لليلة اللي قبل
  quickHours: [17, 18, 19, 20, 21, 22, 23, 0],
};

const EXP_AR = { Standard: "عادي", Kids: "أطفال", Premium: "بريميوم", Theatre: "ثياتر", VIP: "VIP",
  IMAX: "IMAX", MAX: "MAX", "4DX": "4DX", ScreenX: "ScreenX", Dolby: "Dolby" };
const LANGS = [["عربي", "عربي"], ["إنجليزي", "إنجليزي"]];

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let DATA = null, IDX = {};
const state = { mode: "time", target: "now", windowMin: 90, city: null, formats: new Set(), langs: new Set(), q: "" };

// ---------- الوقت ----------
const riyadhParts = (ms) => { const d = new Date(ms + CONFIG.tzOffsetMin * 60000); return { y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes() }; };
function businessDayStartMs(nowMs) {
  const p = riyadhParts(nowMs);
  let base = Date.UTC(p.y, p.mo, p.d) - CONFIG.tzOffsetMin * 60000; // منتصف ليل الرياض
  if (p.h < CONFIG.cutoffHour) base -= 86400000;
  return base;
}
function targetMs(hhmm, nowMs) {
  const [h, m] = hhmm.split(":").map(Number);
  let t = businessDayStartMs(nowMs) + (h * 60 + m) * 60000;
  if (h < CONFIG.cutoffHour) t += 86400000;
  return t;
}
function fmtTime(iso) {
  const m = /T(\d{2}):(\d{2})/.exec(iso); if (!m) return iso;
  let h = +m[1]; const ap = h < 12 ? "ص" : "م"; h = h % 12 || 12;
  return { hm: `${h}:${m[2]}`, ap };
}
const fmtHour = (h) => (h === 0 ? "12 ص" : h < 12 ? `${h} ص` : h === 12 ? "12 م" : `${h - 12} م`);
function minutesAgo(iso) { return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)); }
function agoText(min) {
  if (min < 1) return "الحين";
  if (min < 60) return `قبل ${min} دقيقة`;
  const h = Math.round(min / 60); return h === 1 ? "قبل ساعة" : h === 2 ? "قبل ساعتين" : `قبل ${h} ساعات`;
}

// ---------- تحميل ----------
async function load() {
  try {
    const r = await fetch("data/showtimes.json", { cache: "no-store" });
    if (!r.ok) throw new Error(r.status);
    DATA = await r.json();
  } catch (e) {
    $("fresh").textContent = "تعذّر تحميل المواعيد";
    $("results").innerHTML = `<div class="empty"><strong>ما قدرنا نحمّل المواعيد</strong>جرّب تحدّث الصفحة بعد شوي.</div>`;
    return;
  }
  IDX.movie = Object.fromEntries(DATA.movies.map((m) => [m.id, m]));
  IDX.cinema = Object.fromEntries(DATA.cinemas.map((c) => [c.id, c]));
  DATA.shows.forEach((s) => (s.ms = new Date(s.t).getTime()));
  setupFresh(); setupCities(); setupChips(); renderTimePick(); render();
}

function setupFresh() {
  const min = minutesAgo(DATA.generated_at);
  const el = $("fresh");
  const failed = Object.entries(DATA.sources || {}).filter(([, v]) => v.status !== "ok").map(([k]) => DATA.chains[k]?.name || k);
  el.textContent = `آخر تحديث ${agoText(min)}`;
  el.className = "fresh " + (min <= 90 && !failed.length ? "ok" : "stale");
  if (failed.length) el.title = `ما تحدثت: ${failed.join("، ")}`;
  $("sampleBanner").hidden = !DATA.sample;
}

function setupCities() {
  const sel = $("city");
  sel.innerHTML = DATA.cities.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");
  let saved = null; try { saved = localStorage.getItem("city"); } catch (e) {}
  state.city = DATA.cities.some((c) => c.id === saved) ? saved : DATA.cities[0]?.id;
  sel.value = state.city;
  sel.addEventListener("change", () => { state.city = sel.value; try { localStorage.setItem("city", sel.value); } catch (e) {} render(); });
}

function chipGroup(el, items, set) {
  el.innerHTML = items.map(([k, v]) => `<button type="button" class="chip" data-k="${esc(k)}" aria-pressed="false">${esc(v)}</button>`).join("");
  el.addEventListener("click", (e) => {
    const b = e.target.closest(".chip"); if (!b) return;
    const k = b.dataset.k; set.has(k) ? set.delete(k) : set.add(k);
    b.setAttribute("aria-pressed", set.has(k)); render();
  });
}
function setupChips() {
  const fmts = [...new Set(DATA.shows.map((s) => s.f))].sort((a, b) => (a === "Standard" ? -1 : b === "Standard" ? 1 : a.localeCompare(b)));
  chipGroup($("formatSet"), fmts.map((f) => [f, EXP_AR[f] || f]), state.formats);
  chipGroup($("langSet"), LANGS, state.langs);
}

function renderTimePick() {
  const now = Date.now();
  const opts = [["now", "الحين"]];
  CONFIG.quickHours.forEach((h) => {
    const hhmm = `${String(h).padStart(2, "0")}:00`;
    if (targetMs(hhmm, now) + 30 * 60000 > now) opts.push([hhmm, fmtHour(h)]);
  });
  $("timePick").innerHTML = opts.map(([k, v]) => `<button type="button" class="tp" data-t="${k}" aria-pressed="${state.target === k}">${v}</button>`).join("");
}
$("timePick").addEventListener("click", (e) => {
  const b = e.target.closest(".tp"); if (!b) return;
  state.target = b.dataset.t; $("customTime").value = ""; renderTimePick(); render();
});
$("customTime").addEventListener("input", (e) => { if (e.target.value) { state.target = e.target.value; renderTimePick(); render(); } });
$("windowSel").addEventListener("input", (e) => { state.windowMin = +e.target.value; render(); });
$("q").addEventListener("input", (e) => { state.q = e.target.value; render(); });

function setMode(mode) {
  state.mode = mode;
  $("tabTime").setAttribute("aria-selected", mode === "time");
  $("tabMovie").setAttribute("aria-selected", mode === "movie");
  $("panelTime").hidden = mode !== "time";
  $("panelMovie").hidden = mode !== "movie";
  if (mode === "movie") $("q").focus();
  render();
}
$("tabTime").addEventListener("click", () => setMode("time"));
$("tabMovie").addEventListener("click", () => setMode("movie"));

// ---------- البحث ----------
const norm = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[ً-ٟ̀-ͯ]/g, "")
  .replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

function baseFilter(s) {
  const c = IDX.cinema[s.c];
  if (!c || c.city !== state.city) return false;
  if (state.formats.size && !state.formats.has(s.f)) return false;
  if (state.langs.size && ![...state.langs].some((l) => (s.l || IDX.movie[s.m]?.language || "").includes(l))) return false;
  return s.ms >= Date.now() - 10 * 60000;
}

function render() {
  if (!DATA) return;
  renderLinks();
  return state.mode === "time" ? renderByTime() : renderByMovie();
}

function renderByTime() {
  const now = Date.now();
  const t0 = state.target === "now" ? now : targetMs(state.target, now);
  const t1 = t0 + state.windowMin * 60000;
  const label = state.target === "now" ? "الحين" : (() => { const f = fmtTime(`T${state.target}`); return `الساعة ${f.hm} ${f.ap}`; })();
  $("heroTime").textContent = label;
  const list = DATA.shows.filter((s) => baseFilter(s) && s.ms >= t0 - 10 * 60000 && s.ms <= t1).sort((a, b) => a.ms - b.ms);
  const movies = new Set(list.map((s) => s.m)).size;
  $("summary").textContent = list.length ? `${list.length} عرض، ${movies} ${movies > 2 && movies < 11 ? "أفلام" : "فلم"}، يبدأ خلال ${({ 45: "45 دقيقة", 90: "ساعة ونص", 180: "3 ساعات" })[state.windowMin]}` : "";
  if (!list.length) {
    const next = DATA.shows.filter((s) => baseFilter(s) && s.ms > t1).sort((a, b) => a.ms - b.ms)[0];
    $("results").innerHTML = `<div class="empty"><strong>ما فيه عروض تبدأ في هالوقت</strong>${next ? `أقرب عرض بعده الساعة ${fmtTime(next.t).hm} ${fmtTime(next.t).ap}. جرّب توسّع المدة أو تختار وقت ثاني.` : "جرّب مدينة ثانية أو شيل بعض الفلاتر."}</div>`;
    return;
  }
  $("results").innerHTML = list.map((s) => {
    const m = IDX.movie[s.m] || {}, c = IDX.cinema[s.c], ch = DATA.chains[c.chain] || {};
    const f = fmtTime(s.t), mins = Math.round((s.ms - now) / 60000);
    return `<article class="show">
      ${mins >= 0 && mins <= 30 ? `<span class="soon">يبدأ بعد ${mins} د</span>` : ""}
      <div class="when"><b>${f.hm}</b><small>${f.ap}</small></div>
      <div class="what"><h3>${esc(m.title)}</h3>
        <div class="where">${esc(ch.name)} · ${esc(c.name)}</div>
        <div class="tags"><span class="tag fmt">${esc(EXP_AR[s.f] || s.f)}</span>${m.rating ? `<span class="tag rate">${esc(m.rating)}</span>` : ""}${s.l || m.language ? `<span class="tag">${esc(s.l || m.language)}</span>` : ""}${m.runtime ? `<span class="tag">${m.runtime} د</span>` : ""}</div></div>
      <a class="btn" href="${esc(s.u || ch.url)}" target="_blank" rel="noopener">احجز ↗</a>
    </article>`;
  }).join("");
}

function renderByMovie() {
  $("heroTime").textContent = "الليلة";
  const q = norm(state.q);
  const list = DATA.shows.filter((s) => baseFilter(s) && (!q || norm(IDX.movie[s.m]?.title).includes(q)));
  const byMovie = new Map();
  list.forEach((s) => { if (!byMovie.has(s.m)) byMovie.set(s.m, new Map()); const g = byMovie.get(s.m); const k = s.c + "|" + s.f; if (!g.has(k)) g.set(k, []); g.get(k).push(s); });
  $("summary").textContent = byMovie.size ? `${byMovie.size} ${byMovie.size > 2 && byMovie.size < 11 ? "أفلام" : "فلم"} باقي لها عروض الليلة` : "";
  if (!byMovie.size) {
    $("results").innerHTML = `<div class="empty"><strong>ما لقينا الفلم${q ? ` "${esc(state.q)}"` : ""}</strong>تأكد من الاسم، أو جرّب تكتبه بالإنجليزي. وممكن يكون يعرض في دار من الدور اللي تحت.</div>`;
    return;
  }
  const cards = [...byMovie.entries()].map(([mid, groups]) => {
    const m = IDX.movie[mid] || {};
    const rows = [...groups.entries()].map(([k, shows]) => ({ c: IDX.cinema[k.split("|")[0]], f: k.split("|")[1], shows: shows.sort((a, b) => a.ms - b.ms) }))
      .sort((a, b) => a.shows[0].ms - b.shows[0].ms);
    return { m, rows, first: rows[0].shows[0].ms };
  }).sort((a, b) => a.first - b.first);
  $("results").innerHTML = cards.map(({ m, rows }) => `<article class="movie">
    <div class="movie-head"><h3>${esc(m.title)}</h3><div class="tags">${m.rating ? `<span class="tag rate">${esc(m.rating)}</span>` : ""}${m.language ? `<span class="tag">${esc(m.language)}</span>` : ""}${m.runtime ? `<span class="tag">${m.runtime} دقيقة</span>` : ""}</div></div>
    ${rows.map((r) => { const ch = DATA.chains[r.c.chain] || {}; return `<div class="cin">
      <div class="cin-name">${esc(ch.name)} · ${esc(r.c.name)} <small>· ${esc(EXP_AR[r.f] || r.f)}</small></div>
      <div class="stubs">${r.shows.map((s) => { const f = fmtTime(s.t); return `<a class="stub" href="${esc(s.u || ch.url)}" target="_blank" rel="noopener"><span dir="ltr">${f.hm}</span><small>${f.ap}</small></a>`; }).join("")}</div>
    </div>`; }).join("")}
  </article>`).join("");
}

function renderLinks() {
  const seen = new Set();
  const links = DATA.cinemas.filter((c) => c.mode === "link" && (c.city === state.city || c.city === "other"))
    .filter((c) => !seen.has(c.chain) && seen.add(c.chain));
  $("linkList").innerHTML = links.map((c) => { const ch = DATA.chains[c.chain] || {}; return `<a href="${esc(c.url || ch.url)}" target="_blank" rel="noopener">${esc(ch.name)}</a>`; }).join("");
  $("linkList").closest("section").hidden = !links.length;
}

// ---------- التنبيهات ----------
if (CONFIG.formEndpoint) {
  $("alerts").hidden = false;
  $("alertForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("alertMsg"); msg.textContent = "جاري الإرسال…";
    try {
      const r = await fetch(CONFIG.formEndpoint, { method: "POST", headers: { Accept: "application/json" }, body: new FormData(e.target) });
      if (!r.ok) throw new Error(r.status);
      msg.textContent = "تم. بنرسل لك أول ما تنزل المواعيد."; e.target.reset();
    } catch (err) { msg.textContent = "ما انرسل الطلب. تأكد من الإيميل وجرّب مرة ثانية."; }
  });
}

setInterval(() => { if (DATA) { setupFresh(); renderTimePick(); render(); } }, 60000);
load();
