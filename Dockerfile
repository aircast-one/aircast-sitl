# syntax=docker/dockerfile:1.3
# ---
# Build ArduPilot SITL for ARM64 (Apple Silicon Mac / Raspberry Pi)
# Multi-stage to keep final image small
# ---

#################################
# 1) Builder stage: compile SITL
#################################
FROM ubuntu:22.04 AS builder

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

# Create startup script that handles signals properly
RUN echo '#!/bin/bash\n\
set -e\n\
\n\
# Function to handle shutdown\n\
shutdown() {\n\
    echo "Shutting down ArduCopter SITL..."\n\
    kill -TERM "$child" 2>/dev/null || true\n\
    wait "$child"\n\
    exit 0\n\
}\n\
\n\
# Set up signal handlers\n\
trap shutdown SIGTERM SIGINT\n\
\n\
# Start ArduCopter in background\n\
/usr/local/bin/arducopter "$@" &\n\
child=$!\n\
\n\
# Wait for the background process\n\
wait "$child"\n' > /usr/local/bin/start-arducopter.sh \
 && chmod +x /usr/local/bin/start-arducopter.sh

EXPOSE 5760 5761 5762 5763 5764 5765
EXPOSE 14550/udp 14551/udp 14552/udp 14553/udp 14554/udp 14555/udp
EXPOSE 9005

# Use the wrapper script as entrypoint
ENTRYPOINT ["/usr/local/bin/start-arducopter.sh"]
CMD ["-S","-I0","-M","copter","-s","1","-w","--defaults","/usr/local/share/ardupilot/default_params/copter.parm"]
