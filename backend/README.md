# Backend — planned

No server implementation or AI provider is configured yet. This directory reserves the backend boundary while the frontend can be developed using simulated data.

The first implementation should expose authenticated telemetry ingestion, latest readings, reading history, plant profiles, and care advice. Device authentication and user authentication are separate, and every read/update must enforce plant and device ownership. Keep AI and database credentials on the server.

Suggested API outline, subject to implementation:

```text
POST /api/device/telemetry      Device-authenticated readings
GET  /api/plants                Owner's plant profiles
GET  /api/plants/:id/latest     Latest reading and server receipt time
GET  /api/plants/:id/history    Bounded historical readings
PUT  /api/plants/:id/profile    Validated plant profile updates
POST /api/plants/:id/care       Generate or retrieve AI care advice
```

Do not expose a watering endpoint until device-local limits, authenticated commands, request expiry, deduplication, and command-result reporting are implemented. A submitted request must not be reported as completed watering without device acknowledgement.

For AI, send a bounded history summary and species/profile context. Return recommendations with the data that supports them and uncertainty when context is missing. Current browser care rules are a demo and must not be presented as an AI model.
