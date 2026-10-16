# Phone and Arduino connection

## Initial setup

1. Open `firmware/AutomatedIoTIndoorPlantMonitoringSystem/AutomatedIoTIndoorPlantMonitoringSystem.ino` in Arduino IDE. The updated sketch is also copied to the original Arduino sketchbook folder, with a backup of the previous `.ino`.
2. Read `Config.h`. Confirm the exact ESP32-S3 module before touching relay pins. Keep pump power disconnected for the first monitoring test. Default relay pins are not configured or driven.
3. Select the actual S3 board/port and upload. No flashing is performed automatically by this repository.
4. Open Serial Monitor at **115200 baud**. It prints a `PlantCare-...` network name, a unique 16-character Wi-Fi password, and `192.168.4.1`.
5. Join that Wi-Fi on the phone. Select **stay connected** if Android reports no internet. This first connection is directly to the board, not through your router.
6. Run the Flutter app and tap **Connect**. Three channels appear as Pothos, snake plant, and peace lily. Tap any card to change its plant, view care needs, water it, or set a schedule.

## Calibrate before watering

The original GPIOs are sensors 15/16/17 and relays 37/36/35. ESP32-S3 ADC2 is shared with Wi-Fi, and GPIO35–37 can be used for module memory. These are board-dependent constraints, not verified wiring. Failed ADC conversions are reported as faults rather than zero readings.

Watch each raw value under **Sensor details** or in Serial Monitor. Enter measured dry/wet values in `CALIBRATION` in `Config.h`; raw dry readings must be larger than raw wet readings. Select and validate each channel's dry/start and wet/stop thresholds for its sensor, soil, and plant. No universal percentage or fixed calendar interval can be inferred from the species name alone.

Verify relay pin availability, active-low polarity, pump supply, and measured flow. Only then set `RELAY_PINS_CONFIRMED` and `WATERING_ENABLED` to `true`, and re-upload. The app will enable watering when the board reports readiness. Manual watering can still be rejected when soil is already wet, the sensor is faulted, a pump is active, cooldown has not elapsed, or its commissioning budget is exhausted.

## Plant controls

- **Choose your plant:** select Pothos, snake plant, or peace lily for each channel.
- **What this plant needs:** a sourced general care guide. It is not an AI response.
- **Water now:** sends one request for 1–5 seconds. The ESP32 rechecks conditions and stops locally. A successful response means accepted, not measured water delivery.
- **Daily watering:** choose a local time and duration, then **Save settings**. It is a daily soil check with conditional watering: wet/faulted/unready channels are skipped. Save settings also stores the selected plant and duration on the board.

Schedules and plant selections survive power cycles. The phone supplies its current clock and timezone offset on connection after each ESP32 restart. Until then schedules pause. Once synchronized, the device keeps time and runs schedules without the app open, while powered. Missed times are skipped rather than caught up. A daily attempt is stored before queuing, preventing repeated watering in the same minute after a restart. Clock/timezone changes require reconnecting or restarting and reconnecting. The commissioning pump budget resets on reboot; this is not a production watering-volume budget.

## API

All routes are on `http://192.168.4.1`. This is a local prototype protected by the board's per-device WPA2 Wi-Fi password. Do not expose it through router port forwarding. No backend credentials or AI keys are sent to the board.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/telemetry` | Three sensor readings, commanded pump states, profiles, and schedules |
| POST | `/api/time` | Phone clock (`epoch`, `offset` minutes) |
| POST | `/api/plant` | `plant`, `species`, `schedule`, `hour`, `minute`, `seconds` |
| POST | `/api/water` | One bounded request (`plant`, `seconds`) |

POST fields are form encoded with `X-PlantCare-Client: mobile-v1`. This header prevents ordinary cross-origin browser forms; it is not an authentication secret. There is no permissive CORS or redirect following. Add proper authenticated HTTPS APIs before any Internet-facing deployment.

Telemetry uses uptime-based freshness and boot/sequence identifiers, not invented wall-clock timestamps. [Local schema](../contracts/local-device.schema.json) and [example](../examples/local-device.json) are separate from the future cloud telemetry contract. Pump states are commanded relay states; unconfigured outputs are `null`. Moisture percentages are `null` until calibrated or when readings fault. ADC rail checks cannot detect every disconnected sensor; calibration and fault testing remain physical validation work.

## Care guide sources

- [Pothos — UC Agriculture and Natural Resources](https://ucanr.edu/sites/default/files/2015-02/207723.pdf): indirect light and moderate drying between waterings.
- [Snake plant — NC State Extension](https://plants.ces.ncsu.edu/plants/dracaena-trifasciata/): allow drying and avoid excessive water.
- [Peace lily — NC State Extension](https://plants.ces.ncsu.edu/plants/spathiphyllum/): moist, well-drained soil without sogginess.
- [ESP32-S3 ADC limitations](https://docs.espressif.com/projects/esp-idf/en/v5.5/esp32s3/api-reference/peripherals/adc_oneshot.html)
- [ESP32-S3 module pin restrictions](https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32s3/esp32-s3-devkitc-1/user_guide_v1.1.html)

AI-assisted care still requires a backend/provider connection and evaluation. Future advice should combine species, calibrated readings, and history, and propose changes for the user to review rather than directly switch pumps.
