set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

image_name     := "ghcr.io/pavliha/aircast-sitl"
tag            := "latest"
full_image     := image_name + ":" + tag
container_name := "aircast-sitl"

tcp_ports := "5760-5765:5760-5765"
udp_ports := "14550-14555:14550-14555/udp"
fg_port   := "9005:9005"
web_port  := "8888:8888"

camera_ports := "-p 8889:8889 -p 8554:8554 -p 8890:8890 -p 8189:8189"

sitl_site     := "https://sitl.aircast.one"
camera_agent  := "one.aircast.sitl-camera"
unreal_root   := "/Users/Shared/Epic Games/UE_5.8"
cesium_unreal := "2.30.0"

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

# Run the SITL container (MAVLink TCP 5760-5765, UDP 14550-14555, web 8888, cameras: RTSP 8554, WebRTC 8890)
[group('run')]
run:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "Starting Aircast SITL..."
    echo "MAVLink connections:"
    echo "  TCP: localhost:5760-5765"
    echo "  UDP: localhost:14550-14555"
    echo "Web interface: http://localhost:8888"
    echo "Cameras (while \`just camera http://localhost:8888\` runs): rtsp://localhost:8554/sim, /shoot"
    echo ""
    echo "Press Ctrl+C to stop..."
    docker run --rm -it \
        --name {{container_name}} \
        -p {{tcp_ports}} \
        -p {{udp_ports}} \
        -p {{fg_port}} \
        -p {{web_port}} \
        {{camera_ports}} \
        -e MTX_WEBRTCADDITIONALHOSTS=127.0.0.1 \
        -e SIM_TARGET="${SIM_TARGET:-0}" \
        {{full_image}}

# Fly an FPV interceptor yourself against the target drone of a running `SIM_TARGET=1 just run`. Left stick or W/S A/D: throttle and yaw; right stick or arrows: pitch and roll. flags: -Target=shahed136|orlan10|zala421 -Paint=factory|black|grey|white -SolarTime=<h> -CloudCover=<0..1> -Random[=seed] -Record=<dir> -Rtsp=<url>
[group('run')]
game telemetry="ws://127.0.0.1:8889" *flags:
    just unreal-build
    "{{unreal_root}}/Engine/Binaries/Mac/UnrealEditor.app/Contents/MacOS/UnrealEditor" "$PWD/unreal/AircastSim.uproject" -game -windowed -ResX=1280 -ResY=720 -Preview -Play "-Telemetry={{telemetry}}" "-IonToken=$(gh variable get VITE_CESIUM_ION_TOKEN -R aircast-one/aircast-sitl)" {{flags}}

# Render the SITL's cameras on this Mac whenever someone watches rtsp://<site>:8554/sim (FPV gimbal) or /shoot (payload gimbal). look: photoreal | satellite | unreal (unreal renders /sim only)
[group('run')]
camera site=sitl_site look="photoreal":
    #!/usr/bin/env bash
    set -euo pipefail
    [ "{{look}}" != unreal ] || just unreal-build
    export SITL_SITE="{{site}}" CAMERA_LOOK="{{look}}" PYTHONUNBUFFERED=1
    export CAMERA_PUBLISHER_PASS="$(security find-generic-password -s {{camera_agent}} -w 2>/dev/null || true)"
    if [ "{{look}}" = unreal ]; then
        export CESIUM_ION_TOKEN="$(gh variable get VITE_CESIUM_ION_TOKEN -R aircast-one/aircast-sitl)"
    fi
    exec uv run --quiet --no-project --with websockets python src/camera_agent.py

# Keep `just camera` running at login, so the cloud feeds render on this Mac on demand
[group('run')]
camera-install site=sitl_site look="photoreal":
    #!/usr/bin/env bash
    set -euo pipefail
    security find-generic-password -s {{camera_agent}} >/dev/null 2>&1 || {
        echo "Store the publisher password first: security add-generic-password -s {{camera_agent}} -a publisher -w '<password from Bitwarden>'"
        exit 1
    }
    plist="$HOME/Library/LaunchAgents/{{camera_agent}}.plist"
    mkdir -p "$(dirname "$plist")"
    cat > "$plist" <<EOF
    <?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
    <plist version="1.0">
    <dict>
      <key>Label</key><string>{{camera_agent}}</string>
      <key>ProgramArguments</key>
      <array>
        <string>$(command -v just)</string>
        <string>--justfile</string><string>$PWD/justfile</string>
        <string>camera</string><string>{{site}}</string><string>{{look}}</string>
      </array>
      <key>EnvironmentVariables</key>
      <dict><key>PATH</key><string>$PATH</string></dict>
      <key>RunAtLoad</key><true/>
      <key>KeepAlive</key><true/>
      <key>StandardOutPath</key><string>$HOME/Library/Logs/{{camera_agent}}.log</string>
      <key>StandardErrorPath</key><string>$HOME/Library/Logs/{{camera_agent}}.log</string>
    </dict>
    </plist>
    EOF
    launchctl bootout "gui/$(id -u)/{{camera_agent}}" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$plist"
    echo "Camera agent runs at login for {{site}}; log: ~/Library/Logs/{{camera_agent}}.log"

# Stop rendering cameras on this Mac at login
[group('run')]
camera-uninstall:
    launchctl bootout "gui/$(id -u)/{{camera_agent}}" 2>/dev/null || true
    rm -f "$HOME/Library/LaunchAgents/{{camera_agent}}.plist"

# Turn a recorded dataset's H.264 video into YOLO images numbered like its labels (record with the camera's -Record=<dir>)
[group('build')]
dataset-frames dir:
    ffmpeg -loglevel error -i "{{dir}}/video.mp4" -start_number 0 -fps_mode passthrough -qscale:v 2 "{{dir}}/images/%08d.jpg"
    @echo "$(ls "{{dir}}/images" | wc -l | tr -d ' ') frames, $(find "{{dir}}/labels" -size +0 | wc -l | tr -d ' ') with the target in view"

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
    [ -d Content/Models ] || just unreal-models

# Split the drone models' propellers into their own meshes and import them into the Unreal project (sources and credits in unreal/Models)
[group('build')]
unreal-models:
    cd unreal/Models && uv run -q --no-project --with trimesh --with numpy --with scipy --with pillow python split.py . build
    "{{unreal_root}}/Engine/Binaries/Mac/UnrealEditor.app/Contents/MacOS/UnrealEditor" "$PWD/unreal/AircastSim.uproject" -run=pythonscript -script="$PWD/unreal/Models/import.py $PWD/unreal/Models/build" -unattended -nosplash -nullrhi

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
