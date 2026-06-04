# syntax=docker/dockerfile:1.6
# ---
# aircast D-Bus simulator (Phase 1: skeleton)
# Boots a private dbus-daemon, loads python-dbusmock's NetworkManager and
# ModemManager1 templates, and applies the bundled happy-wifi scenario.
# ---
FROM debian:trixie-slim

# - dbus           : provides dbus-daemon + dbus-uuidgen
# - python3        : interpreter
# - python3-dbus   : Python D-Bus bindings (also pulled in by dbusmock)
# - python3-dbusmock : NM + MM templates and DBusTestCase helpers
# - tini           : PID 1 signal forwarder
# - bash           : entrypoint shell
#
# After install, we remove the bundled NetworkManager / ModemManager1
# .service files so dbus-daemon won't try to auto-activate the real
# binaries when a client looks up the well-known name. (See design doc
# /docs/simulators.md, "Container blueprint" -> "Pitfalls".)
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        bash \
        dbus \
        python3 \
        python3-dbus \
        python3-dbusmock \
        tini \
 && rm -rf /var/lib/apt/lists/* \
 && rm -f /usr/share/dbus-1/system-services/org.freedesktop.NetworkManager.service \
          /usr/share/dbus-1/system-services/org.freedesktop.ModemManager1.service \
 && mkdir -p /run/dbus

# We do not pip-install our package. Trixie's python3 is PEP-668 externally
# managed; rather than carry a venv just for one in-tree module, we drop the
# package onto PYTHONPATH. The package has no third-party runtime imports
# beyond what apt already provided (dbusmock, dbus).
ENV PYTHONPATH=/opt
ENV PYTHONUNBUFFERED=1

COPY aircast_sim /opt/aircast_sim
COPY tests       /opt/tests
COPY conf/aircast-sim-bus.conf /etc/dbus-1/aircast-sim-bus.conf
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

LABEL org.opencontainers.image.source="https://github.com/aircast-one/aircast-sitl" \
      org.opencontainers.image.description="aircast D-Bus simulator (Phase 1: skeleton)"

ENTRYPOINT ["/usr/bin/tini", "--", "/entrypoint.sh"]
