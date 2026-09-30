/* Owl Tides — FAU-themed fishing planner for the Deerfield Beach International Fishing Pier.
 * Data (no login / no API keys):
 *   - Tides:   NOAA CO-OPS predictions API
 *   - Weather: Open-Meteo forecast API
 *   - Waves:   Open-Meteo marine API
 *
 * All times are handled as America/New_York "wall clock" values encoded as UTC
 * milliseconds, so the app shows pier-local times no matter where the viewer is.
 */
(() => {
  "use strict";

  const PIER = { lat: 26.3175, lon: -80.0741, tz: "America/New_York" };
  // Hillsboro Inlet is the closest NOAA tide prediction station to the pier.
  // If it ever stops responding, the app looks up the nearest station automatically.
  const DEFAULT_STATION = { id: "8722802", name: "Hillsboro Inlet" };
  const NOAA = "https://api.tidesandcurrents.noaa.gov";
  const DAYS = 7;
  const GOOD_SCORE = 65;
  const HOUR = 3600e3;

  const $ = (sel) => document.querySelector(sel);
  const state = { days: [], tides: [], hourly: null, selected: 0 };

  /* ---------------- Intro ---------------- */
  const intro = $("#intro");
  const app = $("#app");
  let introClosed = false;
  function closeIntro() {
    if (introClosed) return;
    introClosed = true;
    app.hidden = false;
    intro.classList.add("done");
    setTimeout(() => intro.remove(), 800);
  }
  $("#skip-intro").addEventListener("click", closeIntro);
  intro.addEventListener("click", closeIntro);
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  setTimeout(closeIntro, reduceMotion ? 900 : 3800);

  /* ---------------- Time helpers ---------------- */
  const pad = (n) => String(n).padStart(2, "0");

  // "2026-09-30 14:05" or "2026-09-30T14:05" -> wall-clock ms
  function wall(str) {
    const [d, t = "00:00"] = str.split(/[ T]/);
    const [y, m, day] = d.split("-").map(Number);
    const [hh, mm] = t.split(":").map(Number);
    return Date.UTC(y, m - 1, day, hh, mm);
  }
  function nowWall() {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: PIER.tz, hourCycle: "h23",
        year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
      }).formatToParts(new Date()).map((p) => [p.type, p.value])
    );
    return Date.UTC(+parts.year, parts.month - 1, +parts.day, +parts.hour, +parts.minute);
  }
  const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
  const ymd = (ms) => dayKey(ms).replace(/-/g, "");
  function fmtTime(ms) {
    const d = new Date(ms);
    let h = d.getUTCHours();
    const ap = h >= 12 ? "pm" : "am";
    h = h % 12 || 12;
    return `${h}:${pad(d.getUTCMinutes())}${ap}`;
  }
  const fmtDay = (ms) => new Date(ms).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  const fmtDate = (ms) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

  /* ---------------- Fetching ---------------- */
  async function getJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    return data;
  }

  function tideUrl(stationId, today) {
    const begin = ymd(today - 24 * HOUR);
    const end = ymd(today + (DAYS + 1) * 24 * HOUR);
    return `${NOAA}/api/prod/datagetter?product=predictions&application=OwlTides` +
      `&begin_date=${begin}&end_date=${end}&datum=MLLW&station=${stationId}` +
      `&time_zone=lst_ldt&units=english&interval=hilo&format=json`;
  }

  async function nearestStation() {
    const data = await getJSON(`${NOAA}/mdapi/prod/webapi/stations.json?type=tidepredictions`);
    const toRad = (x) => (x * Math.PI) / 180;
    let best = null;
    for (const s of data.stations || []) {
      const dLat = toRad(s.lat - PIER.lat);
      const dLon = toRad(s.lng - PIER.lon);
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(PIER.lat)) * Math.cos(toRad(s.lat)) * Math.sin(dLon / 2) ** 2;
      const dist = 2 * Math.asin(Math.sqrt(a));
      if (!best || dist < best.dist) best = { id: s.id, name: s.name, dist };
    }
    if (!best) throw new Error("No NOAA tide station found");
    return best;
  }

  async function loadTides(today) {
    let station = DEFAULT_STATION;
    let data;
    try {
      data = await getJSON(tideUrl(station.id, today));
    } catch (e) {
      station = await nearestStation();
      data = await getJSON(tideUrl(station.id, today));
    }
    $("#station-name").textContent = `${station.name}, station ${station.id}`;
    return (data.predictions || []).map((p) => ({
      t: wall(p.t),
      v: parseFloat(p.v),
      type: p.type === "H" ? "H" : "L",
    }));
  }

  function loadWeather() {
    const q = new URLSearchParams({
      latitude: PIER.lat, longitude: PIER.lon, timezone: PIER.tz, forecast_days: DAYS,
      temperature_unit: "fahrenheit", wind_speed_unit: "mph", precipitation_unit: "inch",
      current: "temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m",
      hourly: "temperature_2m,wind_speed_10m,precipitation_probability,weather_code",
      daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max," +
        "wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant,sunrise,sunset",
    });
    return getJSON(`https://api.open-meteo.com/v1/forecast?${q}`);
  }

  function loadMarine() {
    const q = new URLSearchParams({
      latitude: PIER.lat, longitude: PIER.lon, timezone: PIER.tz, forecast_days: DAYS,
      length_unit: "imperial",
      current: "wave_height,sea_surface_temperature",
      daily: "wave_height_max",
    });
    return getJSON(`https://marine-api.open-meteo.com/v1/marine?${q}`);
  }

  /* ---------------- Weather + moon helpers ---------------- */
  const WX = {
    0: ["☀️", "Clear"], 1: ["🌤️", "Mostly clear"], 2: ["⛅", "Partly cloudy"], 3: ["☁️", "Overcast"],
    45: ["🌫️", "Fog"], 48: ["🌫️", "Fog"],
    51: ["🌦️", "Drizzle"], 53: ["🌦️", "Drizzle"], 55: ["🌦️", "Drizzle"], 56: ["🌦️", "Drizzle"], 57: ["🌦️", "Drizzle"],
    61: ["🌧️", "Rain"], 63: ["🌧️", "Rain"], 65: ["🌧️", "Heavy rain"], 66: ["🌧️", "Rain"], 67: ["🌧️", "Rain"],
    71: ["🌨️", "Snow"], 73: ["🌨️", "Snow"], 75: ["🌨️", "Snow"], 77: ["🌨️", "Snow"],
    80: ["🌦️", "Showers"], 81: ["🌧️", "Showers"], 82: ["⛈️", "Heavy showers"],
    85: ["🌨️", "Snow showers"], 86: ["🌨️", "Snow showers"],
    95: ["⛈️", "Thunderstorms"], 96: ["⛈️", "Thunderstorms"], 99: ["⛈️", "Thunderstorms"],
  };
  const wx = (code) => WX[code] || ["🌡️", "—"];
  const compass = (deg) => ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(((deg % 360) / 45)) % 8];

  // Moon phase 0..1 (0 = new, 0.5 = full), using a reference new moon.
  function moonPhase(wallMs) {
    const utcMs = wallMs + 4 * HOUR; // close enough to ET→UTC for a phase estimate
    const synodic = 29.530588853;
    const days = (utcMs - Date.UTC(2000, 0, 6, 18, 14)) / 86400e3;
    return (((days / synodic) % 1) + 1) % 1;
  }
  function moonInfo(p) {
    const icons = ["🌑", "🌒", "🌓", "🌔", "🌕", "🌖", "🌗", "🌘"];
    const names = ["New moon", "Waxing crescent", "First quarter", "Waxing gibbous", "Full moon", "Waning gibbous", "Last quarter", "Waning crescent"];
    const i = Math.round(p * 8) % 8;
    return { icon: icons[i], name: names[i] };
  }

  /* ---------------- Scoring ---------------- */
  function scoreDay(day) {
    const reasons = [];
    let score = 0;

    // Wind (max 30)
    const w = day.windMax;
    const windPts = w < 10 ? 30 : w < 15 ? 22 : w < 20 ? 12 : 0;
    score += windPts;
    reasons.push(`${w < 15 ? "✅" : "⚠️"} Wind up to ${Math.round(w)} mph ${compass(day.windDir)}`);

    // Rain (max 15)
    const r = day.rain;
    score += r < 20 ? 15 : r < 50 ? 8 : 0;
    reasons.push(`${r < 50 ? "✅" : "⚠️"} ${r}% chance of rain`);

    // Tide turns near sunrise/sunset (max 25) — prime feeding time
    const golden = day.tides.filter((t) =>
      Math.abs(t.t - day.sunrise) <= 1.5 * HOUR || Math.abs(t.t - day.sunset) <= 1.5 * HOUR);
    score += Math.min(25, golden.length * 15);
    if (golden.length) reasons.push(`🌅 ${golden.length} tide change${golden.length > 1 ? "s" : ""} near sunrise/sunset`);
    else reasons.push("➖ No tide change right at sunrise/sunset");

    // Moon (max 15) — new & full moons mean stronger tidal currents
    const moonPts = Math.round(Math.abs(Math.cos(day.moon * 2 * Math.PI)) * 15);
    score += moonPts;
    const m = moonInfo(day.moon);
    reasons.push(`${m.icon} ${m.name}${moonPts >= 11 ? " — strong tidal flow" : ""}`);

    // Waves (max 15)
    if (day.waves != null) {
      const h = day.waves;
      score += h < 2 ? 15 : h < 3 ? 10 : h < 4 ? 5 : 0;
      reasons.push(`${h < 3 ? "✅" : "⚠️"} Seas up to ${h.toFixed(1)} ft`);
    } else {
      score += 8;
    }

    return { score: Math.min(100, score), reasons, golden };
  }

  /* ---------------- Build model ---------------- */
  function buildDays(weather, marine, tides) {
    const d = weather.daily;
    const waveByDay = {};
    if (marine && marine.daily) {
      marine.daily.time.forEach((t, i) => { waveByDay[t] = marine.daily.wave_height_max[i]; });
    }
    return d.time.map((date, i) => {
      const start = wall(date);
      const end = start + 24 * HOUR;
      const day = {
        date, start, end,
        code: d.weather_code[i],
        hi: d.temperature_2m_max[i],
        lo: d.temperature_2m_min[i],
        rain: d.precipitation_probability_max[i] ?? 0,
        windMax: d.wind_speed_10m_max[i],
        gusts: d.wind_gusts_10m_max[i],
        windDir: d.wind_direction_10m_dominant[i],
        sunrise: wall(d.sunrise[i]),
        sunset: wall(d.sunset[i]),
        waves: waveByDay[date] ?? null,
        moon: moonPhase(start + 12 * HOUR),
        tides: tides.filter((t) => t.t >= start && t.t < end),
      };
      Object.assign(day, scoreDay(day));
      day.good = day.score >= GOOD_SCORE;
      return day;
    });
  }

  /* ---------------- Rendering ---------------- */
  function renderNow(weather, marine) {
    const c = weather.current;
    const [icon, label] = wx(c.weather_code);
    const now = nowWall();
    const next = state.tides.find((t) => t.t > now);
    let sea = "";
    if (marine && marine.current) {
      const unit = (marine.current_units && marine.current_units.sea_surface_temperature) || "°C";
      let sst = marine.current.sea_surface_temperature;
      if (sst != null && unit.includes("C")) sst = sst * 9 / 5 + 32;
      sea = `
        <div class="stat"><div class="label">Seas</div>
          <div class="value">${marine.current.wave_height != null ? marine.current.wave_height.toFixed(1) + " ft" : "—"}</div>
          <div class="sub">Water ${sst != null ? Math.round(sst) + "°F" : "—"}</div></div>`;
    }
    $("#now").innerHTML = `
      <div class="stat"><div class="label">Right now at the pier</div>
        <div class="value">${icon} ${Math.round(c.temperature_2m)}°F</div>
        <div class="sub">${label} · feels ${Math.round(c.apparent_temperature)}°F</div></div>
      <div class="stat"><div class="label">Wind</div>
        <div class="value">${Math.round(c.wind_speed_10m)} mph ${compass(c.wind_direction_10m)}</div>
        <div class="sub">Gusts ${Math.round(c.wind_gusts_10m)} mph</div></div>
      ${sea}
      <div class="stat"><div class="label">Next tide</div>
        <div class="value">${next ? (next.type === "H" ? "High" : "Low") + " " + fmtTime(next.t) : "—"}</div>
        <div class="sub">${next ? next.v.toFixed(1) + " ft · " + (next.t - now < 24 * HOUR ? "in " + Math.round((next.t - now) / 6e4 / 60 * 10) / 10 + " hr" : fmtDay(next.t)) : ""}</div></div>
      <div class="stat"><div class="label">Today's fishing score</div>
        <div class="value">${state.days[0] ? state.days[0].score : "—"}/100</div>
        <div class="sub">${state.days[0] && state.days[0].good ? "★ Good day to fish!" : "Check the best windows below"}</div></div>`;
  }

  function renderDays() {
    const wrap = $("#days");
    wrap.innerHTML = "";
    state.days.forEach((day, i) => {
      const [icon, label] = wx(day.code);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "day" + (day.good ? " good" : "") + (i === state.selected ? " selected" : "");
      btn.setAttribute("aria-label", `${fmtDay(day.start)}, fishing score ${day.score} of 100${day.good ? ", good fishing day" : ""}`);
      const goldenSet = new Set(day.golden.map((t) => t.t));
      btn.innerHTML = `
        <h3>${i === 0 ? "Today" : fmtDay(day.start)}</h3>
        <div class="date">${fmtDate(day.start)} · ${moonInfo(day.moon).icon}</div>
        <div class="wx"><span class="icon">${icon}</span>
          <span>${label}<br>${Math.round(day.hi)}° / ${Math.round(day.lo)}° · ${Math.round(day.windMax)} mph</span></div>
        <div class="score"><span>${day.score}</span><div class="bar"><span style="width:${day.score}%"></span></div></div>
        <ul class="tides">
          ${day.tides.map((t) => `
            <li><span class="${t.type === "H" ? "hi" : "lo"}">${t.type === "H" ? "▲ High" : "▼ Low"}</span>
              <span>${fmtTime(t.t)}${goldenSet.has(t.t) ? " 🌅" : ""}</span>
              <span>${t.v.toFixed(1)} ft</span></li>`).join("") || "<li>No tide data</li>"}
        </ul>`;
      btn.addEventListener("click", () => { state.selected = i; renderDays(); renderDetail(); });
      if (day.good) {
        btn.addEventListener("mouseenter", () => burst(btn));
        btn.addEventListener("focus", () => burst(btn));
      }
      wrap.appendChild(btn);
    });
  }

  function tideHeightAt(t) {
    const tides = state.tides;
    for (let i = 0; i < tides.length - 1; i++) {
      const a = tides[i], b = tides[i + 1];
      if (t >= a.t && t <= b.t) {
        const f = (t - a.t) / (b.t - a.t);
        return a.v + (b.v - a.v) * (1 - Math.cos(Math.PI * f)) / 2;
      }
    }
    return null;
  }

  function tideChart(day) {
    const W = 720, H = 200, padL = 36, padB = 26, padT = 12;
    const pw = W - padL - 8, ph = H - padB - padT;
    const pts = [];
    for (let m = 0; m <= 1440; m += 10) {
      const v = tideHeightAt(day.start + m * 6e4);
      if (v != null) pts.push([m, v]);
    }
    if (pts.length < 2) return "";
    const vals = pts.map((p) => p[1]);
    const min = Math.min(...vals) - 0.3, max = Math.max(...vals) + 0.3;
    const x = (m) => padL + (m / 1440) * pw;
    const y = (v) => padT + (1 - (v - min) / (max - min)) * ph;
    const mins = (t) => (t - day.start) / 6e4;

    const night = `
      <rect x="${x(0)}" y="${padT}" width="${x(mins(day.sunrise)) - x(0)}" height="${ph}" fill="#003366" opacity=".08"/>
      <rect x="${x(mins(day.sunset))}" y="${padT}" width="${x(1440) - x(mins(day.sunset))}" height="${ph}" fill="#003366" opacity=".08"/>`;
    const windows = day.tides.map((t) => {
      const a = Math.max(0, mins(t.t) - 60), b = Math.min(1440, mins(t.t) + 60);
      return `<rect x="${x(a)}" y="${padT}" width="${x(b) - x(a)}" height="${ph}" fill="${t.type === "H" ? "#0a4a8a" : "#CC0000"}" opacity=".13" rx="4"/>`;
    }).join("");
    const line = pts.map((p, i) => `${i ? "L" : "M"}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(" ");
    const area = `${line} L${x(pts[pts.length - 1][0])},${padT + ph} L${x(pts[0][0])},${padT + ph} Z`;
    const marks = day.tides.map((t) => `
      <circle cx="${x(mins(t.t))}" cy="${y(t.v)}" r="5" fill="${t.type === "H" ? "#003366" : "#CC0000"}" stroke="#fff" stroke-width="2"/>
      <text x="${x(mins(t.t))}" y="${t.type === "H" ? y(t.v) - 10 : y(t.v) + 18}" text-anchor="middle" font-size="11" font-weight="700" fill="#10233a">${fmtTime(t.t)}</text>`).join("");
    const hours = [0, 6, 12, 18, 24].map((h) => `
      <text x="${x(h * 60)}" y="${H - 6}" text-anchor="${h === 0 ? "start" : h === 24 ? "end" : "middle"}" font-size="11" fill="#5a6b80">${h === 0 || h === 24 ? "12am" : h === 12 ? "12pm" : h > 12 ? h - 12 + "pm" : h + "am"}</text>`).join("");
    const yTicks = [min + 0.3, (min + max) / 2, max - 0.3].map((v) => `
      <text x="${padL - 6}" y="${y(v) + 4}" text-anchor="end" font-size="10" fill="#5a6b80">${v.toFixed(1)}′</text>`).join("");
    const now = nowWall();
    const nowLine = now >= day.start && now < day.end
      ? `<line x1="${x(mins(now))}" x2="${x(mins(now))}" y1="${padT}" y2="${padT + ph}" stroke="#CC0000" stroke-dasharray="4 3"/>
         <text x="${x(mins(now)) + 4}" y="${padT + ph - 4}" font-size="10" fill="#CC0000">now</text>` : "";
    return `
      <svg class="tide-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Tide height through the day">
        ${night}${windows}
        <path d="${area}" fill="#0a4a8a" opacity=".12"/>
        <path d="${line}" fill="none" stroke="#003366" stroke-width="2.5"/>
        ${nowLine}${marks}${hours}${yTicks}
      </svg>`;
  }

  function hourlyAt(t) {
    const h = state.hourly;
    if (!h) return null;
    const i = h.time.findIndex((s) => wall(s) >= t - 30 * 6e4);
    if (i < 0) return null;
    return { temp: h.temperature_2m[i], wind: h.wind_speed_10m[i], rain: h.precipitation_probability[i], code: h.weather_code[i] };
  }

  function renderDetail() {
    const day = state.days[state.selected];
    const el = $("#detail");
    if (!day) { el.hidden = true; return; }
    el.hidden = false;
    const goldenSet = new Set(day.golden.map((t) => t.t));
    const windows = day.tides
      .map((t) => {
        const daylight = t.t >= day.sunrise - HOUR && t.t <= day.sunset + HOUR;
        return { ...t, prime: goldenSet.has(t.t), daylight };
      })
      .sort((a, b) => (b.prime - a.prime) || (b.daylight - a.daylight) || (a.t - b.t));

    el.innerHTML = `
      <h2>${state.selected === 0 ? "Today" : fmtDay(day.start)}, ${fmtDate(day.start)} — score ${day.score}/100 ${day.good ? "★" : ""}</h2>
      <p class="why">Sunrise ${fmtTime(day.sunrise)} · Sunset ${fmtTime(day.sunset)}. Shaded bands are the best windows around each tide turn; darker areas are night.</p>
      ${tideChart(day)}
      <div class="windows">
        ${windows.map((w) => {
          const h = hourlyAt(w.t);
          return `
          <div class="window ${w.type === "L" ? "low" : ""} ${w.prime ? "prime" : ""}">
            <strong>${w.prime ? "🌅 Prime · " : w.daylight ? "" : "🌙 "}${w.type === "H" ? "High tide" : "Low tide"} ${fmtTime(w.t)}</strong>
            <span>Fish ${fmtTime(w.t - HOUR)} – ${fmtTime(w.t + HOUR)} · ${w.v.toFixed(1)} ft</span><br>
            <span>${h ? `${wx(h.code)[0]} ${Math.round(h.temp)}°F · ${Math.round(h.wind)} mph · ${h.rain ?? 0}% rain` : ""}</span><br>
            <span>${w.type === "H" ? "Incoming water pushes bait close to the pier." : "Fish the turn as water starts moving back in."}</span>
          </div>`;
        }).join("")}
      </div>
      <div class="factors">${day.reasons.map((r) => `<span class="chip">${r}</span>`).join("")}</div>`;
  }

  /* ---------------- Confetti (red, white & blue) ---------------- */
  const canvas = $("#confetti");
  const ctx = canvas.getContext("2d");
  const COLORS = ["#CC0000", "#FFFFFF", "#003366", "#CC0000", "#FFFFFF", "#0a4a8a"];
  let pieces = [];
  let running = false;
  const lastBurst = new WeakMap();

  function sizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  addEventListener("resize", sizeCanvas);
  sizeCanvas();

  function burst(el) {
    if (reduceMotion) return;
    const t = performance.now();
    if (t - (lastBurst.get(el) || 0) < 700) return;
    lastBurst.set(el, t);
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 3;
    for (let i = 0; i < 90; i++) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.3;
      const speed = 4 + Math.random() * 7;
      pieces.push({
        x: cx + (Math.random() - 0.5) * r.width * 0.5, y: cy,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        w: 6 + Math.random() * 6, h: 3 + Math.random() * 5,
        rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.35,
        color: COLORS[i % COLORS.length], life: 0, max: 90 + Math.random() * 50,
      });
    }
    if (!running) { running = true; requestAnimationFrame(tick); }
  }

  function tick() {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    pieces = pieces.filter((p) => p.life < p.max && p.y < innerHeight + 20);
    for (const p of pieces) {
      p.life++;
      p.vy += 0.22;
      p.vx *= 0.985;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - p.life / p.max);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.scale(1, Math.cos(p.life * 0.25));
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      if (p.color === "#FFFFFF") {
        ctx.strokeStyle = "#9fb3c8";
        ctx.lineWidth = 0.8;
        ctx.strokeRect(-p.w / 2, -p.h / 2, p.w, p.h);
      }
      ctx.restore();
    }
    if (pieces.length) requestAnimationFrame(tick);
    else { running = false; ctx.clearRect(0, 0, innerWidth, innerHeight); }
  }

  /* ---------------- Main ---------------- */
  async function load() {
    $("#error").hidden = true;
    $("#now").innerHTML = '<div class="loading">Loading pier conditions…</div>';
    $("#days").innerHTML = "";
    const today = Date.UTC(...(() => { const d = new Date(nowWall()); return [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()]; })());

    const [tidesR, weatherR, marineR] = await Promise.allSettled([loadTides(today), loadWeather(), loadMarine()]);
    if (tidesR.status === "rejected" || weatherR.status === "rejected") {
      const why = [tidesR, weatherR].filter((r) => r.status === "rejected").map((r) => r.reason.message).join("; ");
      $("#now").innerHTML = "";
      const err = $("#error");
      err.textContent = `Couldn't load the forecast (${why}). Check your connection and hit Refresh.`;
      err.hidden = false;
      return;
    }
    const marine = marineR.status === "fulfilled" ? marineR.value : null;
    state.tides = tidesR.value;
    state.hourly = weatherR.value.hourly;
    state.days = buildDays(weatherR.value, marine, state.tides);
    renderNow(weatherR.value, marine);
    renderDays();
    renderDetail();
  }

  $("#refresh").addEventListener("click", load);
  load();
})();
