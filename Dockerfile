# syntax=docker/dockerfile:1.3

FROM ubuntu:22.04 AS builder

ARG DEBIAN_FRONTEND=noninteractive
ARG AP_TAG=Copter-4.5

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

RUN git clone \
      --branch ${AP_TAG} \
      --depth 1 \
      --recursive \
      https://github.com/ArduPilot/ardupilot.git . \
 && git submodule update --init --recursive --depth 1

RUN --mount=type=cache,target=/root/.cache/pip \
    python3 -m pip install --upgrade pip \
 && python3 -m pip install --no-cache-dir \
      empy==3.3.4 \
      pexpect \
      future \
      pyserial \
      pymavlink

RUN ccache --max-size=1G

COPY src/ardupilot/ /patches/
RUN git apply /patches/*.patch

RUN ./waf configure --board sitl
RUN --mount=type=cache,id=ccache,target=/root/.ccache \
    ./waf copter -j$(nproc)
RUN --mount=type=cache,id=ccache,target=/root/.ccache \
    ./waf plane -j$(nproc)

FROM builder AS cuav-x7-sim-build
RUN --mount=type=cache,target=/var/cache/apt \
    apt-get update \
 && apt-get install -y --no-install-recommends libnewlib-arm-none-eabi libstdc++-arm-none-eabi-newlib \
 && rm -rf /var/lib/apt/lists/*
COPY src/hwdef/ libraries/AP_HAL_ChibiOS/hwdef/
RUN ./waf configure --board CUAV-X7-SimOnHardWare
RUN --mount=type=cache,id=ccache,target=/root/.ccache \
    ./waf copter -j$(nproc)

FROM scratch AS cuav-x7-sim
COPY --from=cuav-x7-sim-build /src/build/CUAV-X7-SimOnHardWare/bin/arducopter.apj /

FROM --platform=$BUILDPLATFORM node:22-alpine AS frontend

ARG VITE_CESIUM_ION_TOKEN=""
ENV VITE_CESIUM_ION_TOKEN=$VITE_CESIUM_ION_TOKEN

WORKDIR /app
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

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
      git \
      meson \
      ninja-build \
      pkg-config \
 && git clone --depth 1 https://github.com/mavlink-router/mavlink-router.git /tmp/mavlink-router \
 && cd /tmp/mavlink-router \
 && git submodule update --init --recursive --depth 1 \
 && meson setup build . -Dsystemdsystemunitdir=/usr/lib/systemd/system \
 && ninja -C build \
 && ninja -C build install \
 && rm -rf /tmp/mavlink-router \
 && apt-get purge -y git meson ninja-build pkg-config \
 && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*

RUN python3 -m pip install --no-cache-dir \
      pymavlink \
      pyserial \
      websockets

COPY --from=builder /src/build/sitl/bin/arducopter /usr/local/bin/arducopter
COPY --from=builder /src/build/sitl/bin/arduplane /usr/local/bin/arduplane
COPY --from=builder /src/Tools/autotest/default_params /usr/local/share/ardupilot/default_params
COPY --from=builder /src/Tools/autotest/models/plane.parm /usr/local/share/ardupilot/models/plane.parm

COPY --from=frontend /app/dist /var/www/html/

COPY src/ws_bridge.py /opt/aircast/ws_bridge.py
COPY src/gimbal.parm /usr/local/share/aircast/gimbal.parm
COPY src/pilot.parm /usr/local/share/aircast/pilot.parm
COPY src/airframe.parm /usr/local/share/aircast/airframe.parm
COPY src/racer.json /usr/local/share/aircast/racer.json
COPY src/serve.py /opt/aircast/serve.py

RUN mkdir -p /etc/mavlink-router && echo '[General]\n\
TcpServerPort=5760\n\
\n\
[TcpEndpoint sitl]\n\
Address=127.0.0.1\n\
Port=5766\n\
\n\
[UdpEndpoint gcs]\n\
Mode=Server\n\
Address=0.0.0.0\n\
Port=14550\n' > /etc/mavlink-router/main.conf

COPY --chmod=755 src/start-aircast-sitl.sh /usr/local/bin/start-aircast-sitl.sh

EXPOSE 5760 5761 5762 5763 5764 5765
EXPOSE 14550/udp 14551/udp 14552/udp 14553/udp 14554/udp 14555/udp
EXPOSE 9005 8888 8889

ENTRYPOINT ["/usr/local/bin/start-aircast-sitl.sh"]
CMD ["-S","-I0","-s","1","-w","--uartA","tcp:5766"]
