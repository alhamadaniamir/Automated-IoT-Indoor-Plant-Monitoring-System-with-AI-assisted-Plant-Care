#pragma once
#include <stdint.h>

enum class WateringMode { Scheduled, Manual, Approved };
struct WateringState {
  bool running = false, hasStopped = false, hasCancelled = false;
  uint32_t startedAt = 0, stoppedAt = 0, durationMs = 0, cancelledAt = 0;
  uint8_t cycles = 0;
  WateringMode mode = WateringMode::Scheduled;
};
constexpr uint32_t STOP_GUARD_MS = 5000;
inline uint32_t wateringWaitMs(const WateringState &state, uint32_t now, uint32_t cooldown) {
  const uint32_t stoppedElapsed = uint32_t(now - state.stoppedAt);
  const uint32_t cancelledElapsed = uint32_t(now - state.cancelledAt);
  const uint32_t soak = state.hasStopped && stoppedElapsed < cooldown ? cooldown - stoppedElapsed : 0;
  const uint32_t guard = state.hasCancelled && cancelledElapsed < STOP_GUARD_MS ? STOP_GUARD_MS - cancelledElapsed : 0;
  return soak > guard ? soak : guard;
}
inline bool canStart(const WateringState &state, uint32_t now, uint32_t cooldown,
                     uint8_t maxCycles, WateringMode mode = WateringMode::Scheduled) {
  if (state.running) return false;
  return mode == WateringMode::Manual ||
    (state.cycles < maxCycles && wateringWaitMs(state, now, cooldown) == 0);
}
inline bool startWatering(WateringState &state, uint32_t now, uint32_t duration,
                         uint32_t maximum, uint32_t cooldown, uint8_t maxCycles,
                         WateringMode mode = WateringMode::Scheduled) {
  if (duration == 0 || duration > maximum || !canStart(state, now, cooldown, maxCycles, mode)) return false;
  state.running = true; state.startedAt = now; state.durationMs = duration;
  state.mode = mode;
  if (mode != WateringMode::Manual) state.cycles++;
  return true;
}
// Manual duration is a renewable connection lease, not a chosen watering time.
inline void renewManualWatering(WateringState &state, uint32_t renewedAt) {
  if (state.running && state.mode == WateringMode::Manual) state.startedAt = renewedAt;
}
inline void stopWatering(WateringState &state, uint32_t now) {
  if (!state.running) return;
  state.running = false;
  if (state.mode != WateringMode::Manual) { state.hasStopped = true; state.stoppedAt = now; }
}
inline void cancelWatering(WateringState &state, uint32_t now) {
  stopWatering(state, now);
  if (!state.hasCancelled || uint32_t(now - state.cancelledAt) >= STOP_GUARD_MS) {
    state.hasCancelled = true; state.cancelledAt = now;
  }
}
inline void updateWatering(WateringState &state, uint32_t now, bool valid, bool enabled, bool tooWet) {
  const bool soilStop = state.mode != WateringMode::Manual && (!valid || tooWet);
  if (state.running && (!enabled || soilStop || uint32_t(now - state.startedAt) >= state.durationMs))
    stopWatering(state, now);
}
