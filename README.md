# Automated IoT Indoor Plant Monitoring System

Flutter mobile app + ESP32-S3 for three plants: **Pothos, snake plant, and peace lily**. Each channel has a soil sensor and pump relay.

## Current implementation

- Simple home screen with three plant cards and connection status.
- Plant selection, basic care guide, manual Water now requests, and daily schedule settings.
- Direct connection to the ESP32's password-protected PlantCare Wi-Fi; no cloud account required.
- Three-channel raw telemetry, calibrated percentages when configured, and explicit stale/fault states.
- Local firmware runtime limits, cooldown, per-boot watering budget, and soil checks.
- Saved profiles and schedules on the ESP32. After a restart, the phone must reconnect to set its clock before schedules resume.

The app and sketch can be compiled and tested without a board. Physical wiring, calibration, relay polarity, pump flow, and phone-to-board communication still require testing on your actual hardware. The sketch defaults to monitoring mode with unknown relay GPIOs unconfigured. **AI-generated recommendations are not integrated yet**; the app labels its sourced plant information as a general care guide.

## Run on your phone

```bash
cd ~/automated-iot-indoor-plant-monitoring-system/mobile_app
flutter pub get
flutter devices
flutter run -d YOUR_PHONE_ID
```

Upload `firmware/AutomatedIoTIndoorPlantMonitoringSystem/AutomatedIoTIndoorPlantMonitoringSystem.ino` using Arduino IDE. Open Serial Monitor at **115200 baud**, join the displayed PlantCare network on your phone, and tap **Connect**. Choose to stay connected when Android reports no internet.

See [connection and setup](docs/device-connection.md) for the full steps, calibration, and schedule behavior.

## Repository

```text
mobile_app/        Flutter app, device client, and tests
firmware/         Arduino sketch, configuration, and controller test
contracts/        Local device protocol and future cloud telemetry schema
examples/         Example payloads
backend/          Future backend and AI plan
dist/             Earlier browser prototype retained for reference
```

The local device API is read/write HTTP only on the ESP32's private Wi-Fi. Its network password is generated per device and stored on the board; it is not embedded in the app. Android permits cleartext access only to the device address `192.168.4.1`. Cloud authentication, remote access, database history, and AI remain future stages. Keep future AI provider keys on a backend, outside the mobile app.

[Architecture](docs/architecture.md) · [Hardware](docs/hardware.md) · [Roadmap](docs/roadmap.md)
