// Demo data only. Keep the same payload shape when real device ingestion is added.
export const DEFAULT_PROFILE = Object.freeze({name: 'My indoor plant', species: '', threshold: 30});

export function normalizeProfile(value) {
  return {
    name: typeof value?.name === 'string' && value.name.trim() ? value.name.trim().slice(0, 60) : DEFAULT_PROFILE.name,
    species: typeof value?.species === 'string' ? value.species.trim().slice(0, 80) : '',
    threshold: Number.isInteger(value?.threshold) && value.threshold >= 1 && value.threshold <= 99 ? value.threshold : DEFAULT_PROFILE.threshold,
  };
}

export function createSample(scenario = 'normal', index = 0, now = new Date()) {
  const moisture = scenario === 'sensor-fault' ? null : Math.round((scenario === 'dry' ? 18 : 48) + Math.sin(index * 0.7) * 4);
  return {
    schema_version: 1,
    source: 'simulator',
    device_id: 'demo-esp32-01',
    plant_id: 'plant-01',
    recorded_at: now.toISOString(),
    soil_moisture_pct: moisture,
    pump_running: false,
    faults: scenario === 'sensor-fault' ? ['soil_moisture_unavailable'] : [],
  };
}

export function getCareGuidance(sample, threshold) {
  if (sample.soil_moisture_pct === null || sample.faults.length) {
    return {condition: 'Sample sensor fault', title: 'A reading needs attention.', message: 'The sample soil sensor is unavailable. Check the sensor and its connection before using its readings for watering. The real controller should keep the pump off when sensor data is missing.'};
  }
  if (sample.soil_moisture_pct < threshold) {
    return {condition: 'Sample dry soil', title: 'Time to check the soil.', message: 'The sample moisture is below your demo threshold. Check the soil and your plant’s needs before watering. Automatic watering will be added after calibration and pump limits are tested.'};
  }
  return {condition: 'Sample moisture in range', title: 'A good moment to observe.', message: 'The sample soil moisture is above your demo dry-soil threshold. Keep watching the trend. Your plant species and growing medium should inform the final care profile.'};
}

export function chartSegments(samples) {
  // Missing readings must create gaps rather than connecting across a failed sensor.
  const segments = [];
  let current = [];
  samples.forEach((sample, index) => {
    if (sample.soil_moisture_pct === null) {
      if (current.length) segments.push(current);
      current = [];
    } else {
      current.push([index * (600 / Math.max(samples.length - 1, 1)), 160 - sample.soil_moisture_pct * 1.5]);
    }
  });
  if (current.length) segments.push(current);
  return segments;
}
