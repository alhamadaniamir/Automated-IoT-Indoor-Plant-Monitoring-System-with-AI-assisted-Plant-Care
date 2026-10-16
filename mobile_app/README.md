# Sprout mobile app

A simple Flutter interface for three ESP32-connected plants. The home screen shows connection, moisture, and watering status. Tap a plant to select its species, read its care guide, request watering, and save a daily schedule.

```bash
flutter pub get
flutter run
```

First upload the updated Arduino sketch and join the board's PlantCare Wi-Fi. Its name and password are printed at 115200 baud. The app reads `http://192.168.4.1/api/telemetry` every two seconds and sends explicit watering/settings requests. It never invents readings or retries a pump command automatically.

Watering controls remain disabled until the firmware is configured for verified relay pins and calibrated sensors. General care guides are included; live AI advice is not configured yet.

```bash
flutter analyze
flutter test
```
