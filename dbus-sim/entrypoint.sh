#!/bin/bash
set -euo pipefail

dbus-uuidgen --ensure=/var/lib/dbus/machine-id
mkdir -p /run/dbus

# Start dbus-daemon ourselves at a stable, shareable path so this image
# works as a sidecar (other containers can mount /run/dbus and connect).
# Phase 1 used dbusmock.DBusTestCase.start_system_bus() which generates a
# random /tmp/dbusmock_XXX/ path — fine for smoke tests, blocks sidecar use.
dbus-daemon --config-file=/etc/dbus-1/aircast-sim-bus.conf --fork \
  --print-address=3 3>/run/dbus/address

# Wait for the socket to appear (dbus-daemon --fork returns before bind on some kernels).
for _ in $(seq 1 50); do
  [[ -S /run/dbus/system_bus_socket ]] && break
  sleep 0.1
done
[[ -S /run/dbus/system_bus_socket ]] || { echo "dbus socket never appeared" >&2; exit 1; }

export DBUS_SYSTEM_BUS_ADDRESS=unix:path=/run/dbus/system_bus_socket
echo "{\"service\":\"aircast_sim\",\"phase\":\"bus_ready\",\"bus_address\":\"$DBUS_SYSTEM_BUS_ADDRESS\"}"

SCENARIO="${AIRCAST_SIM_SCENARIO:-happy_wifi}"
exec python3 -m aircast_sim --scenario "${SCENARIO}"
