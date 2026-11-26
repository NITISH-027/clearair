import { validateCity, validateProfile, validateAqi } from '/shared/validate.js';
import { buildPlan } from '/shared/planner.js';
import { fetchAirByCity, fetchAirByCoords, fetchConfig, fetchExplanation } from './api.js';
import { renderResults, renderAiBox } from './render.js';
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

const STORAGE_KEY = 'clearair.profile.v1';
let aiAvailable = false;
let lastRun = null;

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
    home: { windows: data.get('windows'), purifier: data.has('purifier'), cooking: data.get('cooking') },
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
  for (const key of ['children', 'elderly', 'respiratory', 'pregnant']) form.elements[key].checked = p.household[key];
  form.elements.mode.value = p.commute.mode;
  form.elements.commuteHours.value = String(p.commute.hours);
  form.elements.exerciseHours.value = String(p.exercise.outdoorHours);
  form.elements.cooking.value = p.home.cooking;
  form.elements.windows.value = p.home.windows;
  form.elements.purifier.checked = p.home.purifier;
}

function syncRoutine() {
  const home = form.elements.mode.value === 'wfh';
  form.elements.commuteHours.disabled = home;
  if (home) form.elements.commuteHours.value = '0';
}

function show(plan, air, profile) {
  document.body.dataset.level = String(plan.level);
  clear(resultsBody);
  resultsBody.append(renderResults(plan, air));
  if (aiAvailable) {
    resultsBody.append(renderAiBox({ onExplain: explain }));
  }
  lastRun = { plan, profile };
  results.hidden = false;
  results.focus({ preventScroll: true });
  results.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function explain(button, textNode) {
  if (!lastRun) return;
  button.disabled = true;
  textNode.textContent = 'Writing your explanation...';
  try {
    const { text } = await fetchExplanation({
      aqi: lastRun.plan.aqi,
      profile: lastRun.profile,
      actionIds: lastRun.plan.actionIds,
    });
    textNode.textContent = text;
  } catch (err) {
    textNode.textContent = `${err.message} Your plan above is still complete.`;
  } finally {
    button.disabled = false;
  }
}

function airFromServer(data) {
  return {
    aqi: data.current.aqi,
    pm25: data.current.pm25,
    hourly: data.hourly,
    place: data.place,
    source: 'live',
  };
}

async function run(getAir) {
  routineError.hidden = true;
  const profile = validateProfile(readProfile());
  if (!profile.ok) {
    showError(routineError, null, profile.errors[0]);
    setStatus('Please fix the highlighted field.', true);
    return;
  }
  submitBtn.disabled = true;
  locateBtn.disabled = true;
  setStatus('Reading the air and building your plan...');
  try {
    const air = await getAir();
    if (!air) return;
    const plan = buildPlan(profile.value, air);
    show(plan, air, profile.value);
    saveForm();
    setStatus(`Plan ready for ${air.place ? air.place.name : 'your reading'}. AQI ${plan.aqi}, ${plan.category}.`);
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
    run(async () => ({ aqi: aqi.value, source: 'manual', hourly: [] }));
    return;
  }
  const city = validateCity(cityInput.value);
  if (!city.ok) {
    showError(cityError, cityInput, city.error);
    cityInput.focus();
    setStatus('Please fix the highlighted field.', true);
    return;
  }
  run(async () => airFromServer(await fetchAirByCity(city.value)));
});

locateBtn.addEventListener('click', () => {
  if (!('geolocation' in navigator)) {
    setStatus('Your browser cannot share location. Type your city instead.', true);
    return;
  }
  setStatus('Asking your device for your location...');
  navigator.geolocation.getCurrentPosition(
    (pos) => run(async () => airFromServer(await fetchAirByCoords(pos.coords.latitude, pos.coords.longitude))),
    () => setStatus('Location was not shared. Type your city instead.', true),
    { timeout: 10000, maximumAge: 600000 },
  );
});

form.elements.mode.addEventListener('change', syncRoutine);

restoreForm();
syncRoutine();
fetchConfig().then((config) => {
  aiAvailable = Boolean(config.aiAvailable);
});
