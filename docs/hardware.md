# Hardware scope

## Selected components

- ESP32 is the proposed controller; confirm the exact board variant.
- Capacitive soil moisture sensor.
- Water pump or pumps.
- Power relay module.

Temperature/humidity sensing, light sensing, and reservoir-level sensing are optional additions. The current dashboard does not invent readings from those sensors.

## Details needed before firmware or wiring

Record the ESP32 board name, sensor model and output voltage, number of pots and pumps, pump voltage/current, relay module supply and trigger voltage, active-high/active-low behavior, and the plant species. Check that the relay interface is compatible with the board and the pump supply matches the pump load. Do not power a pump directly from a GPIO.

No pin assignment or wiring diagram is provided yet because those values depend on the actual components. Select an appropriate analog input for the exact ESP32 variant, accounting for Wi-Fi/ADC restrictions on that variant.

## Sensor calibration

Record raw sensor values in representative dry and wet conditions for the actual growing medium. Determine signal direction and valid range. Map those endpoints to a relative 0–100% display and clamp the result. Validate repeatability and disconnected/fault behavior; plausible voltage alone may not reliably detect a disconnected sensor. Plant thresholds must be selected and validated for the plant and medium.

## Watering implementation requirements

- Confirm relay polarity and keep the pump off during boot, reset, and sensor faults.
- Measure pump flow to select a short maximum runtime, cooldown, and watering budget.
- Use hysteresis to avoid switching repeatedly near a threshold.
- Stop watering independently of network requests and browser state.
- Verify actual pump behavior with the selected hardware before unattended use.
- Consider reservoir sensing if dry-run protection is required; moisture sensing alone cannot detect an empty reservoir.

These are implementation requirements. There is no pump-control firmware in this initial repository.
