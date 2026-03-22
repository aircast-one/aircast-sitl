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
      socat \
      netcat-openbsd \
      bash \
      procps \
      iproute2 \
 && rm -rf /var/lib/apt/lists/*

# Install minimal Python dependencies for SITL
RUN python3 -m pip install --no-cache-dir \
      pymavlink \
      pyserial

COPY --from=builder /src/build/sitl/bin/arducopter /usr/local/bin/arducopter
COPY --from=builder /src/Tools/autotest/default_params /usr/local/share/ardupilot/default_params

# Copy web interface
COPY src/ /var/www/html/

# Create startup script that runs both SITL and web server
RUN echo '#!/bin/bash\n\
\n\
# Function to handle shutdown\n\
shutdown() {\n\
    echo "Shutting down Aircast SITL..."\n\
    kill -TERM "$web_pid" 2>/dev/null || true\n\
    kill -TERM "$sitl_pid" 2>/dev/null || true\n\
    wait "$web_pid" 2>/dev/null || true\n\
    wait "$sitl_pid" 2>/dev/null || true\n\
    echo "Exitting"\n\
    exit 0\n\
}\n\
\n\
# Set up signal handlers\n\
trap shutdown SIGTERM SIGINT\n\
\n\
# Start web server in background\n\
cd /var/www/html\n\
python3 -m http.server 8888 --bind 0.0.0.0 &\n\
web_pid=$!\n\
echo "Web interface started on port 8888"\n\
\n\
# Allow model override via SITL_MODEL env var (e.g. JSON:gazebo for Gazebo)\n\
if [ -n "$SITL_MODEL" ]; then\n\
    echo "Using model from SITL_MODEL=$SITL_MODEL"\n\
    # Replace -M arg in CMD args\n\
    ARGS=()\n\
    SKIP_NEXT=false\n\
    for arg in "$@"; do\n\
        if $SKIP_NEXT; then\n\
            SKIP_NEXT=false\n\
            continue\n\
        fi\n\
        if [ "$arg" = "-M" ]; then\n\
            SKIP_NEXT=true\n\
            continue\n\
        fi\n\
        ARGS+=("$arg")\n\
    done\n\
    set -- "${ARGS[@]}" "-M" "$SITL_MODEL"\n\
fi\n\
\n\
# Keep SITL running in a loop with restart on crash\n\
while true; do\n\
    echo "Starting ArduCopter SITL with args: $@"\n\
    /usr/local/bin/arducopter "$@" &\n\
    sitl_pid=$!\n\
    echo "SITL started with PID $sitl_pid"\n\
    \n\
    # Wait for SITL process to exit\n\
    wait $sitl_pid\n\
    exit_code=$?\n\
    \n\
    # Check if we are shutting down (trap was triggered)\n\
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

# Use the wrapper script as entrypoint
ENTRYPOINT ["/usr/local/bin/start-aircast-sitl.sh"]
CMD ["-S","-I0","-M","copter","-s","1","-w","--defaults","/usr/local/share/ardupilot/default_params/copter.parm"]
