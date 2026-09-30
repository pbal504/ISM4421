# ISM4421 — Owl Tides 🦉🎣

An FAU-themed fishing planner for the **Deerfield Beach International Fishing Pier**.

- An owl flies onto the screen before the app opens (click or **Skip** to jump ahead).
- 7-day forecast with high/low tides, weather, wind, waves, and moon phase.
- Each day gets a 0–100 fishing score. Days scoring 65+ are marked **★ GOOD DAY** and
  fire **red, white & blue confetti** when you hover over them.
- Click any day to see its tide curve and the best fishing windows
  (1 hr before → 1 hr after each tide change; 🌅 = tide change near sunrise/sunset).

## Run it

No install, no login, no API keys. Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000   # then visit http://localhost:8000
```

It can also be hosted as-is on GitHub Pages.

## Data sources (free, keyless)

- Tides: [NOAA CO-OPS](https://tidesandcurrents.noaa.gov/) predictions, Hillsboro Inlet station 8722802
  (falls back to the nearest NOAA station automatically)
- Weather: [Open-Meteo](https://open-meteo.com/) forecast API
- Waves & water temp: Open-Meteo marine API

## How the score works

| Factor | Points |
| --- | --- |
| Wind (calmer is better) | up to 30 |
| Tide change within 1.5 hr of sunrise/sunset | up to 25 |
| Low chance of rain | up to 15 |
| Moon near new/full (stronger tidal currents) | up to 15 |
| Small seas | up to 15 |

The owl artwork is an original drawing in FAU colors, not the official university logo.
