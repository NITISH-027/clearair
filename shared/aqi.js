/**
 * AQI conversions on the US EPA PM2.5 scale (the "us_aqi" Open-Meteo reports).
 * Breakpoints and categories live in constants.js.
 */
import { AQI_MAX, CATEGORIES, ONE_DECIMAL, PM25_BREAKPOINTS, PM25_TABLE_MAX } from './constants.js';

/** @typedef {{index: number, label: string, max: number}} AqiCategory */

/**
 * @param {unknown} value
 * @param {string} name
 */
function assertFiniteNonNegative(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite number >= 0`);
  }
}

/**
 * Convert a PM2.5 concentration (ug/m3) to a US AQI value (0-500).
 * @param {number} pm25
 * @returns {number}
 */
export function pm25ToAqi(pm25) {
  assertFiniteNonNegative(pm25, 'pm25');
  const capped = Math.min(pm25, PM25_TABLE_MAX);
  const bp = PM25_BREAKPOINTS.find((b) => capped <= b.cHigh) ?? PM25_BREAKPOINTS[PM25_BREAKPOINTS.length - 1];
  const aqi = ((bp.iHigh - bp.iLow) / (bp.cHigh - bp.cLow)) * (capped - bp.cLow) + bp.iLow;
  return Math.round(aqi);
}

/**
 * Inverse of pm25ToAqi: estimate PM2.5 (ug/m3) from a US AQI value.
 * @param {number} aqi
 * @returns {number}
 */
export function aqiToPm25(aqi) {
  assertFiniteNonNegative(aqi, 'aqi');
  const capped = Math.min(aqi, AQI_MAX);
  const bp = PM25_BREAKPOINTS.find((b) => capped <= b.iHigh) ?? PM25_BREAKPOINTS[PM25_BREAKPOINTS.length - 1];
  const pm = ((bp.cHigh - bp.cLow) / (bp.iHigh - bp.iLow)) * (capped - bp.iLow) + bp.cLow;
  return Math.round(pm * ONE_DECIMAL) / ONE_DECIMAL;
}

/**
 * Return the AQI category for an AQI value.
 * @param {number} aqi
 * @returns {AqiCategory}
 */
export function categoryFor(aqi) {
  assertFiniteNonNegative(aqi, 'aqi');
  return CATEGORIES.find((c) => aqi <= c.max) ?? CATEGORIES[CATEGORIES.length - 1];
}
