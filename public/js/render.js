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
  const place = air.place ? placeLabel(air.place) : 'Your reading';
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
  } else if (air.pm25 !== undefined) {
    meta.append(el('p', { class: 'fine', text: `PM2.5 ${Math.round(air.pm25)} ug/m3 now. Model forecast, not a street monitor.` }));
  }
  return el('section', { class: 'panel aqi-card', 'aria-label': 'Current air quality' }, [badge, meta]);
}

function renderForecast(plan, air) {
  if (!Array.isArray(air.hourly) || air.hourly.length === 0) return null;
  const chart = el('div', { class: 'forecast', 'aria-hidden': 'true' });
  const rows = [];
  for (const point of air.hourly) {
    const level = categoryFor(point.aqi).index;
    const isBest = plan.bestWindow && (point.time === plan.bestWindow.startTime ||
      Number(point.time.slice(11, 13)) === Number(plan.bestWindow.startTime.slice(11, 13)) + 1);
    const col = el('div', { class: `col l${level}${isBest ? ' best' : ''}` });
    col.style.setProperty('--h', `${Math.max(4, Math.min(100, (point.aqi / 300) * 100))}%`);
    chart.append(col);
    rows.push(el('tr', {}, [
      el('th', { scope: 'row', text: formatTime(point.time) }),
      el('td', { text: String(point.aqi) }),
    ]));
  }
  const table = el('table', { class: 'visually-hidden' }, [
    el('caption', { text: 'Forecast AQI for the next 24 hours' }),
    el('thead', {}, [el('tr', {}, [el('th', { scope: 'col', text: 'Hour' }), el('th', { scope: 'col', text: 'AQI' })])]),
    el('tbody', {}, rows),
  ]);
  const first = air.hourly[0];
  const last = air.hourly.at(-1);
  const children = [
    el('h2', { text: 'The next 24 hours' }),
    chart,
    el('div', { class: 'forecast-axis', 'aria-hidden': 'true' }, [
      el('span', { text: formatTime(first.time) }),
      el('span', { text: formatTime(last.time) }),
    ]),
    table,
  ];
  if (plan.bestWindow) {
    children.push(el('p', { text: `Cleanest window to be outside: ${plan.bestWindow.label} (outlined bars).` }));
  } else {
    children.push(el('p', { class: 'fine', text: 'No clean window stands out today.' }));
  }
  return el('section', { class: 'panel', 'aria-label': 'Hourly forecast' }, children);
}

function renderExposure(plan) {
  const { baseline, withPlan, reductionPercent } = plan.exposure;
  const max = Math.max(baseline, 1);
  const bar = (label, value, cls) => {
    const fill = el('div', { class: 'bar-fill' });
    fill.style.setProperty('--w', `${Math.max(2, Math.round((value / max) * 100))}%`);
    return el('div', { class: `bar-row ${cls}` }, [
      el('span', { class: 'bar-label', text: label }),
      el('div', { class: 'bar-track', 'aria-hidden': 'true' }, [fill]),
      el('span', { text: String(value) }),
    ]);
  };
  const headline = reductionPercent >= 1
    ? `Following this plan could cut your estimated exposure today by about ${reductionPercent}%.`
    : 'Your current habits already keep your estimated exposure low today.';
  return el('section', { class: 'panel', 'aria-label': 'Your exposure' }, [
    el('h2', { text: 'What your choices change' }),
    el('p', { class: 'big-number', text: `${reductionPercent}%` }),
    el('p', { text: headline }),
    el('div', { class: 'bars' }, [
      bar('Your day as is', baseline, 'before'),
      bar('With this plan', withPlan, 'after'),
    ]),
    el('p', { class: 'fine', text: 'An illustrative index of fine particles you breathe in over 24 hours. It counts hours, breathing rate, masks, windows, purifiers and cooking. Each step below shows its own share.' }),
  ]);
}

function renderItem(item) {
  const title = el('h3', { text: item.title });
  if (item.impactPercent) title.append(el('span', { class: 'impact', text: `about ${item.impactPercent}% less` }));
  const node = el('li', { class: 'item' }, [
    title,
    el('p', { text: item.action }),
    el('p', { class: 'why' }, [el('b', { text: 'Why: ' }), item.why]),
  ]);
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

/** Build the whole results fragment. */
export function renderResults(plan, air) {
  const frag = document.createDocumentFragment();
  frag.append(renderAqiCard(plan, air));
  const forecast = renderForecast(plan, air);
  if (forecast) frag.append(forecast);
  frag.append(renderExposure(plan));
  for (const section of renderSections(plan)) frag.append(section);
  return frag;
}

/** Build the optional AI explanation box. */
export function renderAiBox({ onExplain }) {
  const text = el('p', { class: 'ai-text', id: 'ai-text' });
  const button = el('button', { type: 'button', class: 'btn secondary', id: 'ai-button' });
  button.textContent = 'Explain my plan in plain words (AI)';
  button.addEventListener('click', () => onExplain(button, text));
  return el('section', { class: 'panel ai-box', 'aria-labelledby': 'ai-title' }, [
    el('h2', { id: 'ai-title', text: 'Optional: a friendly explanation' }),
    el('p', { class: 'fine', text: 'This sends only today\'s AQI, your ticked household groups and the titles of the steps above to Google Gemini. Your city and everything else stay on this page. The plan above never needs AI.' }),
    button,
    text,
  ]);
}
