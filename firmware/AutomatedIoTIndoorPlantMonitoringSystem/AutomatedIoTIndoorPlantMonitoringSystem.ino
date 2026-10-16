/* Three-plant Wi-Fi version of the existing Arduino sketch.
 * Open Config.h first. Default is monitoring only; unknown relay pins untouched.
 */
#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <Preferences.h>
#include <esp_random.h>
#include <esp_adc/adc_oneshot.h>
#include <driver/gpio.h>
#include <sys/time.h>
#include <time.h>
#include <errno.h>
#include "Config.h"
#include "WateringController.h"
#if !defined(CONFIG_IDF_TARGET_ESP32S3)
#error "Select your ESP32-S3 board: this sketch retains the existing S3 wiring."
#endif

WebServer server(80);
Preferences preferences;
adc_oneshot_unit_handle_t adcHandles[2] = {};
adc_unit_t units[PLANT_COUNT];
adc_channel_t channels[PLANT_COUNT];
bool adcReady[PLANT_COUNT] = {};
const char *SPECIES[] = {"pothos", "snake_plant", "peace_lily"};
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
  uint32_t cooldown = 0;
};
struct Telemetry { Channel plants[PLANT_COUNT]; uint32_t sampledAt = 0, sequence = 0; } sharedState;
struct Request { bool pending = false; uint32_t durationMs = 0; } requests[PLANT_COUNT];
portMUX_TYPE stateMux = portMUX_INITIALIZER_UNLOCKED;
bool clockSynced = false, ready = false;
int timezoneOffset = 0;
String deviceId, bootId;

bool outputsEnabled() { return RELAY_PINS_CONFIRMED && WATERING_ENABLED; }
bool calibrated(uint8_t i) {
  const auto &c = CALIBRATION[i];
  return c.wet > 0 && c.dry < 4095 && c.dry > c.wet;
}
bool thresholdsValid(uint8_t i) {
  return calibrated(i) && CALIBRATION[i].wet < WET_STOP_THRESHOLD[i] &&
    WET_STOP_THRESHOLD[i] < DRY_THRESHOLD[i] && DRY_THRESHOLD[i] < CALIBRATION[i].dry;
}
void setPump(uint8_t i, bool on) {
  if (RELAY_PINS_CONFIRMED) gpio_set_level(static_cast<gpio_num_t>(RELAY_PINS[i]), (on == RELAYS_ACTIVE_LOW) ? 0 : 1);
}
Telemetry snapshot() {
  portENTER_CRITICAL(&stateMux); const Telemetry copy = sharedState; portEXIT_CRITICAL(&stateMux); return copy;
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
Channel readSensor(uint8_t i) {
  Channel result;
  if (!adcReady[i]) return result;
  int sum = 0; bool rail = false;
  for (uint8_t n = 0; n < 8; n++) {
    int raw;
    if (adc_oneshot_read(adcHandles[units[i]], channels[i], &raw) != ESP_OK) return result;
    sum += raw; rail = rail || raw <= 0 || raw >= 4095;
  }
  result.raw = sum / 8; result.fault = rail ? 2 : 0; return result;
}
// Network requests cannot delay the pump stop timer or sensor checks.
void controlTask(void *) {
  WateringState pumps[PLANT_COUNT]; Telemetry state; bool first = true;
  TickType_t wake = xTaskGetTickCount();
  for (;;) {
    const uint32_t now = millis();
    if (first || uint32_t(now - state.sampledAt) >= SAMPLE_MS) {
      for (uint8_t i = 0; i < PLANT_COUNT; i++) state.plants[i] = readSensor(i);
      state.sampledAt = now; state.sequence++; first = false;
    }
    for (uint8_t i = 0; i < PLANT_COUNT; i++) {
      Request request;
      portENTER_CRITICAL(&stateMux); request = requests[i]; requests[i].pending = false; portEXIT_CRITICAL(&stateMux);
      auto &plant = state.plants[i];
      const bool enabled = outputsEnabled() && thresholdsValid(i);
      const bool valid = plant.fault == 0 && plant.raw > WET_STOP_THRESHOLD[i];
      updateWatering(pumps[i], now, plant.fault == 0, enabled, plant.raw <= WET_STOP_THRESHOLD[i]);
      if (request.pending && enabled && valid) startWatering(pumps[i], now, request.durationMs, MAX_PUMP_MS, COOLDOWN_MS, MAX_CYCLES_PER_BOOT);
      setPump(i, pumps[i].running);
      plant.running = pumps[i].running; plant.cycles = pumps[i].cycles;
      const uint32_t elapsed = uint32_t(now - pumps[i].stoppedAt);
      plant.cooldown = pumps[i].hasStopped && elapsed < COOLDOWN_MS ? COOLDOWN_MS - elapsed : 0;
    }
    portENTER_CRITICAL(&stateMux); sharedState = state; portEXIT_CRITICAL(&stateMux);
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
bool queueWater(uint8_t i, uint8_t seconds, bool scheduled) {
  const Telemetry state = snapshot(); const auto &plant = state.plants[i];
  if (!outputsEnabled() || !thresholdsValid(i) || plant.fault || state.sequence == 0 ||
      uint32_t(millis() - state.sampledAt) > 2000 || plant.raw <= WET_STOP_THRESHOLD[i] ||
      (scheduled && plant.raw <= DRY_THRESHOLD[i]) || plant.running || plant.cooldown ||
      plant.cycles >= MAX_CYCLES_PER_BOOT || seconds == 0 || seconds > 5) return false;
  portENTER_CRITICAL(&stateMux);
  const bool accepted = !requests[i].pending;
  if (accepted) { requests[i].durationMs = seconds * 1000UL; requests[i].pending = true; }
  portEXIT_CRITICAL(&stateMux);
  return accepted;
}
void handleWater() {
  if (!clientAllowed()) return;
  uint8_t i; if (!plantArg(i)) return;
  long seconds;
  if (!numberArg("seconds", 1, 5, seconds)) { replyError(400, "Choose a duration from 1 to 5 seconds."); return; }
  if (!queueWater(i, seconds, false)) { replyError(409, "Watering paused: check calibration, relay setup, soil, cooldown, or watering budget."); return; }
  replyOk(); // Accepted request; the control task rechecks safety before starting.
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
      !numberArg("hour", 0, 23, hour) || !numberArg("minute", 0, 59, minute) || !numberArg("seconds", 1, 5, seconds)) { replyError(400, "Invalid plant settings."); return; }
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
      Serial.println("Could not save daily watering marker; schedules paused."); clockSynced = false; return;
    }
    profile.lastDay = day;
    queueWater(i, profile.seconds, true); // Skip if wet/faulted/unready; no catch-up dose.
  }
}
void telemetry() {
  const Telemetry state = snapshot(); String json; json.reserve(2500);
  json = "{\"schema_version\":1,\"source\":\"device\",\"device_id\":\"" + deviceId + "\",\"boot_id\":\"" + bootId;
  json += "\",\"sample_sequence\":" + String(state.sequence) + ",\"sample_age_ms\":" + String(uint32_t(millis() - state.sampledAt));
  json += ",\"clock_synced\":" + String(clockSynced ? "true" : "false");
  json += ",\"pump_outputs_enabled\":" + String(outputsEnabled() ? "true" : "false") + ",\"plants\":[";
  for (uint8_t i = 0; i < PLANT_COUNT; i++) {
    const auto &plant = state.plants[i]; const auto &profile = profiles[i]; if (i) json += ',';
    json += "{\"id\":" + String(i + 1) + ",\"species\":\"" + SPECIES[profile.species] + "\",\"sensor_pin\":" + String(SENSOR_PINS[i]) + ",\"relay_pin\":" + String(RELAY_PINS[i]);
    json += ",\"soil_raw\":" + (plant.raw < 0 ? String("null") : String(plant.raw));
    json += ",\"calibrated\":" + String(calibrated(i) ? "true" : "false") + ",\"soil_moisture_pct\":";
    if (!plant.fault && calibrated(i)) { const auto &c = CALIBRATION[i]; json += String(constrain(100.0f * (c.dry - plant.raw) / (c.dry - c.wet), 0.0f, 100.0f), 1); } else json += "null";
    json += ",\"pump_running\":"; json += outputsEnabled() ? (plant.running ? "true" : "false") : "null";
    json += ",\"schedule_enabled\":" + String(profile.schedule ? "true" : "false");
    json += ",\"schedule_hour\":" + String(profile.hour) + ",\"schedule_minute\":" + String(profile.minute) + ",\"watering_seconds\":" + String(profile.seconds);
    json += ",\"faults\":[";
    if (plant.fault) json += plant.fault == 1 ? "\"adc_read_failed\"" : "\"adc_saturated\"";
    if (plant.cycles >= MAX_CYCLES_PER_BOOT) { if (plant.fault) json += ','; json += "\"watering_budget_exhausted\""; }
    json += "]}";
  }
  json += "]}"; server.sendHeader("Cache-Control", "no-store"); server.send(200, "application/json", json);
}
void setup() {
  Serial.begin(115200);
  if (RELAY_PINS_CONFIRMED) for (uint8_t i = 0; i < PLANT_COUNT; i++) { setPump(i, false); gpio_set_direction(static_cast<gpio_num_t>(RELAY_PINS[i]), GPIO_MODE_OUTPUT); }
  deviceId = "plantcare-" + String(uint32_t(ESP.getEfuseMac() & 0xFFFFFF), HEX); bootId = String(esp_random(), HEX);
  if (!preferences.begin("plantcare", false)) { Serial.println("Cannot load plant settings."); return; }
  for (uint8_t i = 0; i < PLANT_COUNT; i++) {
    auto &p = profiles[i];
    p.species = preferences.getUChar(key("species", i).c_str(), i); if (p.species > 2) p.species = i;
    p.schedule = preferences.getBool(key("schedule", i).c_str(), false);
    p.hour = preferences.getUChar(key("hour", i).c_str(), 8); if (p.hour > 23) p.hour = 8;
    p.minute = preferences.getUChar(key("minute", i).c_str(), 0); if (p.minute > 59) p.minute = 0;
    p.seconds = preferences.getUChar(key("seconds", i).c_str(), 3); if (p.seconds < 1 || p.seconds > 5) p.seconds = 3;
    p.lastDay = preferences.getInt(key("day", i).c_str(), -1);
  }
  WiFi.mode(WIFI_AP);
  String password = preferences.getString("wifi-pass", "");
  if (password.length() != 16) { char generated[17]; snprintf(generated, sizeof(generated), "%08lx%08lx", (unsigned long)esp_random(), (unsigned long)esp_random()); password = generated; preferences.putString("wifi-pass", password); }
  const String ssid = "PlantCare-" + String(uint32_t(ESP.getEfuseMac() & 0xFFFFFF), HEX);
  const IPAddress address(192,168,4,1);
  if (!WiFi.softAPConfig(address, address, IPAddress(255,255,255,0)) || !WiFi.softAP(ssid.c_str(), password.c_str())) { Serial.println("Could not start PlantCare Wi-Fi."); return; }
  setupAdc();
  if (xTaskCreate(controlTask, "plant-control", 4096, nullptr, 2, nullptr) != pdPASS) { Serial.println("Controller task failed."); return; }
  const char *headers[] = {"X-PlantCare-Client"}; server.collectHeaders(headers, 1);
  server.on("/api/telemetry", HTTP_GET, telemetry); server.on("/api/time", HTTP_POST, handleTime);
  server.on("/api/plant", HTTP_POST, handlePlant); server.on("/api/water", HTTP_POST, handleWater);
  server.onNotFound([]() { replyError(404, "Unknown plant-device endpoint."); }); server.begin(); ready = true;
  Serial.println("\n=== Connect your Flutter app ==="); Serial.print("Wi-Fi: "); Serial.println(ssid);
  Serial.print("Password: "); Serial.println(password); Serial.println("Address: 192.168.4.1");
  Serial.println("Join this Wi-Fi on your phone, then tap Connect.");
  if (!RELAY_PINS_CONFIRMED) Serial.println("MONITOR ONLY: relay GPIOs unconfigured. Disconnect pump power during commissioning.");
}
void loop() {
  if (!ready) { delay(100); return; }
  server.handleClient(); checkSchedules();
  static uint32_t lastSequence = 0; const Telemetry state = snapshot();
  if (state.sequence != lastSequence) { lastSequence = state.sequence; for (uint8_t i = 0; i < PLANT_COUNT; i++) Serial.printf("Plant %d raw=%d fault=%u pump=%s\n", i+1, state.plants[i].raw, state.plants[i].fault, outputsEnabled() ? (state.plants[i].running ? "on" : "off") : "disabled"); }
  delay(2);
}
