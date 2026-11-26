// AQI helpers. Uses the US EPA PM2.5 breakpoints (2024 revision), which is the
// scale the Open-Meteo air quality feed reports as "us_aqi".

const PM25_BREAKPOINTS = [
  { cLow: 0.0, cHigh: 9.0, iLow: 0, iHigh: 50 },
  { cLow: 9.1, cHigh: 35.4, iLow: 51, iHigh: 100 },
  { cLow: 35.5, cHigh: 55.4, iLow: 101, iHigh: 150 },
  { cLow: 55.5, cHigh: 125.4, iLow: 151, iHigh: 200 },
  { cLow: 125.5, cHigh: 225.4, iLow: 201, iHigh: 300 },
  { cLow: 225.5, cHigh: 325.4, iLow: 301, iHigh: 500 },
];

export const CATEGORIES = [
  { index: 0, label: 'Good', max: 50 },
  { index: 1, label: 'Moderate', max: 100 },
  { index: 2, label: 'Unhealthy for sensitive groups', max: 150 },
  { index: 3, label: 'Unhealthy', max: 200 },
  { index: 4, label: 'Very unhealthy', max: 300 },
  { index: 5, label: 'Hazardous', max: 500 },
];

function assertFiniteNonNegative(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite number >= 0`);
  }
}

/** Convert a PM2.5 concentration (ug/m3) to a US AQI value (0-500). */
export function pm25ToAqi(pm25) {
  assertFiniteNonNegative(pm25, 'pm25');
  const capped = Math.min(pm25, 325.4);
  const bp = PM25_BREAKPOINTS.find((b) => capped <= b.cHigh);
  const aqi = ((bp.iHigh - bp.iLow) / (bp.cHigh - bp.cLow)) * (capped - bp.cLow) + bp.iLow;
  return Math.round(aqi);
}

/** Inverse of pm25ToAqi: estimate PM2.5 (ug/m3) from a US AQI value. */
export function aqiToPm25(aqi) {
  assertFiniteNonNegative(aqi, 'aqi');
  const capped = Math.min(aqi, 500);
  const bp = PM25_BREAKPOINTS.find((b) => capped <= b.iHigh);
  const pm = ((bp.cHigh - bp.cLow) / (bp.iHigh - bp.iLow)) * (capped - bp.iLow) + bp.cLow;
  return Math.round(pm * 10) / 10;
}

/** Return the AQI category object for an AQI value. */
export function categoryFor(aqi) {
  assertFiniteNonNegative(aqi, 'aqi');
  return CATEGORIES.find((c) => aqi <= c.max) ?? CATEGORIES.at(-1);
}
