# aircast-sitl task runner. Run `just` to list recipes.
#
# Docker-based ArduPilot SITL simulator for ARM64 and AMD64 platforms.

set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

image_name     := "ghcr.io/pavliha/aircast-sitl"
tag            := "latest"
full_image     := image_name + ":" + tag
container_name := "aircast-sitl"

tcp_ports := "5760-5765:5760-5765"
udp_ports := "14550-14555:14550-14555/udp"
fg_port   := "9005:9005"
web_port  := "8888:8888"

# List available recipes
default:
    @just --list

# Build the image for the current platform
[group('build')]
build:
    @echo "Building Aircast SITL image for current platform..."
    docker build -t {{full_image}} .
    @echo "✅ Build complete: {{full_image}}"

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
