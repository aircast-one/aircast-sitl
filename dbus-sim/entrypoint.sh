#!/bin/bash
# Entry point for the aircast D-Bus simulator container.
# We don't start a system-wide dbus-daemon here; aircast_sim spawns its own
# private bus via dbusmock.DBusTestCase.start_system_bus() (Phase 1). The bus
# socket lives wherever dbusmock chooses to put it (tmpfs under /tmp) and the
# address is propagated via DBUS_SYSTEM_BUS_ADDRESS for any in-container
# clients (e.g. the smoke test, busctl).
set -euo pipefail

# dbus-daemon (and downstream tooling like busctl) require a machine-id. The
# image doesn't ship one because debian:trixie-slim is meant for ephemeral
# containers. Generate it once at boot — idempotent thanks to --ensure.
dbus-uuidgen --ensure=/var/lib/dbus/machine-id

SCENARIO="${AIRCAST_SIM_SCENARIO:-happy_wifi}"
exec python3 -m aircast_sim --scenario "${SCENARIO}"
