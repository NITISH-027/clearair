/**
 * Hourly forecast panel: an aria-hidden bar chart plus a visually hidden
 * table so screen-reader users get the same numbers.
 */
import { categoryFor } from '/shared/aqi.js';
import { hourLabel } from '/shared/util.js';
import { el } from './dom.js';

const DAY_SLICE = [0, 10];
const HOUR_SLICE = [11, 13];
const MIN_BAR_PERCENT = 4;
const FULL_BAR_PERCENT = 100;
const BAR_FULL_SCALE_AQI = 300; // AQI at which a bar fills the chart

/**
 * @param {string} iso
 * @param {number[]} range slice bounds
 * @returns {string}
 */
const part = (iso, range) => iso.slice(...range);

/**
 * True when the point falls in the two-hour cleanest window.
 * @param {{time: string}} point
 * @param {{startTime: string}|null} bestWindow
 * @returns {boolean}
 */
function isBestHour(point, bestWindow) {
  if (!bestWindow) return false;
  const start = Number(part(bestWindow.startTime, HOUR_SLICE));
  const hour = Number(part(point.time, HOUR_SLICE));
  return part(point.time, DAY_SLICE) === part(bestWindow.startTime, DAY_SLICE) && (hour === start || hour === start + 1);
}

/**
 * @param {{time: string, aqi: number}} point
 * @param {import('/shared/types.js').Plan} plan
 * @returns {HTMLElement} one chart bar
 */
function chartColumn(point, plan) {
  const level = categoryFor(point.aqi).index;
  const best = isBestHour(point, plan.bestWindow) ? ' best' : '';
  const col = el('div', { class: `col l${level}${best}` });
  const height = Math.max(MIN_BAR_PERCENT, Math.min(FULL_BAR_PERCENT, (point.aqi / BAR_FULL_SCALE_AQI) * FULL_BAR_PERCENT));
  col.style.setProperty('--h', `${height}%`);
  return col;
}

/**
 * @param {{time: string, aqi: number}} point
 * @returns {HTMLElement} one table row
 */
const tableRow = (point) => el('tr', {}, [el('th', { scope: 'row', text: hourLabel(point.time) }), el('td', { text: String(point.aqi) })]);

/**
 * @param {HTMLElement[]} rows
 * @returns {HTMLElement} the visually hidden data table
 */
const dataTable = (rows) =>
  el('table', { class: 'visually-hidden' }, [
    el('caption', { text: 'Forecast AQI for the next 24 hours' }),
    el('thead', {}, [el('tr', {}, [el('th', { scope: 'col', text: 'Hour' }), el('th', { scope: 'col', text: 'AQI' })])]),
    el('tbody', {}, rows),
  ]);

/**
 * @param {{label: string}|null} bestWindow
 * @returns {HTMLElement} the one-line caption under the chart
 */
const caption = (bestWindow) =>
  el(
    'p',
    bestWindow
      ? { text: `Cleanest window to be outside: ${bestWindow.label} (outlined bars).` }
      : { class: 'fine', text: 'No clean window stands out today.' },
  );

/**
 * Build the forecast panel, or null when there is no hourly data.
 * @param {import('/shared/types.js').Plan} plan
 * @param {{hourly?: Array<{time: string, aqi: number}>}} air
 * @returns {HTMLElement|null}
 */
export function renderForecast(plan, air) {
  if (!Array.isArray(air.hourly) || air.hourly.length === 0) return null;
  const chart = el(
    'div',
    { class: 'forecast', 'aria-hidden': 'true' },
    air.hourly.map((p) => chartColumn(p, plan)),
  );
  const first = air.hourly[0];
  const last = air.hourly[air.hourly.length - 1];
  return el('section', { class: 'panel', 'aria-label': 'Hourly forecast' }, [
    el('h2', { text: 'The next 24 hours' }),
    chart,
    el('div', { class: 'forecast-axis', 'aria-hidden': 'true' }, [
      el('span', { text: hourLabel(first.time) }),
      el('span', { text: hourLabel(last.time) }),
    ]),
    dataTable(air.hourly.map(tableRow)),
    caption(plan.bestWindow),
  ]);
}
