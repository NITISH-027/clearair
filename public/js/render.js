import { el } from './dom.js';
import { categoryFor } from '/shared/aqi.js';

function formatTime(iso) {
  const hour = Number(String(iso).slice(11, 13));
  if (!Number.isInteger(hour)) return '';
  return `${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? 'AM' : 'PM'}`;
}

function placeLabel(place) {
  return [place.name, place.country].filter(Boolean).join(', ');
}

function renderAqiCard(plan, air) {
  const place = air.place ? placeLabel(air.place) : 'your reading';
  const badge = el('div', { class: 'aqi-badge', 'aria-hidden': 'true' }, [
    el('div', {}, [el('strong', { text: String(plan.aqi) }), el('span', { text: 'US AQI' })]),
  ]);
  const meta = el('div', { class: 'aqi-meta' }, [
    el('h2', { text: `Air in ${place}` }),
    el('p', {}, [el('span', { class: 'pill', text: `AQI ${plan.aqi}: ${plan.category}` })]),
    el('p', { class: 'summary', text: plan.summary }),
  ]);
  if (air.source === 'manual') {
    meta.append(el('p', { class: 'fine', text: 'Based on the AQI you entered. Hourly advice needs a live reading.' }));
  } else {
    meta.append(el('p', { class: 'fine', text: `PM2.5 ${Math.round(air.current.pm25)} ug/m3 now. Model forecast, not a street monitor.` }));
  }
  return el('section', { class: 'panel aqi-card', 'aria-label': 'Current air quality' }, [badge, meta]);
}

function renderAi(ai) {
  if (ai.source === 'gemini') {
    const steps = ai.steps.map((s) => el('li', { class: 'item' }, [
      el('h3', {}, [s.title, ' ', el('span', { class: 'tag', text: `${s.when}, ${s.category}` })]),
      el('p', { text: s.action }),
      el('p', { class: 'why' }, [el('b', { text: 'Why: ' }), s.why]),
    ]));
    const children = [
      el('span', { class: 'badge', text: `Personalised by Gemini (${ai.model})` }),
      el('h2', { id: 'ai-title', text: 'Your personalised plan' }),
      el('p', { class: 'summary', text: ai.summary }),
      el('ul', { class: 'items' }, steps),
    ];
    if (ai.notice) children.splice(2, 0, el('p', { class: 'fine', text: ai.notice }));
    return el('section', { class: 'panel ai-banner', 'aria-labelledby': 'ai-title' }, children);
  }
  const children = [
    el('span', { class: 'badge fallback', text: ai.source === 'off' ? 'Rule-based plan' : 'Rule-based fallback plan' }),
    el('p', { text: ai.label }),
  ];
  if (ai.notice) children.push(el('p', { class: 'fine', text: ai.notice }));
  if (ai.source === 'fallback' && ai.reason) {
    children.push(el('p', { class: 'fine', text: `Reason: ${ai.reason}${ai.detail ? ` (${ai.detail})` : ''}` }));
  }
  return el('section', { class: 'panel ai-banner fallback', 'aria-label': 'Plan source' }, children);
}

function renderForecast(plan, air) {
  if (!Array.isArray(air.hourly) || air.hourly.length === 0) return null;
  const chart = el('div', { class: 'forecast', 'aria-hidden': 'true' });
  const rows = [];
  const bestStart = plan.bestWindow ? Number(plan.bestWindow.startTime.slice(11, 13)) : null;
  for (const point of air.hourly) {
    const level = categoryFor(point.aqi).index;
    const hour = Number(point.time.slice(11, 13));
    const isBest = bestStart !== null && point.time.slice(0, 10) === plan.bestWindow.startTime.slice(0, 10) && (hour === bestStart || hour === bestStart + 1);
    const col = el('div', { class: `col l${level}${isBest ? ' best' : ''}` });
    col.style.setProperty('--h', `${Math.max(4, Math.min(100, (point.aqi / 300) * 100))}%`);
    chart.append(col);
    rows.push(el('tr', {}, [el('th', { scope: 'row', text: formatTime(point.time) }), el('td', { text: String(point.aqi) })]));
  }
  const table = el('table', { class: 'visually-hidden' }, [
    el('caption', { text: 'Forecast AQI for the next 24 hours' }),
    el('thead', {}, [el('tr', {}, [el('th', { scope: 'col', text: 'Hour' }), el('th', { scope: 'col', text: 'AQI' })])]),
    el('tbody', {}, rows),
  ]);
  const first = air.hourly[0];
  const last = air.hourly.at(-1);
  return el('section', { class: 'panel', 'aria-label': 'Hourly forecast' }, [
    el('h2', { text: 'The next 24 hours' }),
    chart,
    el('div', { class: 'forecast-axis', 'aria-hidden': 'true' }, [el('span', { text: formatTime(first.time) }), el('span', { text: formatTime(last.time) })]),
    table,
    el('p', plan.bestWindow ? { text: `Cleanest window to be outside: ${plan.bestWindow.label} (outlined bars).` } : { class: 'fine', text: 'No clean window stands out today.' }),
  ]);
}

function renderExposure(plan) {
  const e = plan.exposure;
  const max = Math.max(e.baseline, 1);
  const bar = (label, value, cls) => {
    const fill = el('div', { class: 'bar-fill' });
    fill.style.setProperty('--w', `${Math.max(2, Math.round((value / max) * 100))}%`);
    return el('div', { class: `bar-row ${cls}` }, [
      el('span', { class: 'bar-label', text: label }),
      el('div', { class: 'bar-track', 'aria-hidden': 'true' }, [fill]),
      el('span', { text: `${value} ug` }),
    ]);
  };
  const headline = e.reductionPercent >= 1
    ? `Following the steps below could cut the PM2.5 you inhale today by about ${e.reductionPercent}%.`
    : 'Your current habits already keep the PM2.5 you inhale low today.';
  const guide = el('abbr', { title: 'WHO Global Air Quality Guidelines 2021: the 24-hour average should stay at or below 15 ug/m3.', text: 'WHO 24-hour guideline' });
  return el('section', { class: 'panel', 'aria-label': 'Your exposure' }, [
    el('h2', { text: 'What your choices change' }),
    el('p', { class: 'big-number', text: `${e.reductionPercent}%` }),
    el('p', { text: headline }),
    el('div', { class: 'bars' }, [
      bar('Your day as is', e.baseline, 'before'),
      bar('With these steps', e.withPlan, 'after'),
    ]),
    el('p', {}, [
      `Average air you breathe over the day: ${e.meanConcentration} ug/m3 now, ${e.meanConcentrationWithPlan} ug/m3 with the steps. The `,
      guide,
      ` is ${e.whoGuideline} ug/m3.`,
    ]),
  ]);
}

function renderMethod() {
  const code = (text) => el('pre', { text });
  return el('details', { class: 'panel method' }, [
    el('summary', { text: 'How the numbers are calculated' }),
    el('p', { text: 'Inhaled PM2.5 per day is the sum, over each place you spend time, of concentration x breathing rate x hours (US EPA Exposure Factors Handbook; Klepeis et al. 2001).' }),
    code('dose = sum( C_i x V_i x t_i )   in ug/day'),
    el('p', { text: 'Indoor air uses a single-room mass balance (Riley et al. 2002; Chen and Zhao 2011). P is how much leaks through the walls, a is air changes per hour, k is particle settling, CADR is the purifier\'s clean air delivery rate and V is the room volume.' }),
    code('C_in = (P x a x C_out + S / V) / (a + k + CADR / V)'),
    el('ul', {}, [
      el('li', { text: 'Windows open a = 2.0 per hour, closed a = 0.5. P = 0.8, k = 0.2 per hour, room 40 m3. Purifier covers 70% of indoor time.' }),
      el('li', { text: 'Breathing rates in m3 per hour: sleep 0.3, rest 0.5, light 1.0, hard exercise 2.0.' }),
      el('li', { text: 'Cooking sits in a 15 m3 kitchen for 2 hours. Wood, dung and coal add about 600 ug/m3, gas about 40, induction under 10. An exhaust fan triples the air exchange.' }),
      el('li', { text: 'A fitted N95 uses a protection factor of 5, half of the OSHA value of 10 for half-mask respirators, because most people do not get a perfect seal.' }),
      el('li', { text: 'AQI follows the US EPA PM2.5 breakpoints (2024). Every constant is an assumption taken from the ranges in these sources, so use the result to compare choices, not as a measurement.' }),
    ]),
  ]);
}

function renderItem(item) {
  const title = el('h3', { text: item.title });
  if (item.impactPercent) title.append(el('span', { class: 'impact', text: `about ${item.impactPercent}% less` }));
  const node = el('li', { class: 'item' }, [title, el('p', { text: item.action }), el('p', { class: 'why' }, [el('b', { text: 'Why: ' }), item.why])]);
  if (item.note) node.append(el('p', { class: 'note', text: item.note }));
  return node;
}

function renderSections(plan) {
  return plan.sections.map((section) => {
    const headingId = `sec-${section.id}`;
    return el('section', { class: 'plan-section', 'aria-labelledby': headingId }, [
      el('h2', { id: headingId, text: section.title }),
      el('ul', { class: 'items' }, section.items.map(renderItem)),
    ]);
  });
}

/** Build the whole results fragment from a /api/plan response. */
export function renderResults({ air, plan, ai }) {
  const frag = document.createDocumentFragment();
  frag.append(renderAqiCard(plan, air), renderAi(ai));
  const forecast = renderForecast(plan, air);
  if (forecast) frag.append(forecast);
  frag.append(renderExposure(plan));
  for (const section of renderSections(plan)) frag.append(section);
  frag.append(renderMethod());
  return frag;
}
