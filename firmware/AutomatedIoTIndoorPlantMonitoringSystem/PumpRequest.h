#pragma once
#include "WateringController.h"

// All access is protected by stateMux. Revision tokens invalidate delayed ON
// and renewal requests after OFF, lease expiry, or a reboot (boot ID prefix).
struct PumpRequest {
  bool pending = false, manualLeaseActive = false;
  uint32_t durationMs = 0, stopRevision = 0, stoppedRevision = 0, renewedAt = 0, validUntil = 0;
  WateringMode mode = WateringMode::Scheduled;
  bool stopPending() const { return stopRevision != stoppedRevision; }
  bool queueStart(uint32_t duration, WateringMode requestedMode) {
    if (pending || stopPending() || manualLeaseActive) return false;
    durationMs = duration; mode = requestedMode; pending = true; return true;
  }
  bool queueManual(uint32_t now, uint32_t leaseMs, uint32_t expectedRevision) {
    if (expectedRevision != stopRevision || !queueStart(leaseMs, WateringMode::Manual)) return false;
    renewedAt = now; manualLeaseActive = true; return true;
  }
  bool renewManual(uint32_t now, uint32_t leaseMs, uint32_t expectedRevision) {
    if (expectedRevision != stopRevision || stopPending() || !manualLeaseActive ||
        uint32_t(now - renewedAt) >= leaseMs) return false;
    renewedAt = now; return true;
  }
  bool queueApproved(uint32_t duration, uint32_t now, uint32_t ttl, uint32_t expectedRevision) {
    if (duration == 0 || duration > 20000 || ttl == 0 || ttl > 60000 || expectedRevision != stopRevision ||
        !queueStart(duration, WateringMode::Approved)) return false;
    validUntil = now + ttl; return true;
  }
  bool approvalFresh(uint32_t now) const { return int32_t(validUntil - now) > 0; }
  void queueStop() { pending = false; manualLeaseActive = false; ++stopRevision; }
  PumpRequest take() { const PumpRequest copy = *this; pending = false; return copy; }
  void acknowledgeStop(uint32_t revision) { stoppedRevision = revision; }
  bool allowsOutput(bool requestedOn) const { return requestedOn && !stopPending(); }
};
