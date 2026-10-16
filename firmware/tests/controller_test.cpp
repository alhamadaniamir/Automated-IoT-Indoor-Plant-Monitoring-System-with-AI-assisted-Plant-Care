#include <cassert>
#include "../AutomatedIoTIndoorPlantMonitoringSystem/WateringController.h"
int main() {
  WateringState state;
  assert(!startWatering(state, 0, 6000, 5000, 60000, 2));
  assert(startWatering(state, 0, 3000, 5000, 60000, 2));
  assert(!startWatering(state, 1, 3000, 5000, 60000, 2));
  updateWatering(state, 2999, true, true, false); assert(state.running);
  updateWatering(state, 3000, true, true, false); assert(!state.running);
  assert(!canStart(state, 62999, 60000, 2));
  assert(startWatering(state, 63000, 3000, 5000, 60000, 2));
  updateWatering(state, 63010, false, true, false); assert(!state.running);
  assert(!canStart(state, 123010, 60000, 2)); // Per-boot watering budget.
  WateringState wet;
  assert(startWatering(wet, 1, 3000, 5000, 60000, 2));
  updateWatering(wet, 2, true, true, true); assert(!wet.running);
  WateringState disabled;
  assert(startWatering(disabled, 1, 3000, 5000, 60000, 2));
  updateWatering(disabled, 2, true, false, false); assert(!disabled.running);
  WateringState wrap;
  assert(startWatering(wrap, 0xfffffff0, 50, 5000, 60, 2));
  updateWatering(wrap, 0x22, true, true, false); assert(!wrap.running);
}
