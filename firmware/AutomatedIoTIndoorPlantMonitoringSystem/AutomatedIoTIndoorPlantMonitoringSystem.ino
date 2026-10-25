/* Three-plant Wi-Fi system: sensors GPIO15/16/17, relays GPIO7/40/39.
 * REWIRE with power disconnected before uploading. Read Config.h first.
 * Relay OFF latches are initialized even while watering requests are disabled.
 */
#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <Preferences.h>
#include <esp_random.h>
#include <esp_system.h>
#include <esp_adc/adc_oneshot.h>
#include <driver/gpio.h>
#include <sys/time.h>
#include <time.h>
#include <errno.h>
#include "Config.h"
#include "RelayGpio.h"
#include "WateringController.h"
#include "PumpRequest.h"
#if !defined(CONFIG_IDF_TARGET_ESP32S3)
#error "Select your ESP32-S3 board: this sketch retains the existing S3 wiring."
#endif

WebServer server(80);
Preferences preferences;
adc_oneshot_unit_handle_t adcHandles[2] = {};
adc_unit_t units[PLANT_COUNT];
adc_channel_t channels[PLANT_COUNT];
bool adcReady[PLANT_COUNT] = {};
const char *SPECIES[] = {"chinese_bamboo", "pandakaki", "calathea"};
String approvedIds[PLANT_COUNT];
struct Profile {
  uint8_t species = 0, hour = 8, minute = 0, seconds = 3;
  bool schedule = false;
  int32_t lastDay = -1;
};
Profile profiles[PLANT_COUNT]; // Only the HTTP/main task accesses profiles/NVS.
struct Channel {
  int raw = -1;
  uint8_t fault = 1, cycles = 0;
  bool running = false;
  uint32_t cooldown = 0, manualRevision = 0;
};
struct Telemetry {
  Channel plants[PLANT_COUNT];
  uint32_t sampledAt = 0, sequence = 0, controlledAt = 0, controlSequence = 0;
} sharedState;
struct SensorSample { int raw = -1; uint8_t fault = 1; };
struct SensorFrame { SensorSample plants[PLANT_COUNT]; uint32_t sampledAt = 0, sequence = 0; } sensorFrame;
PumpRequest requests[PLANT_COUNT];
portMUX_TYPE stateMux = portMUX_INITIALIZER_UNLOCKED;
bool clockSynced = false, ready = false, relayOutputsReady = false;
int timezoneOffset = 0;
String deviceId, bootId;
const char *startupStage = "starting serial";

// UART0 stays visible through a USB-to-serial adapter even when Serial maps
// to native USB CDC. With CDC enabled, mirror diagnostics to both connectors.
void diagnostic(const String &message) {
  Serial0.println(message);
#if ARDUINO_USB_CDC_ON_BOOT
  Serial.println(message);
#endif
}
void startup(const char *stage) {
  startupStage = stage;
  diagnostic(String("[PlantCare] ") + stage);
}

bool outputsEnabled() { return relayOutputsReady && RELAY_PINS_CONFIRMED && WATERING_ENABLED; }
// Saved endpoints may include the ADC ceiling for reference-based labels.
// Automatic watering and API percentages retain calibrated()'s stricter check.
bool displayReferencesValid(uint8_t i) {
  const auto &c = CALIBRATION[i];
  return c.wet > 0 && c.dry <= 4095 && c.dry > c.wet;
}
bool calibrated(uint8_t i) {
  const auto &c = CALIBRATION[i];
  return c.wet > 0 && c.dry < 4095 && c.dry > c.wet;
}
bool thresholdsValid(uint8_t i) {
  return calibrated(i) && CALIBRATION[i].wet < WET_STOP_THRESHOLD[i] &&
    WET_STOP_THRESHOLD[i] < DRY_THRESHOLD[i] && DRY_THRESHOLD[i] < CALIBRATION[i].dry;
}
// Display only: accept the saved dry=4095 reference while keeping its warning.
// ADC/read faults continue to block automatic watering in the control task.
const char *soilStatus(uint8_t i, const Channel &plant) {
  if (plant.fault == 3) return "STALE READING";
  if ((plant.fault && plant.fault != 2) || plant.raw < 0) return "SENSOR ERROR";
  if (plant.raw <= 0 || plant.raw > 4095) return "SENSOR LIMIT";
  if (!displayReferencesValid(i)) return "CALIBRATION NEEDED";
  const auto &c = CALIBRATION[i];
  if (plant.raw == 4095 && c.dry == 4095) return "DRY (ADC LIMIT)";
  // A mixed batch containing a rail sample is not a stable dry endpoint.
  if (plant.fault == 2 || plant.raw == 4095) return "SENSOR LIMIT";
  if (!(c.wet < WET_STOP_THRESHOLD[i] &&
        WET_STOP_THRESHOLD[i] < DRY_THRESHOLD[i] && DRY_THRESHOLD[i] < c.dry))
    return "THRESHOLDS NEEDED";
  if (plant.raw > DRY_THRESHOLD[i]) return "DRY";
  if (plant.raw <= WET_STOP_THRESHOLD[i]) return "WET";
  return "MOIST";
}
// Caller holds stateMux: the HTTP Stop handler and control-task writes cannot race.
bool setPumpLocked(uint8_t i, bool requestedOn) {
  const bool on = outputsEnabled() && requests[i].allowsOutput(requestedOn);
  if (!relayOutputsReady) return false;
  gpio_set_level(static_cast<gpio_num_t>(RELAY_PINS[i]), relayLevel(on, RELAYS_ACTIVE_LOW));
  return on;
}

const char *resetDescription() {
  switch (esp_reset_reason()) {
    case ESP_RST_POWERON: return "power on";
    case ESP_RST_BROWNOUT: return "BROWNOUT: check the power supply and pump load";
    case ESP_RST_PANIC: return "PANIC: inspect the reset/backtrace log";
    case ESP_RST_INT_WDT: case ESP_RST_TASK_WDT: case ESP_RST_WDT: return "WATCHDOG: inspect the reset log";
    case ESP_RST_SW: return "software reset";
    default: return "other/external reset";
  }
}
Telemetry snapshot() {
  portENTER_CRITICAL(&stateMux);
  Telemetry copy = sharedState;
  for (uint8_t i = 0; i < PLANT_COUNT; i++) {
    if (requests[i].stopPending()) copy.plants[i].running = false;
    copy.plants[i].manualRevision = requests[i].stopRevision;
  }
  portEXIT_CRITICAL(&stateMux); return copy;
}
void setupAdc() {
  for (uint8_t i = 0; i < PLANT_COUNT; i++) {
    if (adc_oneshot_io_to_channel(SENSOR_PINS[i], &units[i], &channels[i]) != ESP_OK) continue;
    if (!adcHandles[units[i]]) {
      adc_oneshot_unit_init_cfg_t init = {}; init.unit_id = units[i]; init.ulp_mode = ADC_ULP_MODE_DISABLE;
      if (adc_oneshot_new_unit(&init, &adcHandles[units[i]]) != ESP_OK) continue;
    }
    adc_oneshot_chan_cfg_t config = {}; config.atten = ADC_ATTEN_DB_12; config.bitwidth = ADC_BITWIDTH_12;
    adcReady[i] = adc_oneshot_config_channel(adcHandles[units[i]], channels[i], &config) == ESP_OK;
  }
}
SensorSample readSensor(uint8_t i) {
  SensorSample result;
  if (!adcReady[i]) return result;
  int sum = 0; bool rail = false;
  for (uint8_t n = 0; n < 8; n++) {
    int raw;
    if (adc_oneshot_read(adcHandles[units[i]], channels[i], &raw) != ESP_OK) return result;
    sum += raw; rail = rail || raw <= 0 || raw >= 4095;
  }
  result.raw = sum / 8; result.fault = rail ? 2 : 0; return result;
}
// ADC work never runs inside the pump timer task.
void sensorTask(void *) {
  SensorFrame frame;
  for (;;) {
    for (uint8_t i = 0; i < PLANT_COUNT; i++) frame.plants[i] = readSensor(i);
    frame.sampledAt = millis(); frame.sequence++;
    portENTER_CRITICAL(&stateMux); sensorFrame = frame; portEXIT_CRITICAL(&stateMux);
    vTaskDelay(pdMS_TO_TICKS(SAMPLE_MS));
  }
}
void controlTask(void *) {
  WateringState pumps[PLANT_COUNT]; Telemetry state;
  TickType_t wake = xTaskGetTickCount();
  for (;;) {
    SensorFrame frame;
    portENTER_CRITICAL(&stateMux); frame = sensorFrame; portEXIT_CRITICAL(&stateMux);
    const uint32_t now = millis();
    const bool fresh = frame.sequence != 0 && uint32_t(now - frame.sampledAt) <= 2000;
    state.sequence = frame.sequence; state.sampledAt = frame.sampledAt;
    state.controlledAt = now; state.controlSequence++;
    for (uint8_t i = 0; i < PLANT_COUNT; i++) {
      PumpRequest request;
      portENTER_CRITICAL(&stateMux); request = requests[i].take(); portEXIT_CRITICAL(&stateMux);
      auto &plant = state.plants[i];
      plant.raw = frame.plants[i].raw;
      plant.fault = fresh ? frame.plants[i].fault : 3;
      const bool enabled = outputsEnabled();
      const bool valid = thresholdsValid(i) && plant.fault == 0;
      if (request.manualLeaseActive) renewManualWatering(pumps[i], request.renewedAt);
      updateWatering(pumps[i], now, valid, enabled, plant.raw <= WET_STOP_THRESHOLD[i]);
      if (request.stopPending()) {
        cancelWatering(pumps[i], now);
      } else if (request.pending && enabled &&
                 ((request.mode == WateringMode::Manual && request.manualLeaseActive &&
                   uint32_t(now - request.renewedAt) < MANUAL_LEASE_MS) ||
                  ((request.mode == WateringMode::Scheduled ||
                    (request.mode == WateringMode::Approved && request.approvalFresh(now))) &&
                   valid && plant.raw > DRY_THRESHOLD[i]))) {
        startWatering(pumps[i], now, request.durationMs, MAX_PUMP_MS, COOLDOWN_MS, MAX_CYCLES_PER_BOOT, request.mode);
        if (request.manualLeaseActive) renewManualWatering(pumps[i], request.renewedAt);
      }
      plant.cycles = pumps[i].cycles;
      plant.cooldown = wateringWaitMs(pumps[i], now, COOLDOWN_MS);
      portENTER_CRITICAL(&stateMux);
      if (request.stopPending()) requests[i].acknowledgeStop(request.stopRevision);
      // An expired/failed manual run invalidates its token; renewals cannot restart it.
      if (!pumps[i].running && request.manualLeaseActive && !requests[i].stopPending()) {
        requests[i].queueStop();
        requests[i].acknowledgeStop(requests[i].stopRevision);
      }
      plant.running = setPumpLocked(i, pumps[i].running);
      sharedState.plants[i] = plant;
      portEXIT_CRITICAL(&stateMux);
    }
    portENTER_CRITICAL(&stateMux);
    sharedState.sampledAt = state.sampledAt; sharedState.sequence = state.sequence;
    sharedState.controlledAt = state.controlledAt; sharedState.controlSequence = state.controlSequence;
    portEXIT_CRITICAL(&stateMux);
    vTaskDelayUntil(&wake, pdMS_TO_TICKS(20));
  }
}

void replyError(int code, const char *message) {
  server.sendHeader("Cache-Control", "no-store");
  server.send(code, "application/json", String("{\"error\":\"") + message + "\"}");
}
void replyOk() { server.send(200, "application/json", "{\"ok\":true}"); }
bool clientAllowed() {
  if (server.header("X-PlantCare-Client") != "mobile-v1") { replyError(403, "Use the paired PlantCare mobile app."); return false; }
  return true; // Local AP only, protected by the per-device WPA2 password.
}
bool numberArg(const char *name, long min, long max, long &out) {
  if (!server.hasArg(name)) return false;
  const String text = server.arg(name); if (text.isEmpty()) return false;
  char *end; errno = 0; const long value = strtol(text.c_str(), &end, 10);
  if (errno || *end || value < min || value > max) return false;
  out = value; return true;
}
bool plantArg(uint8_t &i) {
  long number; if (!numberArg("plant", 1, PLANT_COUNT, number)) { replyError(400, "Choose a valid plant."); return false; }
  i = number - 1; return true;
}
bool queueScheduledWater(uint8_t i, uint8_t seconds) {
  const Telemetry state = snapshot(); const auto &plant = state.plants[i];
  if (!outputsEnabled() || state.controlSequence == 0 || uint32_t(millis() - state.controlledAt) > 1000 ||
      !thresholdsValid(i) || plant.fault || state.sequence == 0 ||
      uint32_t(millis() - state.sampledAt) > 2000 || plant.raw <= DRY_THRESHOLD[i] ||
      plant.running || plant.cooldown || plant.cycles >= MAX_CYCLES_PER_BOOT ||
      seconds == 0 || seconds > MAX_SCHEDULE_SECONDS) return false;
  portENTER_CRITICAL(&stateMux);
  const bool accepted = requests[i].queueStart(seconds * 1000UL, WateringMode::Scheduled);
  portEXIT_CRITICAL(&stateMux);
  return accepted;
}
String manualToken(uint32_t revision) { return bootId + "-" + String(revision); }
bool manualRevisionArg(uint8_t i, uint32_t &revision) {
  revision = snapshot().plants[i].manualRevision;
  if (server.arg("token") != manualToken(revision)) {
    replyError(409, "Pump state changed. Refresh before turning it on again."); return false;
  }
  return true;
}
void handleManual() {
  if (!clientAllowed()) return;
  uint8_t i; if (!plantArg(i)) return;
  uint32_t revision; if (!manualRevisionArg(i, revision)) return;
  const Telemetry state = snapshot();
  if (!outputsEnabled() || state.controlSequence == 0 ||
      uint32_t(millis() - state.controlledAt) > 1000 || state.plants[i].running) {
    replyError(409, "Check the live connection and pump status before turning it on."); return;
  }
  portENTER_CRITICAL(&stateMux);
  const bool accepted = requests[i].queueManual(millis(), MANUAL_LEASE_MS, revision);
  portEXIT_CRITICAL(&stateMux);
  if (!accepted) { replyError(409, "Pump state changed. Refresh and try again."); return; }
  replyOk();
}
void handleManualRenew() {
  if (!clientAllowed()) return;
  uint8_t i; if (!plantArg(i)) return;
  uint32_t revision; if (!manualRevisionArg(i, revision)) return;
  portENTER_CRITICAL(&stateMux);
  const bool accepted = requests[i].renewManual(millis(), MANUAL_LEASE_MS, revision);
  portEXIT_CRITICAL(&stateMux);
  if (!accepted) { replyError(409, "Manual watering stopped. Press On to start a new run."); return; }
  replyOk();
}
void handleWater() {
  if (!clientAllowed()) return;
  replyError(409, "Update the Sprout app: manual watering now uses On and Off.");
}
void handleApprovedWater() {
  if (!clientAllowed()) return;
  uint8_t i; if (!plantArg(i)) return;
  uint32_t revision; if (!manualRevisionArg(i, revision)) return;
  long seconds, expires;
  if (!numberArg("seconds", 1, MAX_SCHEDULE_SECONDS, seconds) ||
      !numberArg("expires", 1735689600L, 2145916799L, expires)) {
    replyError(400, "Invalid approved watering duration or expiry."); return;
  }
  const String requestId = server.arg("request_id");
  if (requestId.length() < 8 || requestId.length() > 64) { replyError(400, "Invalid approval identifier."); return; }
  for (size_t n = 0; n < requestId.length(); n++) {
    const char c = requestId[n];
    if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_')) {
      replyError(400, "Invalid approval identifier."); return;
    }
  }
  const time_t currentTime = time(nullptr);
  if (!clockSynced || expires <= currentTime || expires - currentTime > 60) { replyError(409, "Approval expired or the device clock is not ready."); return; }
  if (approvedIds[i] == requestId) { replyError(409, "This approval has already been handled."); return; }
  const Telemetry state = snapshot(); const auto &plant = state.plants[i];
  if (!outputsEnabled() || state.controlSequence == 0 || uint32_t(millis() - state.controlledAt) > 1000 ||
      !thresholdsValid(i) || plant.fault || state.sequence == 0 || uint32_t(millis() - state.sampledAt) > 2000 ||
      plant.raw <= DRY_THRESHOLD[i] || plant.running || plant.cooldown || plant.cycles >= MAX_CYCLES_PER_BOOT) {
    replyError(409, "Approved watering paused: check live soil, calibration, pump status, and watering limits."); return;
  }
  portENTER_CRITICAL(&stateMux);
  const bool accepted = requests[i].queueApproved(seconds * 1000UL, millis(), uint32_t(expires - currentTime) * 1000UL, revision);
  portEXIT_CRITICAL(&stateMux);
  if (!accepted) { replyError(409, "Pump state changed. Request a new care review."); return; }
  approvedIds[i] = requestId;
  replyOk(); // Accepted once; local sensor, Stop, expiry and runtime guards remain authoritative.
}
void handleStop() {
  if (!clientAllowed()) return;
  uint8_t i; if (!plantArg(i)) return;
  // Stop takes priority over a queued start, regardless of calibration or faults.
  portENTER_CRITICAL(&stateMux);
  requests[i].queueStop();
  const bool offWritten = relayOutputsReady &&
    gpio_set_level(static_cast<gpio_num_t>(RELAY_PINS[i]), relayLevel(false, RELAYS_ACTIVE_LOW)) == ESP_OK;
  portEXIT_CRITICAL(&stateMux);
  if (!offWritten) { replyError(503, "Relay OFF command failed. Disconnect pump power."); return; }
  diagnostic(String("[PlantCare] Stop received: plant ") + String(i + 1) + " relay OFF commanded");
  replyOk(); // OFF commanded now; the latch prevents the task reasserting ON.
}
void handleTime() {
  if (!clientAllowed()) return;
  long epoch, offset;
  if (!numberArg("epoch", 1735689600L, 2145916799L, epoch) || !numberArg("offset", -720, 840, offset)) { replyError(400, "Invalid device clock."); return; }
  const timeval value = {epoch, 0};
  if (settimeofday(&value, nullptr) != 0) { replyError(500, "Could not set device time."); return; }
  timezoneOffset = offset; clockSynced = true; replyOk();
}
String key(const char *prefix, uint8_t i) { return String(prefix) + String(i); }
void handlePlant() {
  if (!clientAllowed()) return;
  uint8_t i; if (!plantArg(i)) return;
  long hour, minute, seconds;
  const String species = server.arg("species"), enabled = server.arg("schedule");
  int selected = -1; for (uint8_t n = 0; n < 3; n++) if (species == SPECIES[n]) selected = n;
  if (selected < 0 || (enabled != "true" && enabled != "false") ||
      !numberArg("hour", 0, 23, hour) || !numberArg("minute", 0, 59, minute) || !numberArg("seconds", 1, MAX_SCHEDULE_SECONDS, seconds)) { replyError(400, "Invalid plant settings."); return; }
  if (enabled == "true" && (!outputsEnabled() || !thresholdsValid(i))) { replyError(409, "Set up watering and calibration before enabling a schedule."); return; }
  auto &profile = profiles[i];
  // Disable before saving. A partial/failed write must not arm a new schedule.
  if (preferences.putBool(key("schedule", i).c_str(), false) != 1) { replyError(500, "Could not save plant settings."); return; }
  profile.schedule = false;
  bool saved = preferences.putUChar(key("species", i).c_str(), selected) == 1;
  saved = (preferences.putUChar(key("hour", i).c_str(), hour) == 1) && saved;
  saved = (preferences.putUChar(key("minute", i).c_str(), minute) == 1) && saved;
  saved = (preferences.putUChar(key("seconds", i).c_str(), seconds) == 1) && saved;
  if (!saved || preferences.putBool(key("schedule", i).c_str(), enabled == "true") != 1) { replyError(500, "Could not save plant settings. Schedule stays disabled."); return; }
  profile.species = selected; profile.schedule = enabled == "true"; profile.hour = hour; profile.minute = minute; profile.seconds = seconds;
  replyOk();
}
void checkSchedules() {
  if (!clockSynced) return;
  const time_t local = time(nullptr) + timezoneOffset * 60;
  tm clock; gmtime_r(&local, &clock); const int32_t day = local / 86400;
  for (uint8_t i = 0; i < PLANT_COUNT; i++) {
    auto &profile = profiles[i];
    if (!profile.schedule || profile.hour != clock.tm_hour || profile.minute != clock.tm_min || profile.lastDay >= day) continue;
    // Persist the daily attempt BEFORE queuing it: no repeated dose after reboot.
    if (preferences.putInt(key("day", i).c_str(), day) != sizeof(int32_t)) {
      diagnostic("Could not save daily watering marker; schedules paused."); clockSynced = false; return;
    }
    profile.lastDay = day;
    queueScheduledWater(i, profile.seconds); // Skip if wet/faulted/unready; no catch-up dose.
  }
}
void telemetry() {
  const Telemetry state = snapshot(); String json; json.reserve(2500);
  json = "{\"schema_version\":1,\"source\":\"device\",\"device_id\":\"" + deviceId + "\",\"boot_id\":\"" + bootId;
  json += "\",\"sample_sequence\":" + String(state.sequence) + ",\"sample_age_ms\":" + String(uint32_t(millis() - state.sampledAt));
  json += ",\"control_sequence\":" + String(state.controlSequence) + ",\"control_age_ms\":" + String(uint32_t(millis() - state.controlledAt));
  json += ",\"approved_watering\":true,\"plant_profile_version\":2";
  json += ",\"manual_on_off\":true,\"max_schedule_seconds\":" + String(MAX_SCHEDULE_SECONDS);
  json += ",\"clock_synced\":" + String(clockSynced ? "true" : "false");
  json += ",\"pump_outputs_enabled\":" + String(outputsEnabled() ? "true" : "false") + ",\"plants\":[";
  for (uint8_t i = 0; i < PLANT_COUNT; i++) {
    const auto &plant = state.plants[i]; const auto &profile = profiles[i]; if (i) json += ',';
    json += "{\"id\":" + String(i + 1) + ",\"species\":\"" + SPECIES[profile.species] + "\",\"sensor_pin\":" + String(SENSOR_PINS[i]) + ",\"relay_pin\":" + String(RELAY_PINS[i]);
    json += ",\"soil_raw\":" + (plant.raw < 0 ? String("null") : String(plant.raw));
    json += ",\"calibrated\":" + String(calibrated(i) ? "true" : "false") + ",\"soil_moisture_pct\":";
    if (!plant.fault && calibrated(i)) { const auto &c = CALIBRATION[i]; json += String(constrain(100.0f * (c.dry - plant.raw) / (c.dry - c.wet), 0.0f, 100.0f), 1); } else json += "null";
    json += ",\"pump_running\":"; json += outputsEnabled() ? (plant.running ? "true" : "false") : "null";
    json += ",\"manual_token\":\"" + manualToken(plant.manualRevision) + "\"";
    json += ",\"cooldown_remaining_ms\":" + String(plant.cooldown);
    json += ",\"schedule_enabled\":" + String(profile.schedule ? "true" : "false");
    json += ",\"schedule_hour\":" + String(profile.hour) + ",\"schedule_minute\":" + String(profile.minute) + ",\"watering_seconds\":" + String(profile.seconds);
    json += ",\"faults\":[";
    if (plant.fault) json += plant.fault == 1 ? "\"adc_read_failed\"" : plant.fault == 2 ? "\"adc_saturated\"" : "\"adc_stale\"";
    if (plant.cycles >= MAX_CYCLES_PER_BOOT) { if (plant.fault) json += ','; json += "\"watering_budget_exhausted\""; }
    json += "]}";
  }
  json += "]}"; server.sendHeader("Cache-Control", "no-store"); server.send(200, "application/json", json);
}
void setup() {
  // First setup action, before serial, delays, NVS, Wi-Fi, ADC or task creation.
  // This uses the NEW pin map. Hardware must hold relay inputs OFF during reset.
  RelayGpio relayGpio;
  relayOutputsReady = initializeRelaysOff(relayGpio, RELAY_PINS, RELAYS_ACTIVE_LOW);
  Serial0.begin(115200);
#if ARDUINO_USB_CDC_ON_BOOT
  Serial.begin(115200);
#endif
  // A bounded delay allows a monitor to attach; never wait for a USB host.
  delay(1200);
  startup("startup diagnostics v6: approval-gated care watering");
  diagnostic(String("Reset reason: ") + resetDescription());
  diagnostic(String("Relay GPIO setup: ") + (relayOutputsReady ? "GPIO routing configured; OFF levels held (verify trigger polarity)" : "FAILED: pump power must remain disconnected"));
  for (uint8_t i = 0; i < PLANT_COUNT; i++) {
    diagnostic(String("Plant ") + String(i+1) + " sensor GPIO" + String(SENSOR_PINS[i]) + " / relay GPIO" + String(RELAY_PINS[i]));
  }
  deviceId = "plantcare-" + String(uint32_t(ESP.getEfuseMac() & 0xFFFFFF), HEX); bootId = String(esp_random(), HEX);
  startup("loading saved plant settings");
  if (!preferences.begin("plantcare", false)) { startup("ERROR: cannot load plant settings"); return; }
  if (preferences.getUChar("profile-ver", 0) != 2) {
    for (uint8_t i = 0; i < PLANT_COUNT; i++) {
      if (preferences.putBool(key("schedule", i).c_str(), false) != 1 || preferences.putUChar(key("species", i).c_str(), i) != 1) {
        startup("ERROR: could not migrate plant profiles; pumps remain OFF"); return;
      }
    }
    if (preferences.putUChar("profile-ver", 2) != 1) { startup("ERROR: could not save plant profile version"); return; }
    diagnostic("Plant types updated: Chinese bamboo, Pandakaki, Calathea. Review and save schedules again before enabling them.");
  }
  for (uint8_t i = 0; i < PLANT_COUNT; i++) {
    auto &p = profiles[i];
    p.species = preferences.getUChar(key("species", i).c_str(), i); if (p.species > 2) p.species = i;
    p.schedule = preferences.getBool(key("schedule", i).c_str(), false);
    p.hour = preferences.getUChar(key("hour", i).c_str(), 8); if (p.hour > 23) p.hour = 8;
    p.minute = preferences.getUChar(key("minute", i).c_str(), 0); if (p.minute > 59) p.minute = 0;
    p.seconds = preferences.getUChar(key("seconds", i).c_str(), 3); if (p.seconds < 1 || p.seconds > MAX_SCHEDULE_SECONDS) p.seconds = 3;
    p.lastDay = preferences.getInt(key("day", i).c_str(), -1);
  }
  startup("starting Wi-Fi access point");
  if (!WiFi.mode(WIFI_AP)) { startup("ERROR: could not enable Wi-Fi AP mode"); return; }
  String password = preferences.getString("wifi-pass", "");
  if (password.length() != 16) { char generated[17]; snprintf(generated, sizeof(generated), "%08lx%08lx", (unsigned long)esp_random(), (unsigned long)esp_random()); password = generated; preferences.putString("wifi-pass", password); }
  const String ssid = "PlantCare-" + String(uint32_t(ESP.getEfuseMac() & 0xFFFFFF), HEX);
  const IPAddress address(192,168,4,1);
  if (!WiFi.softAPConfig(address, address, IPAddress(255,255,255,0)) || !WiFi.softAP(ssid.c_str(), password.c_str())) { startup("ERROR: could not start PlantCare Wi-Fi"); return; }
  // Print credentials before ADC/task setup so later failures cannot hide them.
  diagnostic("=== Connect your Flutter app ===");
  diagnostic(String("Wi-Fi: ") + ssid);
  diagnostic(String("Password: ") + password);
  diagnostic("Address: 192.168.4.1");
  diagnostic("Join this Wi-Fi on your phone, then tap Connect once startup is complete.");
  startup("setting up moisture sensors");
  for (uint8_t i = 0; i < PLANT_COUNT; i++) {
    diagnostic(String("[PlantCare] Relay ") + String(i + 1) + " GPIO" + String(RELAY_PINS[i]) +
               " OFF command=" + String(relayLevel(false, RELAYS_ACTIVE_LOW)) +
               " pin_level=" + String(relayGpio.read(RELAY_PINS[i])));
  }
  setupAdc();
  startup("starting plant controller task");
#if CONFIG_FREERTOS_UNICORE
  const BaseType_t pumpCore = 0;
#else
  const BaseType_t pumpCore = 1;
#endif
  if (xTaskCreatePinnedToCore(controlTask, "plant-control", 4096, nullptr, 3, nullptr, pumpCore) != pdPASS) { startup("ERROR: controller task failed"); return; }
  if (xTaskCreatePinnedToCore(sensorTask, "soil-sensors", 4096, nullptr, 1, nullptr, 0) != pdPASS) { startup("ERROR: sensor task failed"); return; }
  startup("starting HTTP API");
  const char *headers[] = {"X-PlantCare-Client"}; server.collectHeaders(headers, 1);
  server.on("/api/telemetry", HTTP_GET, telemetry); server.on("/api/time", HTTP_POST, handleTime);
  server.on("/api/plant", HTTP_POST, handlePlant); server.on("/api/water", HTTP_POST, handleWater);
  server.on("/api/stop", HTTP_POST, handleStop);
  server.on("/api/manual", HTTP_POST, handleManual);
  server.on("/api/manual/renew", HTTP_POST, handleManualRenew);
  server.on("/api/approved-water", HTTP_POST, handleApprovedWater);
  server.onNotFound([]() { replyError(404, "Unknown plant-device endpoint."); }); server.begin(); ready = true;
  startup("READY: phone API is running");
  if (outputsEnabled()) diagnostic("Watering enabled: manual On/Off with no cooldown; schedules support 1-20 seconds and require calibrated soil readings.");
  if (!outputsEnabled()) diagnostic("MONITOR ONLY: watering requests disabled; relay OFF levels held when GPIO setup succeeds. Verify wiring and polarity with pump power disconnected.");
}
void loop() {
  if (!ready) {
    static uint32_t lastDiagnostic = 0;
    if (uint32_t(millis() - lastDiagnostic) >= 3000) {
      lastDiagnostic = millis();
      diagnostic(String("[PlantCare] startup incomplete: ") + startupStage);
    }
    delay(100); return;
  }
  server.handleClient(); checkSchedules();
  static bool lastRunning[PLANT_COUNT] = {};
  const Telemetry state = snapshot();
  for (uint8_t i = 0; i < PLANT_COUNT; i++) {
    const bool running = outputsEnabled() && state.plants[i].running;
    if (running != lastRunning[i]) {
      diagnostic(String("[PlantCare] Pump ") + String(i + 1) + " GPIO" + String(RELAY_PINS[i]) +
                 " command=" + (running ? "ON" : "OFF") +
                 " output_level=" + String(relayLevel(running, RELAYS_ACTIVE_LOW)) +
                 " pin_level=" + String(gpio_get_level(static_cast<gpio_num_t>(RELAY_PINS[i]))));
      lastRunning[i] = running;
    }
  }
  static uint32_t lastSequence = 0;
  if (state.sequence != lastSequence) {
    lastSequence = state.sequence;
    for (uint8_t i = 0; i < PLANT_COUNT; i++) {
      const auto &plant = state.plants[i];
      diagnostic(String("Plant ") + String(i + 1) + " | GPIO" + String(SENSOR_PINS[i]) +
                 " | raw=" + String(plant.raw) + " | soil=" + soilStatus(i, plant) +
                 " | fault=" + String(plant.fault) + " | pump=" +
                 (outputsEnabled() ? (plant.running ? "on" : "off") : "disabled"));
    }
  }
  delay(2);
}
