# Sprout over the Internet

Sprout 3.0 connects the phone and ESP32-S3 through the existing Render HTTPS service. The phone can use mobile data or normal Wi-Fi. The ESP32 connects to a nearby 2.4 GHz personal Wi-Fi router or hotspot; fiber, cable and mobile data can all provide that router's upstream Internet. They do not have to use the same network. The ESP32 has no built-in cellular modem. Browser-login and enterprise Wi-Fi are not supported by this setup.

```
Sprout phone <--- authenticated HTTPS ---> Render <--- authenticated HTTPS ---> ESP32
                                             |
                                        Gemini + weather
```

## One-time deployment

The private model key and app pairing already live outside Git under `~/.config/sprout`. Render management credentials are entered only through `node backend/render-login.mjs` and never copied to the phone or ESP32.

1. Prepare a separate device credential with `node backend/prepare-online.mjs --device=plantcare-YOUR_ID`. This preserves the app pairing and model key. The device ID is printed by the sketch; do not guess it for another board.
2. Publish the tested backend to the repository's `sprout-cloud-ai` branch. The service root remains `backend`, Node 24, plan **free**, Singapore. No paid service is needed by this implementation.
3. For an existing service, run `node backend/render.mjs update --commit=TESTED_PUBLISHED_SHA`. It verifies the saved service/repository/branch/free plan, adds only the device environment variables and deploys the exact reviewed commit.
4. Check `node backend/render.mjs status` and `/health`. `online_device: true` means pairing is configured; it does not mean the physical ESP32 is online.
5. Install the Sprout 3.0 APK without uninstalling the existing app. This preserves plant profiles, care history and its private app token. `node backend/pair-phone.mjs PHONE_ID --render` is available for a newly installed phone.

The separate device token can upload readings and receive commands for this one paired prototype board. The app token can read its status and submit user actions. Neither token is the Gemini key or the Render management key. No private value belongs in a sketch source file, Git, APK asset or chat.

## Set up the ESP32 Wi-Fi

1. With pump power disconnected, upload `firmware/AutomatedIoTIndoorPlantMonitoringSystem` using ESP32-S3, 16 MB flash, octal PSRAM and USB CDC on boot. The serial startup marker is **v7: online plant connection**. Relay GPIOs remain 7/40/39; sensors remain 15/16/17.
2. In Sprout, open connection settings and **Plant Wi-Fi setup**. While the phone has Internet, tap **Load plant pairing**. No secret is displayed.
3. Join the ESP32's PlantCare Wi-Fi once. Its password is printed in Serial Monitor at 115200 baud. Android may ask to stay connected without Internet.
4. Enter the router/hotspot's exact SSID and Wi-Fi password, then **Save Wi-Fi to plant system**. The app verifies the device ID before sending credentials over its WPA2-protected setup network. Credentials and the device token are saved in ESP32 NVS and not printed.
5. Return the phone to normal Wi-Fi or mobile data and tap **Connect**. Serial Monitor should report **Internet Wi-Fi connected**, **clock ready**, then **ONLINE: Sprout can reach this device through Render**.

Daily use does not require joining PlantCare or keeping the laptop/USB connected. The PlantCare network remains available for changing the saved Wi-Fi later. Local API access is restricted to that setup interface, even while the ESP32 also uses a router.

## Readings and controls

- The ESP32 periodically uploads all three real sensor readings and controller state over certificate-verified HTTPS. TLS/DNS cannot block the independent pump control task.
- The backend includes upload and transit age in freshness checks. Stale or missing device data displays offline rather than becoming a new live reading.
- An app command succeeds only after the ESP32 acknowledges it. A device acknowledgement confirms handling by firmware, not measured pump flow: the system has no flow sensor.
- Starts are not retried after a lost reply. Commands have short expiries and are bound to the current boot. Expired, duplicated and old-boot commands cannot start a pump after reconnection.
- Water Off has a separate Android request executor and cancels unconfirmed commands for the selected plant. Stop is processed before starts in the same device sync. Internet control has network latency; it is not an emergency hardware disconnect.
- Manual On/Off retains its local ten-second contact lease, renewed by the foreground app, with no manual cooldown. A lost app/server connection stops renewal; firmware switches the pump off when the lease expires. It never resumes by itself.
- Daily schedules are saved on the ESP32, use AM/PM in Sprout and support 1–20 seconds. After clock synchronization, they can run without the phone or cloud. Valid sensor calibration, dry-soil checks and watering limits still apply. A power loss requires time synchronization again.
- AI reviews remain proposals. Only a foreground user approval can request bounded AI watering. Fertilizer and light recommendations are user reminders. Notifications/background reviews never send pump commands.

The recorded DRY=4095 references remain display-only. Online communication does not repair the ADC range/calibration issue or enable moisture-based schedules by itself.

## Hosting and storage

Render's free service can sleep after 15 minutes of inactivity and take about one minute to wake. The device reconnects with bounded backoff. It uploads real sensor data for monitoring; there is no dummy keepalive service. Failures/restarts drop pending commands rather than replaying them. The phone stores care history; the ESP32 stores schedules/Wi-Fi; the cloud holds only recent telemetry and short-lived commands in memory. This is a single-owner, single-device prototype, not a multi-tenant user-account service or long-term cloud history database.

Sources: https://render.com/docs/free · https://docs.espressif.com/projects/arduino-esp32/en/latest/api/wifi.html · https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/api-reference/protocols/esp_http_client.html
