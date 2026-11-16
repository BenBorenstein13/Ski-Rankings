/* ===================== GOOGLE SHEETS / FORMS SETUP =====================
   1) Paste your published Google Sheet CSV URL into SHEET_CSV_URL below.
      Leave it blank to use the bundled sample-reviews.csv.
   2) Paste the Google Form's formResponse URL into GOOGLE_FORM_RESPONSE_URL.
   3) Replace each FORM_ENTRY_IDS value with the matching Google Forms entry ID.
   Static-site Google Forms submissions use no-cors, so acceptance cannot be verified.
========================================================================= */
const SHEET_CSV_URL = ""; // Published Google Sheet CSV URL
const GOOGLE_FORM_RESPONSE_URL = ""; // Google Form formResponse URL
const FORM_ENTRY_IDS = {
  resort: "", region: "", pass: "", month: "", snow: "", terrain: "", crowds: "", price: "", review: ""
};

const CSV_SAMPLE_URL = "sample-reviews.csv";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SCORE_KEYS = ["snow", "terrain", "crowds", "price"];
const SCORE_LABELS = { snow: "Snow", terrain: "Terrain", crowds: "Crowds", price: "Price" };
// Approximate seasonal patterns, not a promise or a current-season opening announcement.
const TYPICAL_OPENINGS = {
  "alta": "Mid-November", "snowbird": "Mid-November", "park city": "Mid-November", "jackson hole": "Late November",
  "winter park": "Mid-November", "steamboat": "Mid-November", "mount baker": "Late November", "whistler blackcomb": "Late November",
  "deer valley": "Early December", "palisades tahoe": "Late November", "heavenly": "Late November",
  "northstar": "Late November", "northstar california": "Late November", "kirkwood": "Early December", "sugar bowl": "Late November"
};
let allReviews = [];
let sortKey = "overall";
let sortDirection = -1;

function parseCSV(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(cell); cell = ""; }
    else if (char === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += char;
  }
  if (cell.length || row.length) { row.push(cell.replace(/\r$/, "")); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows.shift().map(header => header.trim());
  return rows.filter(values => values.some(value => value.trim())).map(values => {
    const record = {};
    headers.forEach((header, index) => { record[header] = (values[index] || "").trim(); });
    return record;
  });
}
function normalizeReview(row) {
  const get = (...names) => {
    const key = Object.keys(row).find(header => names.some(name => header.toLowerCase().trim() === name.toLowerCase()));
    return key ? String(row[key] ?? "").trim() : "";
  };
  const numeric = key => {
    const value = Number(get(SCORE_LABELS[key], `${SCORE_LABELS[key]} (1-10)`, `${SCORE_LABELS[key]} (1-10, 10 = no crowds)`.replace(/,.*$/, "")));
    return Number.isFinite(value) && value >= 1 && value <= 10 ? value : null;
  };
  const timestamp = get("Timestamp");
  return {
    timestamp: timestamp ? new Date(timestamp) : null, resort: get("Resort"), region: get("Region"), pass: get("Pass"),
    month: get("Month Visited", "Month"), snow: numeric("snow"), terrain: numeric("terrain"), crowds: numeric("crowds"),
    price: numeric("price"), review: get("Review"), opening: get("Typical opening", "Opening day", "Opening")
  };
}
async function loadReviews() {
  const urls = SHEET_CSV_URL.trim() ? [SHEET_CSV_URL.trim(), CSV_SAMPLE_URL] : [CSV_SAMPLE_URL];
  for (const url of urls) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`CSV request failed (${response.status})`);
      const reviews = parseCSV(await response.text()).map(normalizeReview).filter(review => review.resort);
      if (reviews.length) { allReviews = reviews; return; }
    } catch (error) { console.warn(`Could not load ${url}; trying fallback if available.`, error); }
  }
  allReviews = [];
}
function mean(values) {
  const valid = values.filter(value => Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}
function scoreText(score) { return score == null ? "—" : score.toFixed(1); }
function getResorts() {
  const byName = new Map();
  allReviews.forEach(review => {
    const key = review.resort.toLocaleLowerCase();
    if (!byName.has(key)) byName.set(key, { name: review.resort, reviews: [] });
    byName.get(key).reviews.push(review);
  });
  return [...byName.values()].map(resort => {
    const scores = Object.fromEntries(SCORE_KEYS.map(key => [key, mean(resort.reviews.map(review => review[key]))]));
    const months = {};
    resort.reviews.forEach(review => {
      const month = monthName(review.month);
      if (!month) return;
      if (!months[month]) months[month] = {};
      ["snow", "crowds"].forEach(key => {
        if (!months[month][key]) months[month][key] = [];
        if (review[key] != null) months[month][key].push(review[key]);
      });
    });
    const key = resort.name.toLowerCase();
    const opening = resort.reviews.find(review => review.opening)?.opening || TYPICAL_OPENINGS[key] || "Varies by season";
    return { ...resort, opening, region: mostCommon(resort.reviews.map(review => review.region)), passes: [...new Set(resort.reviews.map(review => review.pass).filter(Boolean))], scores, overall: mean(Object.values(scores)), months };
  });
}
function mostCommon(values) {
  const counts = new Map(); values.filter(Boolean).forEach(value => counts.set(value, (counts.get(value) || 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "—";
}
function monthName(value) {
  if (!value) return "";
  const normalized = value.trim().toLowerCase();
  return MONTHS.find(month => month.toLowerCase() === normalized || month.slice(0, 3).toLowerCase() === normalized) || "";
}
function safe(text) {
  return String(text ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}
function updateFilters() {
  const regions = [...new Set(allReviews.map(review => review.region).filter(Boolean))].sort();
  const passes = [...new Set(allReviews.map(review => review.pass).filter(Boolean))].sort();
  const fill = (id, values, label) => {
    const select = document.getElementById(id), old = select.value;
    select.innerHTML = `<option value="">All ${label}</option>` + values.map(value => `<option value="${safe(value)}">${safe(value)}</option>`).join("");
    if (values.includes(old)) select.value = old;
  };
  fill("region-filter", regions, "regions"); fill("pass-filter", passes, "passes");
}
function visibleResorts() {
  const region = document.getElementById("region-filter").value, pass = document.getElementById("pass-filter").value;
  return getResorts().filter(resort => (!region || resort.reviews.some(review => review.region === region)) && (!pass || resort.reviews.some(review => review.pass === pass)));
}
function renderRankings() {
  const body = document.getElementById("rankings-body");
  const resorts = visibleResorts().sort((a, b) => {
    const first = a[sortKey], second = b[sortKey];
    if (typeof first === "string") return first.localeCompare(second) * sortDirection;
    return ((first ?? -Infinity) - (second ?? -Infinity)) * sortDirection;
  });
  document.getElementById("review-count").textContent = `${allReviews.length} ${allReviews.length === 1 ? "review" : "reviews"} from the community`;
  if (!resorts.length) { body.innerHTML = '<tr><td colspan="9" class="empty-state">No reviews match those filters yet.</td></tr>'; return; }
  body.innerHTML = resorts.map((resort, index) => `<tr><td>${String(index + 1).padStart(2, "0")}</td><td><a href="#search-results-section" class="resort-link" data-resort="${safe(resort.name)}">${safe(resort.name)}</a></td><td class="region-cell">${safe(resort.region)}</td><td><span class="score-badge ${resort.overall >= 8 ? "top-score" : ""}">${scoreText(resort.overall)}</span></td>${SCORE_KEYS.map(key => `<td>${scoreText(resort.scores[key])}</td>`).join("")}<td class="review-count-cell">${resort.reviews.length}</td></tr>`).join("");
}
function renderResortSelect() {
  const select = document.getElementById("month-resort"), current = select.value;
  const resorts = getResorts().sort((a, b) => a.name.localeCompare(b.name));
  select.innerHTML = resorts.length ? resorts.map(resort => `<option value="${safe(resort.name)}">${safe(resort.name)}</option>`).join("") : '<option value="">No resorts yet</option>';
  if (resorts.some(resort => resort.name === current)) select.value = current;
  renderMonthChart();
}
function renderMonthChart() {
  const name = document.getElementById("month-resort").value, resort = getResorts().find(item => item.name === name);
  const chart = document.getElementById("month-chart"), empty = document.getElementById("month-chart-empty");
  document.getElementById("chart-resort-name").textContent = resort?.name || "Choose a resort";
  const activeMonths = MONTHS.filter(month => resort?.months[month]?.snow?.length || resort?.months[month]?.crowds?.length);
  if (!activeMonths.length) { chart.hidden = true; empty.hidden = false; return; }
  chart.hidden = false; empty.hidden = true;
  chart.innerHTML = activeMonths.map(month => {
    const snow = mean(resort.months[month]?.snow || []), crowds = mean(resort.months[month]?.crowds || []);
    return `<div class="month-column"><span class="bar-value">${snow == null ? "" : snow.toFixed(1)}</span><div class="bar-pair"><div class="month-bar snow-bar" title="Snow: ${scoreText(snow)}" style="height:${snow ? snow * 10 : 0}%"></div><div class="month-bar crowd-bar" title="Low crowds: ${scoreText(crowds)}" style="height:${crowds ? crowds * 10 : 0}%"></div></div><span class="month-label">${month.slice(0, 3)}</span></div>`;
  }).join("");
}
function renderSearch(query) {
  const section = document.getElementById("search-results-section"), target = document.getElementById("search-results"), normalized = query.trim().toLowerCase();
  if (!normalized) { section.hidden = true; return; }
  section.hidden = false;
  const matches = getResorts().filter(resort => resort.name.toLowerCase().includes(normalized) || resort.region.toLowerCase().includes(normalized)).sort((a, b) => (b.overall || 0) - (a.overall || 0));
  if (!matches.length) { target.innerHTML = '<p class="no-results">No resorts found. Try another name or region.</p>'; return; }
  target.innerHTML = matches.map(resort => {
    const recent = [...resort.reviews].sort((a, b) => (b.timestamp?.getTime() || 0) - (a.timestamp?.getTime() || 0)).filter(review => review.review).slice(0, 2);
    return `<article class="resort-card"><span class="resort-card-score">${scoreText(resort.overall)}<small>/10</small></span><h3>${safe(resort.name)}</h3><div class="card-subtitle">${safe(resort.region)} · ${resort.reviews.length} ${resort.reviews.length === 1 ? "review" : "reviews"}</div><div class="opening-date"><span class="opening-icon" aria-hidden="true">❄</span><span><strong>Typical opening</strong> · ${safe(resort.opening)}</span><span class="opening-note">Varies yearly</span></div><div class="mini-scores">${SCORE_KEYS.map(key => `<span>${SCORE_LABELS[key]} <b>${scoreText(resort.scores[key])}</b></span>`).join("")}</div>${recent.map(review => `<div class="recent-review"><strong>${safe(review.month || "Skier review")}${review.pass ? ` · ${safe(review.pass)}` : ""}</strong><p class="review-quote">“${safe(review.review)}”</p></div>`).join("") || '<div class="recent-review">No written reviews yet.</div>'}</article>`;
  }).join("");
}
function getMonthRating(resort, month, key) { return mean(resort.reviews.filter(review => monthName(review.month) === month && review[key] != null).map(review => review[key])); }
function recommend(month, priority) {
  return getResorts().map(resort => {
    const monthly = getMonthRating(resort, month, priority), category = monthly ?? resort.scores[priority], overall = resort.overall ?? 0;
    const score = category == null ? null : category * 0.75 + overall * 0.25;
    const reason = monthly != null ? `${scoreText(monthly)}/10 ${SCORE_LABELS[priority].toLowerCase()} in ${month}; ${resort.reviews.length} community ${resort.reviews.length === 1 ? "review" : "reviews"}.` : category != null ? `No ${month} scores yet — based on its ${scoreText(category)}/10 ${SCORE_LABELS[priority].toLowerCase()} average.` : "Not enough ratings for this priority yet.";
    return { resort, score, reason };
  }).filter(result => result.score != null).sort((a, b) => b.score - a.score).slice(0, 3);
}
function renderRecommendations(month, priority) {
  const target = document.getElementById("recommend-results"), results = recommend(month, priority);
  target.innerHTML = results.length ? `<p class="result-intro">Your top matches for ${safe(month)} · prioritizing ${SCORE_LABELS[priority].toLowerCase()}</p>${results.map((result, index) => `<div class="recommend-result"><span class="result-rank">0${index + 1}</span><div><div class="result-name">${safe(result.resort.name)} <span class="region-cell">· ${safe(result.resort.region)}</span></div><div class="result-reason">${safe(result.reason)}</div></div><span class="result-score">${result.score.toFixed(1)}</span></div>`).join("")}` : '<p class="no-results">No ratings to match yet. Check back after the community shares a few reviews.</p>';
}
function fillMonthSelects() {
  ["recommend-month", "review-month"].forEach(id => {
    const select = document.getElementById(id);
    MONTHS.forEach(month => { const option = document.createElement("option"); option.value = month; option.textContent = month; select.append(option); });
  });
}
function refreshDataUI() { updateFilters(); renderRankings(); renderResortSelect(); }
async function submitGoogleForm(review) {
  const configured = GOOGLE_FORM_RESPONSE_URL && Object.values(FORM_ENTRY_IDS).every(id => /^entry\.\d+$/.test(id));
  if (!configured) return false;
  const formData = new URLSearchParams();
  Object.entries(FORM_ENTRY_IDS).forEach(([key, entryId]) => formData.set(entryId, review[key] ?? ""));
  await fetch(GOOGLE_FORM_RESPONSE_URL, { method: "POST", mode: "no-cors", body: formData });
  return true;
}
function init() {
  fillMonthSelects(); loadReviews().then(refreshDataUI);
  document.getElementById("region-filter").addEventListener("change", renderRankings);
  document.getElementById("pass-filter").addEventListener("change", renderRankings);
  document.querySelectorAll("th[data-sort]").forEach(header => header.addEventListener("click", () => { const key = header.dataset.sort; sortDirection = key === sortKey ? -sortDirection : (key === "resort" || key === "region" ? 1 : -1); sortKey = key; renderRankings(); }));
  document.getElementById("month-resort").addEventListener("change", renderMonthChart);
  document.getElementById("search-form").addEventListener("submit", event => { event.preventDefault(); renderSearch(document.getElementById("resort-search").value); document.getElementById("search-results-section").scrollIntoView({ behavior: "smooth" }); });
  document.getElementById("resort-search").addEventListener("input", event => { if (!event.target.value.trim()) document.getElementById("search-results-section").hidden = true; });
  document.getElementById("clear-search").addEventListener("click", () => { document.getElementById("resort-search").value = ""; document.getElementById("search-results-section").hidden = true; });
  document.getElementById("recommend-form").addEventListener("submit", event => { event.preventDefault(); renderRecommendations(document.getElementById("recommend-month").value, new FormData(event.currentTarget).get("priority")); });
  ["snow", "terrain", "crowds", "price"].forEach(key => document.getElementById(`rating-${key}`).addEventListener("input", event => { document.getElementById(`value-${key}`).textContent = event.target.value; }));
  document.getElementById("review-form").addEventListener("submit", async event => {
    event.preventDefault(); const form = event.currentTarget, status = document.getElementById("form-status"), submit = form.querySelector('button[type="submit"]'), review = Object.fromEntries(new FormData(form));
    status.textContent = ""; submit.disabled = true; submit.querySelector("span").textContent = "…";
    try { const sent = await submitGoogleForm(review); if (!sent) status.textContent = "Thanks! The form is not connected yet, so this review was not sent. Add your Google Form URL and entry IDs in script.js."; }
    catch (error) { console.error("Google Form submission could not be sent.", error); status.textContent = "We couldn't send your review just now. Please try again."; submit.disabled = false; submit.querySelector("span").textContent = "→"; return; }
    form.hidden = true; document.getElementById("thank-you").hidden = false;
  });
  document.getElementById("write-another").addEventListener("click", () => { document.getElementById("thank-you").hidden = true; const form = document.getElementById("review-form"); form.reset(); ["snow", "terrain", "crowds", "price"].forEach(key => document.getElementById(`value-${key}`).textContent = document.getElementById(`rating-${key}`).value); form.hidden = false; form.querySelector('button[type="submit"]').disabled = false; });
  const themeToggle = document.getElementById("theme-toggle"), setTheme = theme => { document.documentElement.dataset.theme = theme; themeToggle.querySelector(".theme-icon").textContent = theme === "dark" ? "☀" : "☾"; themeToggle.setAttribute("aria-label", `Switch to ${theme === "dark" ? "light" : "dark"} mode`); try { localStorage.setItem("alpine-theme", theme); } catch {} };
  try { setTheme(localStorage.getItem("alpine-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")); } catch { setTheme("light"); }
  themeToggle.addEventListener("click", () => setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
  const menuToggle = document.getElementById("menu-toggle"), nav = document.querySelector(".main-nav");
  menuToggle.addEventListener("click", () => { const open = nav.classList.toggle("is-open"); menuToggle.setAttribute("aria-expanded", String(open)); menuToggle.textContent = open ? "×" : "☰"; });
  nav.querySelectorAll("a").forEach(link => link.addEventListener("click", () => { nav.classList.remove("is-open"); menuToggle.setAttribute("aria-expanded", "false"); menuToggle.textContent = "☰"; }));
  document.getElementById("rankings-body").addEventListener("click", event => { const link = event.target.closest(".resort-link"); if (link) { event.preventDefault(); document.getElementById("resort-search").value = link.dataset.resort; renderSearch(link.dataset.resort); document.getElementById("search-results-section").scrollIntoView({ behavior: "smooth" }); } });
}
document.addEventListener("DOMContentLoaded", init);
