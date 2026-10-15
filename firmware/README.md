# ESP32 firmware — planned

Firmware will be added after the exact ESP32, soil sensor, pump, and relay specifications are confirmed. There is no board-specific code or verified wiring yet.

Start with serial-only sensor readings and an explicitly disabled pump. Add calibration and fault detection, then network telemetry. Implement pump control only after confirming relay polarity and measuring pump flow.

Use a nonblocking state machine with local limits and pump-off defaults. Networking and AI availability must not determine when an active pump stops. Review [hardware requirements](../docs/hardware.md) before choosing pins or control logic.

Keep Wi-Fi and device credentials in an ignored local configuration file and provide only placeholder examples in Git. Validate HTTPS certificates; do not disable TLS verification.
