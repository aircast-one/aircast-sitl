# Aircast SITL

Docker-based ArduPilot SITL (Copter, Plane, QuadPlane) for ARM64 and AMD64.

## Run

```bash
docker pull ghcr.io/aircast-one/aircast-sitl:latest
docker run --rm -it \
  -p 5760-5765:5760-5765 -p 14550-14555:14550-14555/udp \
  -p 8888:8888 -p 8889:8889 \
  ghcr.io/aircast-one/aircast-sitl:latest
```

The dashboard is at http://localhost:8888 and MAVLink on TCP 5760 or UDP 14550. Each release is also
tagged `v<version>-<commit>`; see [Releases](https://github.com/aircast-one/aircast-sitl/releases).

## Build from source

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

## Releases

Maintainers release with `just release aircast-sitl <type>` from the Aircast superproject. Every `v*` tag
builds AMD64 and ARM64 on native runners, publishes `latest` and `v<version>-<commit>`, and rolls out
sitl.aircast.one.

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

`just camera` renders the drone's gimballed camera from the SITL's telemetry (Google Photorealistic
3D Tiles through Cesium ion, headless Chrome on this Mac's GPU) and serves it as
`rtsp://<this mac>:8554/sim`. `just camera <host> satellite` falls back to flat Esri imagery on Cesium
terrain.

`just camera <host> unreal` renders the same tiles in Unreal Engine 5.8 with Cesium for Unreal (sky
atmosphere, physical sun, filmic tone mapping) and pushes 1280×720 frames through ffmpeg
(VideoToolbox H.264) to the same RTSP address at ~30 fps. It needs Unreal Engine 5.8 from the Epic
Games Launcher and Xcode's Metal toolchain (`xcodebuild -downloadComponent MetalToolchain`; without
it Unreal stops at startup behind an alert). `just unreal-build` installs the pinned Cesium for
Unreal into the engine and compiles `unreal/`. The first launch compiles shaders for a few minutes.

In the Aircast app, add a TCP link to `sitl.aircast.one:5760` and a camera with the printed RTSP
address. `just camera <host>` follows another SITL. Needs Docker, uv, gh and Google Chrome.

## Ports

| Service | TCP Ports | UDP Ports |
|---------|-----------|-----------|
| MAVLink | 5760-5765 | 14550-14555 |
| FlightGear | 9005 | - |

## Vehicles

The dashboard switches the simulator between Copter, Plane and QuadPlane. A switch restarts the SITL
for everyone connected. `POST /api/vehicle` with `{"vehicle": "plane"}` does the same from a script.

## Location

The Location panel on the dashboard moves the vehicle's starting point. Click the satellite map,
search for a place or paste `lat, lng`, then press Move here. The SITL restarts there for everyone
connected, with the ground elevation looked up from [Open-Meteo](https://open-meteo.com/en/docs/elevation-api).
`POST /api/home` with `{"lat": 41.7151, "lng": 44.8271}` does the same from a script. The location
resets to the ArduPilot default (CMAC, Canberra) when the container restarts.

## Stick feel

The copter flies by [`src/pilot.parm`](src/pilot.parm): 10 m/s and 45° in Loiter, 5 m/s climb, braking
with no delay. Load the same file on the real drone so a flight rehearsed here handles the same in
the air: Mission Planner's Full Parameter List → Load from file, or `param load pilot.parm` in
MAVProxy. It uses ArduCopter 4.5 parameter names, as the SITL does. Check that the real airframe
holds altitude at 45° before flying it hard. [`src/airframe.parm`](src/airframe.parm) tunes yaw for
the simulated airframe only; never load it on a real drone.

Measured in Loiter, from a stick step to the response:

| Stick | Response |
|---|---|
| Forward, half | 12° lean at 0.2 s, 2.4 m/s at 1 s, 3.7 m/s at 3 s |
| Forward, full | 0.5 m/s at 0.22 s, 5.9 m/s at 1 s, 9.4 m/s at 3 s |
| Released at full speed | stopped in 1.2 s |
| Yaw, full | turning within 55–90 ms, 90% of full rate at 0.4–0.45 s |
| Throttle, full | 0.3 m/s climb at 0.45 s, 4.1 m/s at 2 s |

Loiter turns the stick into a lean angle, so speed builds toward its limit with a time constant of
`LOIT_SPEED` / (g · tan `LOIT_ANG_MAX`), about 1 s here. A lower top speed or a steeper lean shortens it.

Acro flies on the rate loop alone (`ACRO_OPTIONS` 2). With ArduCopter's attitude hold on, releasing
the yaw stick swung the nose back by 29–52% of the turn rate and took 0.7–0.9 s to settle. On the rate
loop alone, with the simulated airframe's `ATC_RAT_YAW_P` at 0.8, a half-stick yaw reaches 90% of its
rate in 0.2 s and stops within 0.2 s, with no swing back.

## License

GPL-3.0, the same as the ArduPilot it builds. See [LICENSE](LICENSE).

`web/public/models/drone.glb` is the Cesium Drone, © 2017–2018 Analytical Graphics, Inc., mesh and
textures by Ed Mackey, under [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/).
