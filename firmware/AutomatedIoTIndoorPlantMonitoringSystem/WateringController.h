#pragma once
#include <stdint.h>

struct WateringState {
  bool running = false, hasStopped = false;
  uint32_t startedAt = 0, stoppedAt = 0, durationMs = 0;
  uint8_t cycles = 0;
};
inline bool canStart(const WateringState &state, uint32_t now, uint32_t cooldown, uint8_t maxCycles) {
  return !state.running && state.cycles < maxCycles &&
    (!state.hasStopped || uint32_t(now - state.stoppedAt) >= cooldown);
}
inline bool startWatering(WateringState &state, uint32_t now, uint32_t duration,
                         uint32_t maximum, uint32_t cooldown, uint8_t maxCycles) {
  if (duration == 0 || duration > maximum || !canStart(state, now, cooldown, maxCycles)) return false;
  state.running = true; state.startedAt = now; state.durationMs = duration; state.cycles++;
  return true;
}
inline void updateWatering(WateringState &state, uint32_t now, bool valid, bool enabled, bool tooWet) {
  if (state.running && (!valid || !enabled || tooWet || uint32_t(now - state.startedAt) >= state.durationMs)) {
    state.running = false; state.hasStopped = true; state.stoppedAt = now;
  }
}
