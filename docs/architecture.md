# Architecture and platform decision

## Platform choice

The owner selected a **Flutter mobile app + ESP32**. Flutter provides a dedicated mobile interface for sensor dashboards, notifications, plant profiles, and an AI care assistant. AI does not need to run inside the mobile app: the app can call a backend AI service, which can securely hold provider credentials and combine advice with plant history.

| Option | Role in this project | Decision |
| --- | --- | --- |
| Flutter | Primary mobile interface for monitoring and care | Chosen |
| Blynk | Ready-made IoT dashboard | Not selected for the custom app experience |
| Web dashboard | Browser interface | Earlier prototype retained in `dist/` for reference |

## Planned responsibilities

**ESP32:** read and calibrate soil moisture, detect invalid readings, enforce watering rules and runtime limits, drive the relay, and report telemetry. Local automation must continue using validated settings during a network outage. Sensor faults must inhibit watering. Boot and reset must leave the pump off.

**Backend:** authenticate devices and users, bind devices to their owners, validate telemetry, store readings, track device freshness, and provide authenticated APIs for the mobile app. It can also invoke the selected AI provider without exposing secrets in the app. Prefer authenticated HTTPS ingestion for the first device; introduce MQTT only if device count or delivery requirements justify it. Reject stale or replayed control requests once remote control exists.

**Flutter app:** display readings with units and timestamps, distinguish stale or missing data, show watering events, edit supported plant settings, deliver alerts, and present care advice. The initial app in `mobile_app/` is a UI preview with simulated readings; it has no backend endpoints or hardware connection yet.

**AI service:** run on the backend with a plant profile, calibrated sensor values, and summarized historical trends. Return structured recommendations with supporting observations and missing information. No model is selected or integrated yet.

## Automation and AI

Thresholds, hysteresis, a short maximum pump runtime, cooldown, and a watering budget are deterministic controller rules. These rules are automation, not AI.

AI-assisted care will explain patterns, such as soil remaining wet longer than expected, and suggest observations or profile adjustments. It must identify unavailable evidence. Soil moisture alone cannot establish leaf disease, nutrient deficiencies, or plant identity. Photo-based analysis would be a separate optional feature requiring images and evaluation.

AI suggestions must never bypass device watering limits or change thresholds without an explicit user action. The mobile preview currently displays a sample insight; it is not a live AI response. Its watering button is a demo interaction and cannot control a physical pump.

## Data contract

[telemetry.schema.json](../contracts/telemetry.schema.json) defines the initial payload. Moisture is a calibrated relative percentage, not an assumed volumetric water-content measurement. Use `null` for an unavailable moisture reading and include a fault code; do not report missing data as zero.

`source: "simulator"` is mandatory for demo data. Production ingestion should reject simulator records or isolate them from real readings. `device_id` is an identifier, never an authentication credential. Before ingestion is implemented, add a boot/session identifier and sequence number for replay handling, plus a server receipt timestamp and a strategy for devices without synchronized clocks.

Only the initial telemetry shape and previews exist today. Authentication, persistence, live freshness detection, device commands, and AI generation are future implementation work.
