set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

image_name     := "ghcr.io/pavliha/aircast-sitl"
tag            := "latest"
full_image     := image_name + ":" + tag
container_name := "aircast-sitl"

tcp_ports := "5760-5765:5760-5765"
udp_ports := "14550-14555:14550-14555/udp"
fg_port   := "9005:9005"
web_port  := "8888:8888"

sitl_host      := "sitl.aircast.one"
mediamtx_image := "bluenviron/mediamtx:1.21.2"
camera_port    := "5174"
chrome         := "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
unreal_root    := "/Users/Shared/Epic Games/UE_5.8"
tailscale      := "/Applications/Tailscale.app/Contents/MacOS/Tailscale"
cesium_unreal  := "2.30.0"

# List available recipes
default:
    @just --list

# Build the image for the current platform
[group('build')]
build:
    @echo "Building Aircast SITL image for current platform..."
    docker build -t {{full_image}} .
    @echo "✅ Build complete: {{full_image}}"

# Build CUAV-X7 firmware that flies this simulator's physics on the board itself, into dist/
[group('build')]
hil-firmware:
    docker build --target cuav-x7-sim --output type=local,dest=dist .

# Build the image for ARM64 (Apple Silicon, Raspberry Pi)
[group('build')]
build-arm64:
    @echo "Building Aircast SITL image for ARM64..."
    docker build --platform linux/arm64 -t {{image_name}}:arm64 .
    @echo "✅ ARM64 build complete: {{image_name}}:arm64"

# Build the image for AMD64 (Intel/AMD x86_64)
[group('build')]
build-amd64:
    @echo "Building Aircast SITL image for AMD64..."
    docker build --platform linux/amd64 -t {{image_name}}:amd64 .
    @echo "✅ AMD64 build complete: {{image_name}}:amd64"

# Build a multi-arch image (ARM64 + AMD64) via buildx
[group('build')]
build-multi:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "Setting up Docker buildx for multi-arch builds..."
    docker buildx create --name aircast-builder --use || docker buildx use aircast-builder
    echo "Building Aircast SITL image for ARM64 and AMD64..."
    docker buildx build \
        --platform linux/amd64,linux/arm64 \
        -t {{full_image}} \
        --load \
        .
    echo "✅ Multi-arch build complete: {{full_image}}"

# Run the SITL container (MAVLink TCP 5760-5765, UDP 14550-14555, web 8888)
[group('run')]
run:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "Starting Aircast SITL..."
    echo "MAVLink connections:"
    echo "  TCP: localhost:5760-5765"
    echo "  UDP: localhost:14550-14555"
    echo "Web interface: http://localhost:8888"
    echo ""
    echo "Press Ctrl+C to stop..."
    docker run --rm -it \
        --name {{container_name}} \
        -p {{tcp_ports}} \
        -p {{udp_ports}} \
        -p {{fg_port}} \
        -p {{web_port}} \
        {{full_image}}

# Render the SITL's cameras at `host` and serve them as rtsp://<this mac>:8554/sim (2-axis FPV gimbal) and /shoot (fixed, payload-drop aim). look: photoreal | satellite | unreal (unreal renders /sim only)
[group('run')]
camera host=sitl_host look="photoreal":
    #!/usr/bin/env bash
    set -euo pipefail
    profile=$(mktemp -d)
    profile2=$(mktemp -d)
    trap 'kill $(jobs -p) 2>/dev/null; docker rm -f aircast-sitl-camera >/dev/null 2>&1; rm -rf "$profile" "$profile2"' EXIT
    docker rm -f aircast-sitl-camera >/dev/null 2>&1 || true
    docker run -d --rm --name aircast-sitl-camera \
        -e MTX_RTMP=no -e MTX_HLS=no -e MTX_SRT=no -e MTX_RTSPTRANSPORTS=tcp \
        -e MTX_WEBRTCADDITIONALHOSTS=127.0.0.1 \
        -p 8554:8554 -p 8899:8889 -p 8189:8189/udp {{mediamtx_image}} >/dev/null
    MAVLINK_HOST={{host}} MAVLINK_PORT=5760 PYTHONUNBUFFERED=1 MAVLINK20=1 SIM_CAMERA=1 \
        uv run --quiet --no-project --with pymavlink --with websockets python src/ws_bridge.py &
    token=$(gh variable get VITE_CESIUM_ION_TOKEN -R aircast-one/aircast-sitl)
    if [ "{{look}}" = unreal ]; then
        just unreal-build
        "{{unreal_root}}/Engine/Binaries/Mac/UnrealEditor.app/Contents/MacOS/UnrealEditor" \
            "$PWD/unreal/AircastSim.uproject" -game -windowed -ResX=1280 -ResY=720 -log \
            -Telemetry=ws://127.0.0.1:8889 -Rtsp=rtsp://127.0.0.1:8554/sim -IonToken="$token" &
    else
        (cd web && npm install --prefer-offline --no-audit --no-fund --silent \
            && VITE_CESIUM_ION_TOKEN="$token" exec node_modules/.bin/vite --port {{camera_port}} --strictPort --logLevel warn) &
        until curl -sf -o /dev/null http://localhost:{{camera_port}}; do sleep 1; done
        "{{chrome}}" --headless --user-data-dir="$profile" --window-size=1280,720 \
            --disable-features=WebRtcHideLocalIpsWithMdns \
            --disable-background-timer-throttling --disable-renderer-backgrounding \
            "http://localhost:{{camera_port}}/camera?look={{look}}&whip=http://localhost:8899/sim/whip" 2>/dev/null &
        "{{chrome}}" --headless --user-data-dir="$profile2" --window-size=1280,720 \
            --disable-features=WebRtcHideLocalIpsWithMdns \
            --disable-background-timer-throttling --disable-renderer-backgrounding \
            "http://localhost:{{camera_port}}/camera?look={{look}}&aim=fixed&whip=http://localhost:8899/shoot/whip" 2>/dev/null &
    fi
    echo "Vehicle: TCP {{host}}:5760"
    echo "Camera (FPV gimbal):   rtsp://$(ipconfig getifaddr en0):8554/sim"
    [ "{{look}}" = unreal ] || echo "Camera (payload/shoot): rtsp://$(ipconfig getifaddr en0):8554/shoot"
    tailnet=$("{{tailscale}}" ip -4 2>/dev/null || true)
    if [ -n "$tailnet" ]; then
        echo "Tailnet (FPV gimbal):   rtsp://$tailnet:8554/sim"
        [ "{{look}}" = unreal ] || echo "Tailnet (payload/shoot): rtsp://$tailnet:8554/shoot"
    fi
    wait

# Fetch the pinned Cesium for Unreal and build the Unreal camera project
[group('build')]
unreal-build:
    #!/usr/bin/env bash
    set -euo pipefail
    plugins="{{unreal_root}}/Engine/Plugins/Marketplace"
    if ! grep -q '"VersionName": "{{cesium_unreal}}"' "$plugins/CesiumForUnreal/CesiumForUnreal.uplugin" 2>/dev/null; then
        rm -rf "$plugins/CesiumForUnreal"
        mkdir -p "$plugins"
        gh release download v{{cesium_unreal}} -R CesiumGS/cesium-unreal -p "CesiumForUnreal-58-v{{cesium_unreal}}.zip" -O "$plugins/cesium.zip" --clobber
        unzip -q "$plugins/cesium.zip" -d "$plugins"
        rm "$plugins/cesium.zip"
    fi
    cd unreal
    "{{unreal_root}}/Engine/Build/BatchFiles/Mac/Build.sh" AircastSimEditor Mac Development -Project="$PWD/AircastSim.uproject" -WaitMutex

# Stop the running SITL container
[group('run')]
stop:
    @echo "Stopping SITL container..."
    docker stop {{container_name}} || true

# Follow the SITL container logs
[group('run')]
logs:
    @echo "Showing SITL logs..."
    docker logs -f {{container_name}}

# Build and push a multi-arch image to the registry
[group('publish')]
push-multi:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "Setting up Docker buildx for multi-arch builds..."
    docker buildx create --name aircast-builder --use || docker buildx use aircast-builder
    echo "Building and pushing multi-arch image to GitHub Container Registry..."
    docker buildx build \
        --platform linux/amd64,linux/arm64 \
        -t {{full_image}} \
        --push \
        .
    echo "✅ Multi-arch image pushed: {{full_image}}"

# Push the ARM64 image to the registry
[group('publish')]
push-arm64:
    @echo "Pushing ARM64 image to GitHub Container Registry..."
    docker push {{image_name}}:arm64
    @echo "✅ ARM64 image pushed: {{image_name}}:arm64"

# Push the AMD64 image to the registry
[group('publish')]
push-amd64:
    @echo "Pushing AMD64 image to GitHub Container Registry..."
    docker push {{image_name}}:amd64
    @echo "✅ AMD64 image pushed: {{image_name}}:amd64"
