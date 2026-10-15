# Architecture and platform decision

## Platform choice

The owner selected **a responsive web app + ESP32** for this project.

| Option | Useful when | Implication for this project |
| --- | --- | --- |
| Blynk | Getting a hardware dashboard running quickly | Ready-made mobile/web widgets; custom AI UX would need additional integration |
| Responsive web app | Opening a custom dashboard on a phone or computer | Chosen; one browser interface for monitoring, history, and care advice |
| Flutter | Building a dedicated mobile application | A possible later client of the same backend; Flutter can also target the browser |

This comparison is an implementation judgment. Capability references: [Blynk dashboard documentation](https://docs.blynk.io/en/blynk.console/templates/dashboard), [Flutter web documentation](https://docs.flutter.dev/platform-integration/web).

## Planned responsibilities

**ESP32:** read and calibrate soil moisture, detect invalid readings, enforce watering rules and runtime limits, drive the relay, and report telemetry. Local automation must continue using validated settings during a network outage. Sensor faults must inhibit watering. Boot and reset must leave the pump off.

**Backend:** authenticate devices and users, bind devices to their owners, validate telemetry, store readings, track device freshness, and provide the web API. Prefer authenticated HTTPS ingestion for the first device; introduce MQTT only if device count or delivery requirements justify it. Reject stale or replayed control requests once remote control exists.

**Web app:** show readings with units and timestamps, distinguish stale/missing data, display watering events, edit supported plant settings, and present care advice. The current static prototype only displays simulated data; it has no backend endpoints.

**AI service:** run on the backend with a plant profile, calibrated sensor values, and summarized historical trends. Return structured recommendations with supporting observations and missing information. No model is selected or integrated yet.

## Automation and AI

Thresholds, hysteresis, a short maximum pump runtime, cooldown, and a watering budget are deterministic controller rules. These rules are automation, not AI.

AI-assisted care will explain patterns, such as soil remaining wet longer than expected, and suggest observations or profile adjustments. It must identify unavailable evidence. Soil moisture alone cannot establish leaf disease, nutrient deficiencies, or plant identity. Photo-based analysis would be a separate optional feature requiring images and evaluation.

AI suggestions must never bypass device watering limits or change thresholds without an explicit user action. The web preview uses clearly labeled demo rules until the real AI feature is implemented.

## Data contract

[telemetry.schema.json](../contracts/telemetry.schema.json) defines the initial payload. Moisture is a calibrated relative percentage, not an assumed volumetric water-content measurement. Use `null` for an unavailable moisture reading and include a fault code; do not report missing data as zero.

`source: "simulator"` is mandatory for demo data. Production ingestion should reject simulator records or isolate them from real readings. `device_id` is an identifier, never an authentication credential. Before ingestion is implemented, add a boot/session identifier and sequence number for replay handling, plus a server receipt timestamp and a strategy for devices without synchronized clocks.

Only the initial telemetry shape and frontend simulator exist today. Authentication, persistence, live freshness detection, device commands, and AI generation are future implementation work.
