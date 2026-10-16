# Project roadmap

## 1. Repository and mobile app preview — in progress

- [x] Separate project repository.
- [x] Create the Flutter app foundation and mobile dashboard preview.
- [x] Add sample plant status, sensor cards, care insight, activity, and demo watering interaction.
- [x] Keep the earlier browser prototype as a reference, not the primary app.
- [x] Define the initial telemetry contract.
- [ ] Replace sample readings with a typed data model and local demo repository.
- [ ] Add plant profile, history chart, and settings screens.
- [ ] Add backend API and AI service integration.
- [x] Architecture and hardware implementation notes.

## 2. Hardware and sensor firmware

- [ ] Confirm board, sensor model, relay polarity, and pump specifications.
- [ ] Select the first plant species and pot.
- [ ] Document wiring for the actual components.
- [ ] Read raw soil moisture and calibrate the relative percentage.
- [ ] Implement explicit sensor-fault behavior with pump output disabled.
- [ ] Report readings over serial before adding networking.

## 3. Live monitoring

- [ ] Choose backend runtime, database, and hosting.
- [ ] Implement device enrollment, authenticated ingestion, replay handling, and history.
- [ ] Implement user authentication and device ownership.
- [ ] Connect ESP32 using authenticated HTTPS.
- [ ] Replace the demo adapter with the live API and show offline/stale states.

## 4. Automated watering

- [ ] Measure pump flow and select tested runtime limits.
- [ ] Implement local threshold, hysteresis, cooldown, and watering budget.
- [ ] Test boot/reset, sensor fault, lost network, and maximum runtime behavior.
- [ ] Log watering reasons, start time, duration, and result.
- [ ] Add manual watering only after the same device limits apply to it.

## 5. AI-assisted Plant Care

- [ ] Select an AI provider and define an operating budget.
- [ ] Supply plant profile, calibrated data, and trend summaries from the backend.
- [ ] Generate structured care advice with evidence and missing context.
- [ ] Evaluate advice against known plant-care examples and sensor faults.
- [ ] Present advice separately from automatic controller decisions.

## Possible later additions

Multiple plants, notifications, reservoir-level sensing, temperature/humidity/light sensors, and optional plant-photo analysis. These are outside the initial prototype.
