# syntax=docker/dockerfile:1.3
# ---
# Build ArduPilot SITL for universal architecture
# Multi-stage to keep final image small
# ---

#################################
# 1) Builder stage: compile SITL
#################################
FROM --platform=$BUILDPLATFORM ubuntu:22.04 AS builder

ARG DEBIAN_FRONTEND=noninteractive
ARG AP_TAG=Copter-4.5

# 1.1) Install system deps, cache apt
RUN --mount=type=cache,target=/var/cache/apt \
    apt-get update \
 && apt-get install -y --no-install-recommends \
      git \
      python3 python3-dev python3-pip \
      build-essential \
      ccache \
      gcc-arm-none-eabi \
      pkg-config \
      wget \
      curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /src

# 1.2) Clone ArduPilot (shallow + minimal submodules)
RUN git clone \
      --branch ${AP_TAG} \
      --depth 1 \
      --recursive \
      https://github.com/ArduPilot/ardupilot.git . \
 && git submodule update --init --recursive --depth 1

# 1.3) Install Python tooling (cache pip)
RUN --mount=type=cache,target=/root/.cache/pip \
    python3 -m pip install --upgrade pip \
 && python3 -m pip install --no-cache-dir \
      empy==3.3.4 \
      pexpect \
      future \
      pyserial \
      pymavlink

# 1.4) Prime ccache
RUN ccache --max-size=1G

# 1.5) Configure & build SITL
RUN ./waf configure --board sitl
RUN --mount=type=cache,id=ccache,target=/root/.ccache \
    ./waf copter -j$(nproc)

################################################
# 2) Runtime stage: only SITL binary + defaults
################################################
FROM ubuntu:22.04

ARG DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      python3 \
      python3-pip \
      python3-dev \
      build-essential \
      pkg-config \
      socat \
      netcat-openbsd \
      bash \
      procps \
      iproute2 \
      curl \
      git \
      meson \
      ninja-build \
 && rm -rf /var/lib/apt/lists/*

# Build mavlink-router from source for multi-client support
RUN git clone --depth 1 https://github.com/mavlink-router/mavlink-router.git /tmp/mavlink-router \
 && cd /tmp/mavlink-router \
 && git submodule update --init --recursive \
 && meson setup build . -Dsystemdsystemunitdir= \
 && ninja -C build \
 && ninja -C build install \
 && rm -rf /tmp/mavlink-router

# Install minimal Python dependencies for SITL
RUN python3 -m pip install --no-cache-dir \
      pymavlink \
      pyserial

COPY --from=builder /src/build/sitl/bin/arducopter /usr/local/bin/arducopter
COPY --from=builder /src/Tools/autotest/default_params /usr/local/share/ardupilot/default_params

# Copy web interface
COPY src/ /var/www/html/

# Create health check script for Kubernetes probes
RUN echo '#!/bin/bash\n\
# Check if SITL process is running\n\
if pgrep -x "arducopter" > /dev/null; then\n\
    echo "OK"\n\
    exit 0\n\
else\n\
    echo "SITL not running"\n\
    exit 1\n\
fi\n' > /usr/local/bin/healthcheck.sh \
 && chmod +x /usr/local/bin/healthcheck.sh

# Create mavlink-router config for multi-client support
# mavlink-router listens on UDP 14550 for SITL data and serves TCP on 5760
RUN echo '[General]\n\
TcpServerPort = 5760\n\
\n\
[UdpEndpoint sitl]\n\
Mode = Server\n\
Address = 127.0.0.1\n\
Port = 14550\n' > /etc/mavlink-router.conf

# Create startup script that runs SITL, mavlink-router, and web server
RUN echo '#!/bin/bash\n\
\n\
# Function to handle shutdown\n\
shutdown() {\n\
    echo "Shutting down Aircast SITL..."\n\
    rm -f /var/www/html/health 2>/dev/null || true\n\
    kill -TERM "$web_pid" 2>/dev/null || true\n\
    kill -TERM "$router_pid" 2>/dev/null || true\n\
    kill -TERM "$sitl_pid" 2>/dev/null || true\n\
    wait "$web_pid" 2>/dev/null || true\n\
    wait "$router_pid" 2>/dev/null || true\n\
    wait "$sitl_pid" 2>/dev/null || true\n\
    echo "Exiting"\n\
    exit 0\n\
}\n\
\n\
trap shutdown SIGTERM SIGINT\n\
\n\
# Start web server\n\
cd /var/www/html\n\
python3 -m http.server 8888 --bind 0.0.0.0 &\n\
web_pid=$!\n\
echo "Web interface started on port 8888"\n\
\n\
# Start mavlink-router (accepts unlimited TCP clients on 5760)\n\
mavlink-routerd -c /etc/mavlink-router.conf &\n\
router_pid=$!\n\
echo "mavlink-router started on TCP port 5760"\n\
\n\
while true; do\n\
    echo "Starting ArduCopter SITL..."\n\
    # SITL SERIAL0 outputs to UDP 14550, mavlink-router forwards to TCP clients\n\
    /usr/local/bin/arducopter "$@" --serial0 udpclient:127.0.0.1:14550 &\n\
    sitl_pid=$!\n\
    echo "SITL started with PID $sitl_pid"\n\
    \n\
    sleep 5\n\
    if pgrep -x "arducopter" > /dev/null; then\n\
        echo "healthy" > /var/www/html/health\n\
        echo "Health marker created"\n\
    fi\n\
    \n\
    wait $sitl_pid\n\
    exit_code=$?\n\
    \n\
    rm -f /var/www/html/health 2>/dev/null || true\n\
    \n\
    if [ "$exit_code" -eq 143 ] || [ "$exit_code" -eq 130 ]; then\n\
        echo "SITL received termination signal, shutting down..."\n\
        break\n\
    fi\n\
    \n\
    echo "SITL exited with code $exit_code, restarting in 2 seconds..."\n\
    sleep 2\n\
done\n' > /usr/local/bin/start-aircast-sitl.sh \
 && chmod +x /usr/local/bin/start-aircast-sitl.sh

EXPOSE 5760 5761 5762 5763 5764 5765
EXPOSE 14550/udp 14551/udp 14552/udp 14553/udp 14554/udp 14555/udp
EXPOSE 9005 8888

# Docker healthcheck - uses the health file on web server
# Note: Kubernetes probes should use httpGet on port 8888 path /health
# instead of tcpSocket on port 5760 to avoid interfering with MAVLink
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:8888/health || exit 1

# Use the wrapper script as entrypoint
ENTRYPOINT ["/usr/local/bin/start-aircast-sitl.sh"]
CMD ["-S","-I0","-M","copter","-s","1","-w","--defaults","/usr/local/share/ardupilot/default_params/copter.parm"]
