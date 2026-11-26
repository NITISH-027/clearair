/**
 * Builds the results page DOM from a /api/plan response. Text only ever goes
 * in through textContent, never markup.
 */
import { el } from './dom.js';
import { renderForecast } from './render-forecast.js';
import { renderMethod } from './render-method.js';

/** @param {import('/shared/types.js').Place} place */
function placeLabel(place) {
  return [place.name, place.country].filter(Boolean).join(', ');
}

/**
 * @param {import('/shared/types.js').Plan} plan
 * @param {import('/shared/types.js').AirData} air
 */
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
  const art =
    plan.aqi > 100
      ? el('img', { class: 'result-art', src: '/img/mask.webp', alt: '', width: '480', height: '343' })
      : el('img', { class: 'result-art', src: '/img/house.webp', alt: '', width: '480', height: '479' });
  return el('section', { class: 'panel aqi-card', 'aria-label': 'Current air quality' }, [badge, meta, art]);
}

/**
 * @param {any} ai Gemini block: model, summary, notice, steps
 * @returns {HTMLElement}
 */
function renderGemini(ai) {
  const steps = ai.steps.map((/** @type {any} */ s) =>
    el('li', { class: 'item' }, [
      el('h3', {}, [s.title, ' ', el('span', { class: 'tag', text: `${s.when}, ${s.category}` })]),
      el('p', { text: s.action }),
      el('p', { class: 'why' }, [el('b', { text: 'Why: ' }), s.why]),
    ]),
  );
  const children = [
    el('span', { class: 'badge', text: `Personalised by Gemini (${ai.model})` }),
    el('h2', { id: 'ai-title', text: 'Your personalised plan' }),
    el('p', { class: 'summary', text: ai.summary }),
    el('ul', { class: 'items' }, steps),
  ];
  if (ai.notice) children.splice(2, 0, el('p', { class: 'fine', text: ai.notice }));
  return el('section', { class: 'panel ai-banner', 'aria-labelledby': 'ai-title' }, children);
}

/**
 * @param {any} ai fallback block: source, label, notice, reason, detail
 * @returns {HTMLElement}
 */
function renderFallback(ai) {
  const children = [
    el('span', { class: 'badge fallback', text: ai.source === 'off' ? 'Rule-based plan' : 'Rule-based fallback plan' }),
    el('p', { text: ai.label }),
  ];
  if (ai.notice) children.push(el('p', { class: 'fine', text: ai.notice }));
  if (ai.source === 'fallback' && ai.reason) {
    const detail = ai.detail ? ` (${ai.detail})` : '';
    children.push(el('p', { class: 'fine', text: `Reason: ${ai.reason}${detail}` }));
  }
  return el('section', { class: 'panel ai-banner fallback', 'aria-label': 'Plan source' }, children);
}

/**
 * @param {any} ai the `ai` block of the response
 * @returns {HTMLElement}
 */
function renderAi(ai) {
  return ai.source === 'gemini' ? renderGemini(ai) : renderFallback(ai);
}

/** @param {import('/shared/types.js').Plan} plan */
function renderExposure(plan) {
  const e = plan.exposure;
  const max = Math.max(e.baseline, 1);
  /**
   * @param {string} label
   * @param {number} value
   * @param {string} cls
   */
  const bar = (label, value, cls) => {
    const fill = el('div', { class: 'bar-fill' });
    fill.style.setProperty('--w', `${Math.max(2, Math.round((value / max) * 100))}%`);
    return el('div', { class: `bar-row ${cls}` }, [
      el('span', { class: 'bar-label', text: label }),
      el('div', { class: 'bar-track', 'aria-hidden': 'true' }, [fill]),
      el('span', { text: `${value} ug` }),
    ]);
  };
  const headline =
    e.reductionPercent >= 1
      ? `Following the steps below could cut the PM2.5 you inhale today by about ${e.reductionPercent}%.`
      : 'Your current habits already keep the PM2.5 you inhale low today.';
  const guide = el('abbr', {
    title: 'WHO Global Air Quality Guidelines 2021: the 24-hour average should stay at or below 15 ug/m3.',
    text: 'WHO 24-hour guideline',
  });
  return el('section', { class: 'panel', 'aria-label': 'Your exposure' }, [
    el('img', { class: 'result-art float', src: '/img/purifier.webp', alt: '', width: '408', height: '520' }),
    el('h2', { text: 'What your choices change' }),
    el('p', { class: 'big-number', text: `${e.reductionPercent}%` }),
    el('p', { text: headline }),
    el('div', { class: 'bars' }, [bar('Your day as is', e.baseline, 'before'), bar('With these steps', e.withPlan, 'after')]),
    el('p', {}, [
      `Average air you breathe over the day: ${e.meanConcentration} ug/m3 now, ${e.meanConcentrationWithPlan} ug/m3 with the steps. The `,
      guide,
      ` is ${e.whoGuideline} ug/m3.`,
    ]),
  ]);
}

/** @param {import('/shared/types.js').PlanItem} item */
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

/** @param {import('/shared/types.js').Plan} plan */
function renderSections(plan) {
  return plan.sections.map((section) => {
    const headingId = `sec-${section.id}`;
    return el('section', { class: 'plan-section', 'aria-labelledby': headingId }, [
      el('h2', { id: headingId, text: section.title }),
      el('ul', { class: 'items' }, section.items.map(renderItem)),
    ]);
  });
}

/**
 * Build the whole results fragment from a /api/plan response.
 * @param {import('/shared/types.js').PlanResponse} response
 */
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
