/** Small numeric helpers shared by the planner and the exposure model. */
import { HOUR_SLICE, NOON_HOUR, ONE_DECIMAL } from './constants.js';

/**
 * Round to one decimal place.
 * @param {number} value
 * @returns {number}
 */
export function round1(value) {
  return Math.round(value * ONE_DECIMAL) / ONE_DECIMAL;
}

/**
 * True for a non-null, non-array object.
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Clock label for an ISO local time such as 2026-11-26T14:00.
 * @param {string} iso
 * @returns {string} for example "2 PM", or an empty string when the hour cannot be read
 */
export function hourLabel(iso) {
  const hour = Number(String(iso).slice(HOUR_SLICE.start, HOUR_SLICE.end));
  if (!Number.isInteger(hour)) return '';
  const h12 = hour % NOON_HOUR === 0 ? NOON_HOUR : hour % NOON_HOUR;
  return `${h12} ${hour < NOON_HOUR ? 'AM' : 'PM'}`;
}
