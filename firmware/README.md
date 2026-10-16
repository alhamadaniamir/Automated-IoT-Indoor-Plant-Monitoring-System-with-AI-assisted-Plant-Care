# ESP32-S3 Arduino firmware

Open `AutomatedIoTIndoorPlantMonitoringSystem/AutomatedIoTIndoorPlantMonitoringSystem.ino` in Arduino IDE. This is the Wi-Fi integration of the existing three-sensor/three-pump sketch from the Arduino sketchbook. It uses the ESP32 Arduino core's built-in WiFi, WebServer, Preferences, ADC, and FreeRTOS support; no external Arduino library is needed.

Read `Config.h` before uploading. Original sensor GPIO15/16/17 and relay GPIO37/36/35 are retained as configuration, not verified wiring. GPIO15–17 are ADC2 channels shared with Wi-Fi; conversion timeouts are reported as faults. Consider ADC1 GPIO4/5/6 if your board and wiring permit. Some ESP32-S3 modules reserve GPIO35–37 for octal flash/PSRAM: confirm your exact board before enabling those outputs.

`RELAY_PINS_CONFIRMED=false` leaves relay GPIOs unconfigured. `WATERING_ENABLED=false` blocks watering. Disconnect pump power during initial monitoring tests. After verifying pins and relay polarity, enter each sensor's measured dry/wet endpoints and thresholds, validate the pump's measured flow and runtime, then enable watering deliberately.

Pump timing and sensor checks run in their own control task, independently of HTTP requests. Every manual/scheduled request is bounded by duration (1–5 seconds), wet-soil checks, faults, a 60-second cooldown, and a 10-cycle commissioning budget per boot. The defaults are commissioning limits, not universal plant-care recommendations. Raw sensors do not detect every possible disconnection, and relay state does not prove that water is flowing.

See [device connection](../docs/device-connection.md) for the phone setup and schedule rules.

Compile with the ESP32-S3 board package matching your board. For a generic S3 syntax/build check:

```bash
arduino-cli compile --fqbn esp32:esp32:esp32s3 firmware/AutomatedIoTIndoorPlantMonitoringSystem
```

Portable controller test (from repository root):

```bash
g++ -std=c++17 -Wall -Wextra -Werror firmware/tests/controller_test.cpp -o /tmp/plant-controller-test
/tmp/plant-controller-test
```
