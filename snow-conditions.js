/* Resort coordinates are approximate mountain locations. Forecast and snow measurements
   are from Open-Meteo's free forecast API; reported depth is model data, not a resort stake. */
const SNOW_RESORT_COORDINATES = {
  "alta": [40.5884, -111.6386],
  "snowbird": [40.5830, -111.6508],
  "park city": [40.6514, -111.5080],
  "jackson hole": [43.5875, -110.8279],
  "winter park": [39.8868, -105.7625],
  "steamboat": [40.4572, -106.8045],
  "mount baker": [48.8570, -121.6660],
  "whistler blackcomb": [50.1163, -122.9574],
  "deer valley": [40.6374, -111.4783],
  "palisades tahoe": [39.1969, -120.2358],
  "heavenly": [38.9353, -119.9400],
  "northstar": [39.2746, -120.1210],
  "kirkwood": [38.6849, -120.0654],
  "sugar bowl": [39.3046, -120.3333]
};
const snowReportCache = new Map();
const snowNumber = value => Number.isFinite(value) ? value : null;

function snowDisplay(value, suffix = "cm") {
  if (value == null) return "—";
  const rounded = value < 10 ? value.toFixed(1) : Math.round(value).toString();
  return `${rounded} ${suffix}`;
}
function localDateInZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date);
  const part = type => parts.find(item => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
function addCalendarDays(isoDate, days) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
async function fetchSnowReport(latitude, longitude) {
  const params = new URLSearchParams({
    latitude: String(latitude), longitude: String(longitude),
    hourly: "snowfall,snow_depth", daily: "snowfall_sum",
    past_days: "7", forecast_days: "7", timezone: "auto"
  });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!response.ok) throw new Error(`Open-Meteo request failed (${response.status})`);
  const data = await response.json();
  if (!data.hourly?.time?.length || !data.daily?.time?.length) throw new Error("Snow data missing");

  const now = Date.now();
  const hourTimes = data.hourly.time.map(time => new Date(time).getTime());
  const snowfall = data.hourly.snowfall || [];
  const snowDepth = data.hourly.snow_depth || [];
  const recent24 = [], recent7 = [];
  let latestDepth = null, latestDepthTime = -Infinity;
  hourTimes.forEach((time, index) => {
    const amount = snowNumber(Number(snowfall[index]));
    if (time <= now && amount != null) {
      if (time >= now - 24 * 60 * 60 * 1000) recent24.push(amount);
      if (time >= now - 7 * 24 * 60 * 60 * 1000) recent7.push(amount);
    }
    const depth = snowNumber(Number(snowDepth[index]));
    if (time <= now && time > latestDepthTime && depth != null) {
      latestDepthTime = time;
      latestDepth = depth * 100; // API depth is meters; display centimeters.
    }
  });

  const today = localDateInZone(new Date(), data.timezone || "UTC");
  const forecastEnd = addCalendarDays(today, 7);
  const forecastAmounts = data.daily.snowfall_sum || [];
  const forecast = data.daily.time.reduce((sum, date, index) => {
    if (date > today && date <= forecastEnd) return sum + (snowNumber(Number(forecastAmounts[index])) || 0);
    return sum;
  }, 0);
  return {
    last24: recent24.reduce((sum, value) => sum + value, 0),
    last7: recent7.reduce((sum, value) => sum + value, 0),
    depth: latestDepth,
    forecast
  };
}
function snowReportMarkup(report) {
  return `<div class="snow-report-heading"><span class="snow-report-title">Live snow report</span><span class="snow-report-live">Open-Meteo</span></div>
    <div class="snow-report-grid">
      <div class="snow-report-metric"><span>Snow · last 24 hours</span><strong>${snowDisplay(report.last24)}</strong></div>
      <div class="snow-report-metric"><span>Snow · last 7 days</span><strong>${snowDisplay(report.last7)}</strong></div>
      <div class="snow-report-metric"><span>Current snow depth</span><strong>${snowDisplay(report.depth)}</strong></div>
      <div class="snow-report-metric"><span>Next 7-day snowfall</span><strong>${snowDisplay(report.forecast)}</strong></div>
    </div><p class="snow-report-source">Forecast/model estimates for the resort area; actual mountain conditions may vary.</p>`;
}
async function hydrateSnowCard(card) {
  if (card.dataset.snowLoaded) return;
  card.dataset.snowLoaded = "true";
  const resortName = card.querySelector("h3")?.textContent?.trim().toLowerCase();
  const reportElement = document.createElement("section");
  reportElement.className = "snow-report";
  reportElement.setAttribute("aria-label", "Live snow conditions");
  reportElement.innerHTML = '<p class="snow-report-status">Loading live snow report…</p>';
  card.append(reportElement);

  const coordinates = SNOW_RESORT_COORDINATES[resortName];
  if (!coordinates) {
    reportElement.innerHTML = '<p class="snow-report-status is-error">Snow data unavailable</p>';
    return;
  }
  const cacheKey = coordinates.join(",");
  if (!snowReportCache.has(cacheKey)) snowReportCache.set(cacheKey, fetchSnowReport(...coordinates));
  try {
    reportElement.innerHTML = snowReportMarkup(await snowReportCache.get(cacheKey));
  } catch (error) {
    console.warn(`Snow report unavailable for ${resortName}.`, error);
    reportElement.innerHTML = '<p class="snow-report-status is-error">Snow data unavailable</p>';
  }
}
function observeResortCards() {
  const results = document.getElementById("search-results");
  if (!results) return;
  const scan = () => results.querySelectorAll(".resort-card").forEach(hydrateSnowCard);
  new MutationObserver(scan).observe(results, { childList: true, subtree: true });
  scan();
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", observeResortCards, { once: true });
else observeResortCards();
