import {DEFAULT_PROFILE, normalizeProfile, createSample, getCareGuidance, chartSegments} from './telemetry.js';

const $ = (id) => document.getElementById(id);
const storageKey = 'indoor-plant-care-profile-v1';
let profile = DEFAULT_PROFILE;
try { profile = normalizeProfile(JSON.parse(localStorage.getItem(storageKey))); } catch { /* Browser storage may be unavailable. */ }
let sampleIndex = 12;
const startTime = Date.now();
const samples = Array.from({length: 12}, (_, index) => createSample('normal', index, new Date(startTime - (11 - index) * 60000)));

function render() {
  const sample = samples.at(-1);
  const guidance = getCareGuidance(sample, profile.threshold);
  $('plant-name').textContent = profile.name;
  $('plant-species').textContent = profile.species || 'Species not selected';
  $('plant-condition').textContent = guidance.condition;
  $('moisture').replaceChildren();
  $('moisture').append(document.createTextNode(sample.soil_moisture_pct === null ? '—' : String(sample.soil_moisture_pct)));
  if (sample.soil_moisture_pct !== null) {
    const unit = document.createElement('small');
    unit.textContent = '%';
    $('moisture').append(unit);
  }
  $('moisture-bar').style.width = `${sample.soil_moisture_pct ?? 0}%`;
  $('moisture-meter').setAttribute('aria-valuetext', sample.soil_moisture_pct === null ? 'Sensor unavailable' : `${sample.soil_moisture_pct} percent, simulated`);
  if (sample.soil_moisture_pct === null) $('moisture-meter').removeAttribute('aria-valuenow');
  else $('moisture-meter').setAttribute('aria-valuenow', String(sample.soil_moisture_pct));
  $('moisture-note').textContent = sample.soil_moisture_pct === null ? 'Missing reading · check sensor' : `Demo dry-soil threshold: ${profile.threshold}%`;
  $('last-sample').textContent = new Date(sample.recorded_at).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit', second: '2-digit'});
  $('care-title').textContent = guidance.title;
  $('care-message').textContent = guidance.message;
  const segments = chartSegments(samples);
  $('chart-line').setAttribute('d', segments.map(points => points.map(([x, y], index) => `${index ? 'L' : 'M'}${x},${y}`).join(' ')).join(' '));
  $('chart-area').setAttribute('d', segments.map(points => `M${points[0][0]},160 ${points.map(([x,y]) => `L${x},${y}`).join(' ')} L${points.at(-1)[0]},160 Z`).join(' '));
  const readings = samples.map(s => s.soil_moisture_pct === null ? 'unavailable' : `${s.soil_moisture_pct}%`).join(', ');
  $('trend-chart').setAttribute('aria-label', `Last ${samples.length} simulated soil moisture readings, oldest first: ${readings}`);
}

function refresh() {
  samples.push(createSample($('scenario').value, sampleIndex++));
  if (samples.length > 12) samples.shift();
  render();
}

$('refresh').addEventListener('click', refresh);
$('scenario').addEventListener('change', refresh);
$('edit-profile').addEventListener('click', () => {
  $('profile-name').value = profile.name;
  $('profile-species').value = profile.species;
  $('profile-threshold').value = profile.threshold;
  $('storage-message').textContent = '';
  $('profile-dialog').showModal();
});
$('cancel-profile').addEventListener('click', () => $('profile-dialog').close());
$('profile-form').addEventListener('submit', event => {
  event.preventDefault();
  if (!$('profile-name').value.trim()) {
    $('profile-name').setCustomValidity('Enter a plant name.');
    $('profile-name').reportValidity();
    return;
  }
  profile = normalizeProfile({name: $('profile-name').value, species: $('profile-species').value, threshold: Number($('profile-threshold').value)});
  render();
  try {
    localStorage.setItem(storageKey, JSON.stringify(profile));
    $('profile-dialog').close();
  } catch {
    $('storage-message').textContent = 'Profile applied for this visit. Browser storage is unavailable, so it will reset when you reload.';
  }
});
$('profile-name').addEventListener('input', () => $('profile-name').setCustomValidity(''));
$('export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({demo: true, profile, readings: samples}, null, 2)], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'plant-care-demo-readings.json';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
render();
