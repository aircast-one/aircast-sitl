## 🚀 Automated Builds

One GitHub Actions workflow handles everything:

### What It Does
- **Pull Requests**: Builds only (no push)
- **Push to master**: Builds `latest` tag
- **Push to develop**: Builds `latest-dev` + deploys to development
- **Version tags** (`v1.0.0`): Builds versioned tag + creates GitHub release

### Available Images
```bash
# Latest from master
docker pull ghcr.io/aircast-one/aircast-sitl:latest

# Development
docker pull ghcr.io/aircast-one/aircast-sitl:latest-dev

# Specific version
docker pull ghcr.io/aircast-one/aircast-sitl:1.0.0
```

### Workflow
```bash
# Development
git push origin develop
# → Builds + deploys to dev environment

# Release
git tag v1.0.0 && git push origin v1.0.0
# → Builds + creates GitHub release
```# Aircast SITL

Docker-based ArduPilot SITL simulator for ARM64 and AMD64 platforms.

## Quick Start

```bash
# Build the image (current platform)
just build

# Build for specific architecture
just build-arm64    # Apple Silicon, Raspberry Pi
just build-amd64    # Intel/AMD x86_64

# Build for both architectures
just build-multi

# Run SITL
just run

# Stop SITL
just stop
```

## Available Commands

| Command | Description |
|---------|-------------|
| `just build` | Build for current platform |
| `just build-arm64` | Build for ARM64 (Apple Silicon, Raspberry Pi) |
| `just build-amd64` | Build for AMD64 (Intel/AMD x86_64) |
| `just build-multi` | Build for both ARM64 and AMD64 |
| `just run` | Run SITL container |
| `just camera` | Stream the drone's onboard camera over RTSP |
| `just stop` | Stop running container |
| `just logs` | Show container logs |
| `just push-multi` | Push multi-arch image to registry |

## Multi-Architecture Support

This image supports both ARM64 and AMD64 architectures:

- **ARM64**: Apple Silicon Macs, Raspberry Pi 4+
- **AMD64**: Intel/AMD x86_64 systems

### Building for Different Architectures

```bash
# For Apple Silicon / Raspberry Pi
just build-arm64

# For Intel/AMD systems
just build-amd64

# For both (creates manifest with both architectures)
just build-multi
```

### Pushing Multi-Architecture Images

```bash
# Build and push for both architectures
just push-multi
```

This creates a single image tag that automatically selects the correct architecture when pulled.

## 🚀 Automated Builds

GitHub Actions automatically builds and pushes images:

### Triggers
- **Push to main/develop**: Builds and pushes `latest` tag
- **Pull requests**: Builds only (no push)
- **Version tags** (`v1.0.0`): Builds and creates GitHub release

### Available Images
```bash
# Latest from main branch
docker pull ghcr.io/aircast-one/aircast-sitl:latest

# Specific version
docker pull ghcr.io/aircast-one/aircast-sitl:1.0.0

# Development branch
docker pull ghcr.io/aircast-one/aircast-sitl:develop
```

### Creating a Release
```bash
# Tag a version
git tag v1.0.0
git push origin v1.0.0

# GitHub Actions will automatically:
# 1. Build multi-arch images
# 2. Push to container registry  
# 3. Create GitHub release with changelog
```

## Connecting to SITL

### MAVProxy
```bash
mavproxy.py --master=tcp:localhost:5760
```

### QGroundControl
Add a UDP connection to `localhost:14550`

### Mission Planner
Add a TCP connection to `localhost:5760`

## Onboard Camera

`just camera` renders the drone's gimballed camera from the SITL's telemetry (Cesium terrain + Esri
imagery, headless Chrome on this Mac's GPU) and serves it as `rtsp://<this mac>:8554/sim`.

In the Aircast app, add a TCP link to `sitl.aircast.one:5760` and a camera with the printed RTSP
address. `just camera <host>` follows another SITL. Needs Docker, uv, gh and Google Chrome.

## Ports

| Service | TCP Ports | UDP Ports |
|---------|-----------|-----------|
| MAVLink | 5760-5765 | 14550-14555 |
| FlightGear | 9005 | - |
