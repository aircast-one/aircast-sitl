# syntax=docker/dockerfile:1.28
FROM debian:trixie-slim AS runtime

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
 && mkdir -p /run/dbus \
 && useradd -u 1000 -m -s /bin/bash aircast \
 && chown -R aircast:aircast /run/dbus /var/lib/dbus

ENV PYTHONPATH=/opt
ENV PYTHONUNBUFFERED=1

COPY aircast_sim /opt/aircast_sim
COPY tests       /opt/tests
COPY conf/aircast-sim-bus.conf /etc/dbus-1/aircast-sim-bus.conf
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

HEALTHCHECK --interval=2s --timeout=2s --retries=10 \
  CMD test -S /run/dbus/system_bus_socket || exit 1

LABEL org.opencontainers.image.source="https://github.com/aircast-one/aircast-sitl" \
      org.opencontainers.image.description="aircast D-Bus simulator (Phase 1: skeleton)"

USER aircast

ENTRYPOINT ["/usr/bin/tini", "--", "/entrypoint.sh"]

FROM runtime AS dev-tools
USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        python3-pip \
 && rm -rf /var/lib/apt/lists/* \
 && pip3 install --break-system-packages --no-cache-dir \
        "ruff>=0.17" \
        "mypy>=2.4"
ENTRYPOINT []
