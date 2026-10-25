#pragma once
#include <stdint.h>
#include "RelayOutputs.h"

constexpr uint8_t PLANT_COUNT = 3;
// Keep the requested sensor AO wiring on ADC2 GPIO15/16/17. ADC2 is shared
// with Wi-Fi; checked oneshot conversion failures remain explicit faults.
// Confirmed module: ESP32-S3 N16R8 (16 MB flash, 8 MB octal PSRAM).
// Relay IN1/IN2/IN3 -> GPIO7/40/39. GPIO35/36/37 are connected to
// internal octal PSRAM on this module and cannot control relays.
constexpr uint8_t SENSOR_PINS[PLANT_COUNT] = {15, 16, 17};
constexpr uint8_t RELAY_PINS[PLANT_COUNT] = {7, 40, 39};
static_assert(validPlantPinMap(SENSOR_PINS, RELAY_PINS),
              "Use separate analog sensor pins and relay GPIOs without flash/PSRAM, USB, UART or boot-strap conflicts.");
// Retains the original LOW-trigger assumption. Verify the actual relay module
// with pump power disconnected: LOW-trigger needs HIGH for OFF, HIGH-trigger
// needs LOW for OFF. Change this flag to false for a HIGH-trigger module.
constexpr bool RELAYS_ACTIVE_LOW = true;
// Both flags block watering requests; they do NOT disable the OFF output hold.
// Set true only after checking wiring, relay polarity, reset-time OFF and pump flow.
// Manual timed watering does not require a sensor. Schedules require calibration.
// Requested right-side relay inputs: IN2 -> GPIO40, IN3 -> GPIO39.
// Verify OFF behavior on the new pins with pump power disconnected.
// Requests are permitted; this does not start any pump at boot.
constexpr bool RELAY_PINS_CONFIRMED = true;
constexpr bool WATERING_ENABLED = true;
struct Calibration { int dry; int wet; };
// Recorded 2026-10-22, order {dry, wet}; wet values are rounded 13-sample means.
// Saved dry=4095 references are accepted for Serial Monitor soil labels.
// At that ceiling, the display says DRY (ADC LIMIT) and keeps fault=2 visible.
// calibrated() still requires dry < 4095 for API percentages and schedules;
// accepting the reference for display does not arm automatic watering.
// See docs/sensor-calibration-2026-10-22.md for readings and raw differences.
constexpr Calibration CALIBRATION[PLANT_COUNT] = {
  {4095, 2250}, // Plant 1, GPIO15: difference 1845 ADC counts.
  {4095, 2208}, // Plant 2, GPIO16: difference 1887 ADC counts.
  {4095, 2243}, // Plant 3, GPIO17: difference 1852 ADC counts.
};
// Original dry threshold was 2600. Validate each channel for its sensor and pot.
constexpr int DRY_THRESHOLD[PLANT_COUNT] = {2600, 2600, 2600};
constexpr int WET_STOP_THRESHOLD[PLANT_COUNT] = {2400, 2400, 2400};
constexpr uint32_t SAMPLE_MS = 1000;
constexpr uint8_t MAX_SCHEDULE_SECONDS = 20;
constexpr uint32_t MAX_PUMP_MS = MAX_SCHEDULE_SECONDS * 1000UL;
// Renewed by the app while manual ON is active; contact loss stops the pump.
constexpr uint32_t MANUAL_LEASE_MS = 10000;
constexpr uint32_t COOLDOWN_MS = 60000;
// Initial commissioning budget; resetting the ESP32 replenishes it.
constexpr uint8_t MAX_CYCLES_PER_BOOT = 10;
