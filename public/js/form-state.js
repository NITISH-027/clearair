/**
 * Form state: reading the profile from the form, saving it to localStorage
 * and restoring it on the next visit. Everything restored is re-validated.
 */
import { validateCity, validateProfile } from '/shared/validate.js';

/** @typedef {HTMLFormElement & {elements: any}} PlanForm the plan form, whose named controls are read as properties */

const STORAGE_KEY = 'clearair.profile.v2';
const HOUSEHOLD_FIELDS = ['children', 'elderly', 'respiratory', 'pregnant'];

/**
 * Read the profile fields from the form (values are still unvalidated).
 * @param {PlanForm} form
 * @returns {object}
 */
export function readProfile(form) {
  const data = new FormData(form);
  return {
    household: Object.fromEntries(HOUSEHOLD_FIELDS.map((name) => [name, data.has(name)])),
    commute: { mode: data.get('mode'), hours: data.get('commuteHours') },
    exercise: { outdoorHours: data.get('exerciseHours') },
    home: { windows: data.get('windows'), purifier: data.has('purifier'), purifierCadr: data.get('cadr'), cooking: data.get('cooking') },
  };
}

/**
 * Save the city and profile. Storage can be blocked; the app works without it.
 * @param {{form: PlanForm, cityInput: HTMLInputElement}} fields
 */
export function saveForm({ form, cityInput }) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ city: cityInput.value, profile: readProfile(form) }));
  } catch {
    /* storage can be blocked; the app works without it */
  }
}

/**
 * @returns {{city?: string, profile?: object}|null} saved state, or null when missing or unreadable
 */
function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
  } catch {
    return null;
  }
}

/**
 * Put validated profile values back into the form controls.
 * @param {PlanForm} form
 * @param {import('/shared/types.js').Profile} p validated profile
 */
function fillForm(form, p) {
  for (const [name, checked] of Object.entries(p.household)) form.elements.namedItem(name).checked = checked;
  form.elements.mode.value = p.commute.mode;
  form.elements.commuteHours.value = String(p.commute.hours);
  form.elements.exerciseHours.value = String(p.exercise.outdoorHours);
  form.elements.cooking.value = p.home.cooking;
  form.elements.windows.value = p.home.windows;
  form.elements.purifier.checked = p.home.purifier;
  if (p.home.purifier) form.elements.cadr.value = String(p.home.purifierCadr);
}

/**
 * Restore the saved city and profile, if they still validate.
 * @param {{form: PlanForm, cityInput: HTMLInputElement}} fields
 */
export function restoreForm({ form, cityInput }) {
  const saved = loadSaved();
  if (!saved) return;
  const check = validateProfile(saved.profile);
  if (!check.ok) return;
  if (typeof saved.city === 'string' && validateCity(saved.city).ok) cityInput.value = saved.city;
  fillForm(form, /** @type {import('/shared/types.js').Profile} */ (check.value));
}
