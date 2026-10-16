# Architecture and platform decision

## Platform choice

The owner selected a **Flutter mobile app + ESP32**. Flutter provides a dedicated mobile interface for sensor dashboards, notifications, plant profiles, and an AI care assistant. AI does not need to run inside the mobile app: the app can call a backend AI service, which can securely hold provider credentials and combine advice with plant history.

| Option | Role in this project | Decision |
| --- | --- | --- |
| Flutter | Primary mobile interface for monitoring and care | Chosen |
| Blynk | Ready-made IoT dashboard | Not selected for the custom app experience |
| Web dashboard | Browser interface | Earlier prototype retained in `dist/` for reference |

## Local device integration

The first live connection is directly from the Flutter app to the ESP32's password-protected Wi-Fi access point. The board serves a local three-channel API; profiles and daily schedules are stored on the board. Its clock is synchronized by the phone after reboot. A separate control task enforces pump limits during network stalls. See [connection details](device-connection.md).

The app has one home screen with three cards. Each card opens species selection, care guidance, manual watering, scheduling, and collapsible sensor details. General care guides are clearly distinguished from the future AI service. The cloud/API plan below remains a later stage.

## Planned responsibilities

**ESP32:** read and calibrate soil moisture, detect invalid readings, enforce watering rules and runtime limits, drive the relay, and report telemetry. Local automation must continue using validated settings during a network outage. Sensor faults must inhibit watering. Boot and reset must leave the pump off.

**Backend:** authenticate devices and users, bind devices to their owners, validate telemetry, store readings, track device freshness, and provide authenticated APIs for the mobile app. It can also invoke the selected AI provider without exposing secrets in the app. Prefer authenticated HTTPS ingestion for the first device; introduce MQTT only if device count or delivery requirements justify it. Reject stale or replayed control requests once remote control exists.

**Flutter app:** display readings with units and timestamps, distinguish stale or missing data, show watering events, edit supported plant settings, deliver alerts, and present care advice. The app in `mobile_app/` uses the local device API for readings, settings, and bounded watering requests. Physical hardware testing is still required.

**AI service:** run on the backend with a plant profile, calibrated sensor values, and summarized historical trends. Return structured recommendations with supporting observations and missing information. No model is selected or integrated yet.

## Automation and AI

Thresholds, hysteresis, a short maximum pump runtime, cooldown, and a watering budget are deterministic controller rules. These rules are automation, not AI.

AI-assisted care will explain patterns, such as soil remaining wet longer than expected, and suggest observations or profile adjustments. It must identify unavailable evidence. Soil moisture alone cannot establish leaf disease, nutrient deficiencies, or plant identity. Photo-based analysis would be a separate optional feature requiring images and evaluation.

AI suggestions must never bypass device watering limits or change thresholds without an explicit user action. The app currently displays sourced general plant-care guides, not AI responses. Its watering controls call the local sketch and remain disabled until the board is configured and readings are valid.

## Data contract

[telemetry.schema.json](../contracts/telemetry.schema.json) defines the initial payload. Moisture is a calibrated relative percentage, not an assumed volumetric water-content measurement. Use `null` for an unavailable moisture reading and include a fault code; do not report missing data as zero.

`source: "simulator"` is mandatory for demo data. Production ingestion should reject simulator records or isolate them from real readings. `device_id` is an identifier, never an authentication credential. Before ingestion is implemented, add a boot/session identifier and sequence number for replay handling, plus a server receipt timestamp and a strategy for devices without synchronized clocks.

The local device protocol supports three-channel telemetry, freshness checks, saved profiles, daily schedules, and bounded watering requests. Cloud authentication, database history, remote access, and AI generation remain future implementation work.
