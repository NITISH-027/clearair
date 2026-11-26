import { validateCity, validateProfile, validateAqi } from '/shared/validate.js';
import { fetchConfig, fetchPlan } from './api.js';
import { renderResults } from './render.js';
import { clear } from './dom.js';

const form = document.getElementById('plan-form');
const statusEl = document.getElementById('status');
const results = document.getElementById('results');
const resultsBody = document.getElementById('results-body');
const submitBtn = document.getElementById('submit');
const locateBtn = document.getElementById('locate');
const cityInput = document.getElementById('city');
const cityError = document.getElementById('city-error');
const aqiInput = document.getElementById('manual-aqi');
const aqiError = document.getElementById('aqi-error');
const routineError = document.getElementById('routine-error');
const cadrField = document.getElementById('cadr-field');
const cadrError = document.getElementById('cadr-error');
const notesInput = document.getElementById('notes');
const notesCount = document.getElementById('notes-count');
const aiToggle = document.getElementById('ai-toggle');

const STORAGE_KEY = 'clearair.profile.v2';

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('is-error', isError);
}

function showError(node, input, message) {
  node.textContent = message ?? '';
  node.hidden = !message;
  if (input) {
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }
}

function readProfile() {
  const data = new FormData(form);
  return {
    household: {
      children: data.has('children'),
      elderly: data.has('elderly'),
      respiratory: data.has('respiratory'),
      pregnant: data.has('pregnant'),
    },
    commute: { mode: data.get('mode'), hours: data.get('commuteHours') },
    exercise: { outdoorHours: data.get('exerciseHours') },
    home: { windows: data.get('windows'), purifier: data.has('purifier'), purifierCadr: data.get('cadr'), cooking: data.get('cooking') },
  };
}

function saveForm() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ city: cityInput.value, profile: readProfile() }));
  } catch {
    /* storage can be blocked; the app works without it */
  }
}

function restoreForm() {
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
  } catch {
    return;
  }
  const check = validateProfile(saved?.profile);
  if (!check.ok) return;
  const p = check.value;
  if (typeof saved.city === 'string' && validateCity(saved.city).ok) cityInput.value = saved.city;
  form.elements.namedItem('children').checked = p.household.children;
  form.elements.namedItem('elderly').checked = p.household.elderly;
  form.elements.namedItem('respiratory').checked = p.household.respiratory;
  form.elements.namedItem('pregnant').checked = p.household.pregnant;
  form.elements.mode.value = p.commute.mode;
  form.elements.commuteHours.value = String(p.commute.hours);
  form.elements.exerciseHours.value = String(p.exercise.outdoorHours);
  form.elements.cooking.value = p.home.cooking;
  form.elements.windows.value = p.home.windows;
  form.elements.purifier.checked = p.home.purifier;
  if (p.home.purifier) form.elements.cadr.value = String(p.home.purifierCadr);
}

function syncRoutine() {
  const home = form.elements.mode.value === 'wfh';
  form.elements.commuteHours.disabled = home;
  if (home) form.elements.commuteHours.value = '0';
}

function syncPurifier() {
  cadrField.hidden = !form.elements.purifier.checked;
}

function show(result) {
  document.body.dataset.level = String(result.plan.level);
  clear(resultsBody);
  resultsBody.append(renderResults(result));
  results.hidden = false;
  results.focus({ preventScroll: true });
  results.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** Validate the form and send `where` ({city} | {lat, lon} | {aqi}) with the profile. */
async function run(where) {
  routineError.hidden = true;
  showError(cadrError, null, '');
  const profile = validateProfile(readProfile());
  if (!profile.ok) {
    const message = profile.errors[0];
    showError(message.startsWith('Purifier') ? cadrError : routineError, null, message);
    setStatus('Please fix the highlighted field.', true);
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
    saveForm();
    const where2 = result.air.place ? result.air.place.name : 'your reading';
    setStatus(`Plan ready for ${where2}. AQI ${result.plan.aqi}, ${result.plan.category}.`);
  } catch (err) {
    setStatus(err.message, true);
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
      setStatus('Please fix the highlighted field.', true);
      return;
    }
    run({ aqi: aqi.value });
    return;
  }
  const city = validateCity(cityInput.value);
  if (!city.ok) {
    showError(cityError, cityInput, city.error);
    cityInput.focus();
    setStatus('Please fix the highlighted field.', true);
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

restoreForm();
syncRoutine();
syncPurifier();
notesCount.textContent = String(notesInput.value.length);
fetchConfig().then((config) => {
  aiToggle.hidden = !config.aiEnabled;
});
