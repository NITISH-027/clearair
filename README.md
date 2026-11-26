# ClearAir: a winter smog assistant

PromptWars Challenge 6, Urban Air Quality Assistant.

ClearAir helps families and communities handle severe winter smog. You tell it about your day (who is at home, how you travel, how you cook, whether windows are open). It reads the live air quality for your city and builds a plan for your **routine**, your **home air** and **lower-emission swaps**. Every step says **why**, and the app shows **how much each choice changes your exposure**.

## How it answers the problem statement

| Requirement | What ClearAir does |
| --- | --- |
| Low-emission daily routines | Step-by-step day plan: when to go out (cleanest two-hour window from the 24 h forecast), commute mask and car cabin advice, workouts moved indoors on bad days |
| Indoor air quality hacks | Windows, HEPA purifier, cooking ventilation, no incense or dry sweeping, one short airing in the cleanest window |
| Sustainable alternatives | Metro/bus/shared rides, induction cooking, no open burning, no idling |
| Tailored to location and lifestyle | Live reading for the city or your GPS position; advice changes with commute mode, cooking fuel, windows, purifier, children, older adults, asthma, pregnancy |
| Clearly explain the direct impact | Each step has a **Why**. Steps with a measurable effect show "about N% less" exposure. A summary compares "your day as is" with "with this plan" |

## Run it

```bash
npm test          # 42 tests, no dependencies to install
npm start         # http://localhost:8080
```

Needs Node 20 or newer. There are **no runtime dependencies**.

Optional AI explanation: set `GEMINI_API_KEY` (and optionally `GEMINI_MODEL`). Without it the app works fully and hides the AI button.

### Deploy

A `Dockerfile` is included (Cloud Run, Render or any container host). Set `PORT` if the host needs it, `TRUST_PROXY=1` behind a proxy so rate limiting sees real client IPs, and `GEMINI_API_KEY` for the optional AI feature.

## Gen AI services used, and where

- **Core plan: none.** The plan, the exposure numbers and the explanations come from a transparent rules engine (`shared/planner.js`) and exposure model (`shared/exposure.js`). That keeps results deterministic, testable and free to run.
- **Google Gemini (optional)** via `POST /api/explain`: turns the finished plan into a short friendly explanation. The server sends the model only the AQI, the ticked household groups and the catalogue titles of the plan steps, all validated. No free text from the user ever reaches the model, which blocks prompt injection. The user must click a button, and the page says what is sent.

## Design

```
shared/   code that runs in both browser and server (pure, tested)
  aqi.js        PM2.5 <-> US AQI (EPA breakpoints), categories
  validate.js   all input validation (city, coords, profile, AQI)
  exposure.js   transparent daily exposure model
  planner.js    rules -> personalised plan, best-window finder
server.js       zero-dependency Node server: static files, /api/air, /api/explain
public/         accessible UI (no inline scripts or styles, strict CSP)
test/           node:test suites
```

Choices worth knowing:

- **Validate at every boundary.** The same validators run in the browser and on the server. Unknown keys are dropped, enums and ranges are enforced.
- **Security.** Strict CSP (no inline code), `nosniff`, frame denial, no-referrer. Path traversal is blocked and only known file types are served. JSON bodies are capped at 8 KB. Per-IP rate limits. Upstream calls use timeouts. The API key lives only in an env var and goes in a request header, never a URL. The UI builds DOM with `textContent`, never `innerHTML`.
- **Efficiency.** No framework, no build step, about 25 KB of JS and CSS. Air results are cached for 10 minutes in a bounded cache. Static files are cacheable. One upstream call gives the current reading and the 24 h forecast.
- **Accessibility.** Semantic landmarks, a skip link, labelled fields, grouped fieldsets, inline errors with `role="alert"`, a live status region, focus moved to the results, 48 px touch targets, visible focus rings, colour is never the only signal (labels and numbers are always shown), a text table behind the forecast chart, reduced-motion and forced-colors support.
- **Graceful failure.** If the data service is down the user can type an AQI and still get a full plan.

## Assumptions and limits

- Air data comes from the Open-Meteo Air Quality API (CAMS model), on the US AQI scale. It is a model estimate, not a street monitor, and it can differ from India's national AQI.
- The exposure model is illustrative: concentration x hours x breathing rate, with simple factors for masks, windows, purifiers and cooking. It exists to compare choices, not to diagnose anything.
- Not medical advice.

## Tests

`npm test` runs 42 tests covering AQI maths and boundaries, input validation (including hostile input), the planner rules and best-window logic, the exposure model, and the HTTP server (headers, traversal, validation, caching, upstream failures, rate limiting, AI prompt safety).
