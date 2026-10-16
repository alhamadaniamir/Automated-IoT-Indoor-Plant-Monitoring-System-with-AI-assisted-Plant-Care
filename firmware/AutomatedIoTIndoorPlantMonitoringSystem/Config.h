#pragma once
#include <stdint.h>

constexpr uint8_t PLANT_COUNT = 3;
// Existing sketch wiring. ESP32-S3 ADC2 is shared with Wi-Fi; failed reads are
// reported, never treated as zero. ADC1 pins 4/5/6 are an option after rewiring.
constexpr uint8_t SENSOR_PINS[PLANT_COUNT] = {15, 16, 17};
// Confirm the exact module: GPIO35-37 can be reserved for octal flash/PSRAM.
constexpr uint8_t RELAY_PINS[PLANT_COUNT] = {37, 36, 35};
constexpr bool RELAYS_ACTIVE_LOW = true;
// Defaults allow sensor monitoring without configuring unknown relay pins.
constexpr bool RELAY_PINS_CONFIRMED = false;
constexpr bool WATERING_ENABLED = false;
struct Calibration { int dry; int wet; };
// Replace with actual per-sensor measurements. 0/0 means not calibrated.
constexpr Calibration CALIBRATION[PLANT_COUNT] = {{0,0}, {0,0}, {0,0}};
// Original dry threshold was 2600. Validate each channel for its sensor and pot.
constexpr int DRY_THRESHOLD[PLANT_COUNT] = {2600, 2600, 2600};
constexpr int WET_STOP_THRESHOLD[PLANT_COUNT] = {2400, 2400, 2400};
constexpr uint32_t SAMPLE_MS = 1000;
constexpr uint32_t MAX_PUMP_MS = 5000;
constexpr uint32_t COOLDOWN_MS = 60000;
// Initial commissioning budget; resetting the ESP32 replenishes it.
constexpr uint8_t MAX_CYCLES_PER_BOOT = 10;
