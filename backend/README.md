> **Sprout 3.0 online hosting:** use [the Render setup guide](online-ai.md) for Internet readings, controls and AI without the laptop. Local USB setup below is retained for development.

# Sprout AI care service

A Node.js service produces real model-assisted care proposals for Chinese bamboo, Pandakaki and Calathea. It combines the supplied moisture readings/history, plant identity and care records with Open-Meteo weather for Cagayan de Oro. Outdoor weather is context, not a measurement of indoor light or soil nutrients.

The default provider is **Gemini 3.5 Flash-Lite**. A private provider key is required before live AI reviews work. Until then `/health` reports `configured: false` and review requests return a setup message. There is no simulated or rule-based response presented as AI.

## Activate later

From your own terminal (not this chat):

```bash
cd ~/automated-iot-indoor-plant-monitoring-system
node backend/setup.mjs
```

Create a key at https://aistudio.google.com/apikey and enter it into that command's hidden prompt. It is saved to `~/.config/sprout/backend.env` with mode 0600; the running service loads it on its next request. It is not copied into the APK, Git, ESP32 or phone. Google quotas and data terms apply: https://ai.google.dev/gemini-api/docs/pricing .

## Local USB setup

Requires Node.js 22.16+ (24 LTS or newer recommended), ADB, and Sprout 2.0.0 debug installed. No npm dependencies.

```bash
node backend/prepare.mjs
node backend/install-service.mjs
adb devices
node backend/pair-phone.mjs DIK76P45VWNZJVMR
```

Preparation creates a separate random app access token. Pairing uses `adb reverse` and transfers only that token to private app storage. Close/reopen Sprout after pairing. The phone talks to `http://127.0.0.1:8765` over USB, while its Wi-Fi can remain on the PlantCare ESP32 network. **The laptop needs Internet, must be awake, and the phone must remain USB-connected for this local AI setup.** Re-run `pair-phone.mjs` after reconnecting USB if the reverse tunnel is gone. Manual device controls do not depend on this service.

`install-service.mjs` installs a user service named `sprout-care`; it runs during your login session and starts again on login. Status and logs:

```bash
systemctl --user status sprout-care
journalctl --user -u sprout-care -n 30
```

Alternatively run `node backend/server.mjs` in a terminal instead of installing the service. Do not run two instances on port 8765.

A deployed HTTPS service can be configured in the app's AI setup for use without USB. Hosting, TLS, multi-user accounts and remote pump access are not implemented by this local setup. Keep the default server bound to loopback; never expose its HTTP port publicly.

## Care behavior

- **Water:** a model may propose a 1–20 second dose, bounded by the plant's configured approval maximum (15 seconds initially). An explicit foreground Approve tap is required. Notification taps, reviews, background jobs and app restore never command a pump.
- **Fertilizer and light:** reminders only. Both can appear together. Marking either done records the user's action; it never operates hardware.
- **Unconfirmed identity:** Chinese bamboo and Pandakaki remain unconfirmed until the user identifies them. The service requests missing details rather than guessing a species or prescribing its care.
- **Missing evidence:** absent/stale/faulty/clipped/uncalibrated soil readings cannot produce an actionable water proposal. Missing feeding history/product or light observations produce a check request rather than an unsupported fertilizer/light action.
- **Notifications:** opt in from AI setup. Android schedules reviews approximately hourly with network access, subject to battery restrictions. Delivery is not exact-time. Advice also appears in the care inbox. Offline service failures never create fake advice.
- **Boundaries:** the care-evaluation route and Android background worker never issue watering commands. A separate authenticated relay forwards explicit foreground user actions to the ESP32 and waits for device confirmation.

The app stores a bounded local history of readings and reported pump transitions, plus user care records. Pump transitions are commanded state, not measured water flow. A live review sends this context and the selected city coordinates to the configured model and weather service. No camera, exact GPS or fertilizer/light sensor is implied.

## API and validation

- `GET /health`: service/provider/model and configuration status; no secrets.
- `GET /api/locations?q=...`: Open-Meteo location lookup.
- `POST /api/care/evaluate`: authenticated JSON context; returns three plant plans, model provenance, weather, source URLs, uncertainty, expiry and unique plan ID.
- Care, location and app-facing device routes require `Authorization: Bearer <app-access-token>`. Device uploads use a separate device token. See [online routes](../docs/device-connection.md).
- Model output is schema-validated and checked again against the supplied evidence. Plans expire after two hours; equivalent inputs are cached for 30 minutes and reviews are throttled per device.
- The mobile app rejects expired/context-changed proposals and rechecks fresh device readings, boot identity and pump readiness. Approval is persisted before sending, has a 30-second request expiry, and is never retried automatically after a lost reply.

Provider adapters for OpenAI Responses and local Ollama are also included, but the installed default is Gemini. For custom configuration see `.env.example` and `providers.mjs`. Provider credentials always remain server-side. The built-in source notes are in `knowledge.json`; these are curated context, not an assertion that the model browsed each page for every review.

## Verification

```bash
node --test backend/test/*.test.mjs
```

Tests use mocked model/weather responses plus a real local HTTP test server. They do not validate a paid/live provider connection or run physical pumps.

## Online plant controls (Sprout 3.0)

The existing Render service now supports the paired ESP32's readings, commands and device confirmations over HTTPS. See [Internet setup](online-ai.md). `online_device` on `/health` reports configuration only; a fresh upload is required before control requests are accepted. Use `prepare-online.mjs --device=DEVICE_ID` and `render.mjs update --commit=SHA` for the existing free service. The model, app and device use separate credentials.
