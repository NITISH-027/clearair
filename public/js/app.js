/**
 * Page controller: wires the form to the API and shows the results.
 */
import { validateCity, validateProfile, validateAqi } from '/shared/validate.js';
import { fetchConfig, fetchPlan } from './api.js';
import { renderResults } from './render.js';
import { byId, clear } from './dom.js';
import { readProfile, restoreForm, saveForm } from './form-state.js';

const FIX_FIELD_MESSAGE = 'Please fix the highlighted field.';

const form = /** @type {import('./form-state.js').PlanForm} */ (byId('plan-form'));
const statusEl = byId('status');
const results = byId('results');
const resultsBody = byId('results-body');
const submitBtn = /** @type {HTMLButtonElement} */ (byId('submit'));
const locateBtn = /** @type {HTMLButtonElement} */ (byId('locate'));
const cityInput = /** @type {HTMLInputElement} */ (byId('city'));
const cityError = byId('city-error');
const aqiInput = /** @type {HTMLInputElement} */ (byId('manual-aqi'));
const aqiError = byId('aqi-error');
const routineError = byId('routine-error');
const cadrField = byId('cadr-field');
const cadrError = byId('cadr-error');
const notesInput = /** @type {HTMLTextAreaElement} */ (byId('notes'));
const notesCount = byId('notes-count');
const aiToggle = byId('ai-toggle');

/**
 * @param {unknown} err
 * @returns {string} readable text for a caught value
 */
const messageOf = (err) => (err instanceof Error ? err.message : String(err));

/**
 * @param {string} message
 * @param {boolean} [isError]
 */
function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('is-error', isError);
}

/**
 * @param {HTMLElement} node
 * @param {HTMLElement|null} input
 * @param {string} [message]
 */
function showError(node, input, message) {
  node.textContent = message ?? '';
  node.hidden = !message;
  if (input) {
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }
}

function syncRoutine() {
  const home = form.elements.mode.value === 'wfh';
  form.elements.commuteHours.disabled = home;
  if (home) form.elements.commuteHours.value = '0';
}

function syncPurifier() {
  cadrField.hidden = !form.elements.purifier.checked;
}

/** @param {import('/shared/types.js').PlanResponse} result */
function show(result) {
  document.body.dataset.level = String(result.plan.level);
  clear(resultsBody);
  resultsBody.append(renderResults(result));
  results.hidden = false;
  results.focus({ preventScroll: true });
  results.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * Validate the form and send `where` ({city} | {lat, lon} | {aqi}) with the profile.
 * @param {Record<string, unknown>} where
 */
async function run(where) {
  routineError.hidden = true;
  showError(cadrError, null, '');
  const profile = validateProfile(readProfile(form));
  if (!profile.ok) {
    const message = profile.errors[0];
    showError(message.startsWith('Purifier') ? cadrError : routineError, null, message);
    setStatus(FIX_FIELD_MESSAGE, true);
    return;
  }
  submitBtn.disabled = true;
  locateBtn.disabled = true;
  // When the server has no AI key, still ask: the response then labels the rule-based plan clearly.
  const useAi = aiToggle.hidden || form.elements.useAi.checked;
  setStatus(useAi && !aiToggle.hidden ? 'Reading the air and asking Gemini for your plan...' : 'Reading the air and building your plan...');
  try {
    const result = await fetchPlan({
      ...where,
      profile: profile.value,
      notes: notesInput.value,
      useAi,
    });
    show(result);
    saveForm({ form, cityInput });
    const where2 = result.air.place ? result.air.place.name : 'your reading';
    setStatus(`Plan ready for ${where2}. AQI ${result.plan.aqi}, ${result.plan.category}.`);
  } catch (err) {
    setStatus(messageOf(err), true);
  } finally {
    submitBtn.disabled = false;
    locateBtn.disabled = false;
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  showError(cityError, cityInput, '');
  showError(aqiError, aqiInput, '');
  const manual = aqiInput.value.trim();
  if (manual !== '') {
    const aqi = validateAqi(manual);
    if (!aqi.ok) {
      showError(aqiError, aqiInput, aqi.error);
      aqiInput.focus();
      setStatus(FIX_FIELD_MESSAGE, true);
      return;
    }
    run({ aqi: aqi.value });
    return;
  }
  const city = validateCity(cityInput.value);
  if (!city.ok) {
    showError(cityError, cityInput, city.error);
    cityInput.focus();
    setStatus(FIX_FIELD_MESSAGE, true);
    return;
  }
  run({ city: city.value });
});

locateBtn.addEventListener('click', () => {
  if (!('geolocation' in navigator)) {
    setStatus('Your browser cannot share location. Type your city instead.', true);
    return;
  }
  setStatus('Asking your device for your location...');
  navigator.geolocation.getCurrentPosition(
    (pos) => run({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
    () => setStatus('Location was not shared. Type your city instead.', true),
    { timeout: 10000, maximumAge: 600000 },
  );
});

form.elements.mode.addEventListener('change', syncRoutine);
form.elements.purifier.addEventListener('change', syncPurifier);
notesInput.addEventListener('input', () => {
  notesCount.textContent = String(notesInput.value.length);
});

restoreForm({ form, cityInput });
syncRoutine();
syncPurifier();
notesCount.textContent = String(notesInput.value.length);
fetchConfig().then((config) => {
  aiToggle.hidden = !config.aiEnabled;
});
