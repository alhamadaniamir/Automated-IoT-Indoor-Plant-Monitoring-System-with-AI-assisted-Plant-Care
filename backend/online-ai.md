# Online AI without the laptop

Sprout 2.1 can use a Render-hosted care service. The phone uses mobile data for Gemini/weather and stays on PlantCare Wi-Fi for readings and pump controls. The laptop and USB cable are needed only to install/configure this debug build and upload ESP32 firmware.

## One-time hosting setup

1. Sign into https://dashboard.render.com/ and create a Render API key under Account Settings → API Keys.
2. In your laptop terminal run `node backend/render-login.mjs`. Paste the Render key into the hidden prompt. It is saved with mode 0600 under `~/.config/sprout/render-auth.json`, outside Git. Keep it out of chat and screenshots.
3. The deployment uses the plant repository's `sprout-cloud-ai` branch, with `backend` as the service root. The source must be published to that branch before deployment.
4. Run `node backend/render.mjs deploy`. It creates only one **free** Node service in Singapore, with one instance and automatic deployments disabled. If you have several workspaces, run `node backend/render.mjs owners` and select one using `deploy --owner=WORKSPACE_ID`.
5. Run `node backend/render.mjs status` to check the deployment. The HTTPS service address and ID are saved privately in `~/.config/sprout/render-service.json`.
6. With your phone connected once by USB, run `node backend/pair-phone.mjs PHONE_ID --render`, then reopen Sprout. This copies only the HTTPS address and separate app access token, preserving your plant profiles and care history. It never copies the Gemini or Render management keys.

The deployment helper sends the existing Gemini key and app access token directly to Render's environment variables over HTTPS. Values are not printed. Keep all three keys private. Re-running deployment recognizes the existing matching Sprout service instead of creating duplicates; it refuses to replace a service with different settings or a paid plan.

## Daily use

- Turn on mobile data and Wi-Fi. Join the ESP32's PlantCare network and choose to stay connected when Android says it has no Internet.
- Open Sprout and Connect for live readings. Open the AI care inbox to request advice. You can then unplug USB and turn off the laptop.
- Android binds plant-device HTTP connections specifically to Wi-Fi, while cloud requests use a validated Internet network or request mobile data. It never binds the entire app to one network. Stop has a separate native request executor; cancelling telemetry cannot cancel or delay it behind an AI review.
- AI watering remains a proposal requiring an explicit foreground approval. Fertilizer and light are user reminders. Reviews and notifications never start pumps.
- Manual On/Off and device schedules remain local. They do not require Render or Gemini. Phone connectivity is still needed during manual watering for lease renewal.

Render's free plan sleeps after 15 minutes without requests. Waking normally takes about a minute; Sprout allows up to three minutes for the whole care-service request. Care notifications are best-effort Android background jobs, approximately hourly, subject to battery restrictions, mobile Internet and service availability. Do not expect exact-time background notifications from free hosting.

This version obtains ESP32 readings through the nearby phone. It does not continuously upload readings when the phone is away or powered off. Missing or old readings result in check requests, and the cloud service has no pump endpoint. Existing schedules run on the powered ESP32 after its clock is synchronized.

## Render settings

The supplied `render.yaml` is a manual-dashboard/Blueprint alternative. Use:

| Setting | Value |
| --- | --- |
| Service | Web Service, Node, Free |
| Repository branch | `sprout-cloud-ai` |
| Root directory | `backend` |
| Build | `node --test test/*.test.mjs` |
| Start | `node server.mjs` |
| Node version | 24 |
| Health check | `/health` |
| `SPROUT_DEPLOYMENT` | `cloud` |
| `SPROUT_PROVIDER` | `gemini` |
| `SPROUT_MODEL` | `gemini-3.5-flash-lite` |
| `GEMINI_API_KEY` | Private value entered in Render, never in source |
| `SPROUT_APP_TOKEN` | Private app token matching the phone |

Render supplies `PORT`; the server listens on `0.0.0.0` for cloud operation. `/api/` routes require the private app bearer token and return JSON with caching disabled. No database is required: the phone keeps bounded care history and the server holds only temporary review/weather caches. Local laptop service configuration remains an optional development setup.

Sources: https://render.com/docs/free · https://render.com/docs/web-services · https://render.com/docs/api · https://developer.android.com/reference/android/net/Network
