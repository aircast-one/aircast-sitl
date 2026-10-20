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
Both looks aim by the simulated gimbal, so gimbal controls and Follow's tracking move the picture.

In the Aircast app, add a TCP link to `sitl.aircast.one:5760` (in the browser at fly.aircast.one, a
Network link to `wss://sitl.aircast.one/ws/mavlink`) and a camera with the printed RTSP address.
`just camera <host>` follows another SITL. Needs Docker, uv, gh and Google Chrome.

## Car to chase

A car drives the first 2 km of road ahead of home and back, forever. The road comes from the public
[OSRM](https://project-osrm.org/) router, from home toward the home heading, so the car moves with
the Location panel. It brakes into each end of the road at 2 m/s² and pulls away again the same way.
It is MAVLink system 2 and sends only `GLOBAL_POSITION_INT`, so the Aircast app shows no second
vehicle. The onboard camera (browser and Unreal) and the 3D FPV view draw it on the road.

The Car panel on the dashboard sets its speed, 0 to 20 m/s (8 by default; 0 parks it), live and
without a restart, and shows how far it is from the drone. `POST /api/car` with `{"speed": 12}` does
the same from a script. The speed stays until the container restarts.

Switch the copter to Follow and it chases the car 20 m behind and 15 m above, nose and gimbal on it,
at up to 25 m/s ([`src/follow.parm`](src/follow.parm)), from anywhere within 2.5 km. Measured with
the car at 20 m/s from a standstill: on its spot in about 40 s, then within 2 m, and no more than
29 m off it through the turn at the end of the road. Loiter tops out at 10 m/s, so a hand-flown
chase needs the car at 10 m/s or less, or Acro.

`web/public/models/car.glb` is the Cesium Milk Truck, © 2017 Cesium, under
[CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/). Unreal draws a box van from the engine's
basic shapes.

## Ports

| Service | TCP Ports | UDP Ports |
|---------|-----------|-----------|
| MAVLink | 5760-5765 | 14550-14555 |
| FlightGear | 9005 | - |
| MAVLink over WebSocket | 8889 (`/ws/mavlink`) | - |

## Vehicles

The dashboard switches the simulator between Copter, Plane and QuadPlane. A switch restarts the SITL
for everyone connected. `POST /api/vehicle` with `{"vehicle": "plane"}` does the same from a script.

## Location

The Location panel on the dashboard moves the vehicle's starting point. Click the satellite map,
search for a place or paste `lat, lng`, then press Move here. The SITL restarts there for everyone
connected, with the ground elevation looked up from [Open-Meteo](https://open-meteo.com/en/docs/elevation-api).
`POST /api/home` with `{"lat": 41.7151, "lng": 44.8271}` does the same from a script. The location
resets to the ArduPilot default (CMAC, Canberra) when the container restarts.

## Parameters

The Parameters panel on the dashboard sets ArduPilot parameters the simulator starts with, one
`NAME value` per line. They are laid over the airframe's own defaults, so they win, and the SITL
restarts with them for everyone connected. They stay through every reset and vehicle switch, until
the container restarts.

Presets fill in the common setups, and pressing one again takes it out:

| Preset | Sets |
|---|---|
| Gripper | A servo gripper on output 12 that closes 2 s after each release, for several drops in a row |
| 4 bays on 9–12 | Outputs 9–12 free for a servo per bay (`DO_SET_SERVO`), with the gimbal moved to 13–15 |
| Wind | 7 m/s from the west |
| Low battery | The battery under its low-voltage limit, so ArduPilot refuses to arm |

Each name is checked against the running vehicle first. A name it doesn't know is refused, with
the closest match it does know, and nothing restarts. A parameter that only another vehicle has is
ignored after a vehicle switch.

`POST /api/params` with `{"params": {"SIM_WIND_SPD": 7}}` does the same from a script. It replaces
the whole set (`{"params": {}}` clears it) and answers once the restarted autopilot answers MAVLink,
so a script can connect right away. A refused name comes back as a 400 with
`{"unknown": {"GRIP_ENABLED": "GRIP_ENABLE"}}`. The vehicle, location and reset endpoints wait for the
autopilot the same way.

## Stick feel

The copter flies by [`src/pilot.parm`](src/pilot.parm): 10 m/s and 45° in Loiter, 5 m/s climb, braking
with no delay. Load the same file on the real drone so a flight rehearsed here handles the same in
the air: Mission Planner's Full Parameter List → Load from file, or `param load pilot.parm` in
MAVProxy. It uses ArduCopter 4.5 parameter names, as the SITL does. Check that the real airframe
holds altitude at 45° before flying it hard.

The simulated copter is a 5" FPV-sized quad, [`src/racer.json`](src/racer.json): 0.65 kg, 0.22 m,
hovering at 16% throttle with no motor slew limit, so it feels like a racer rather than a 3 kg camera
drone. [`src/airframe.parm`](src/airframe.parm) holds its ArduCopter AutoTune gains (yaw acceleration
limit left off); never load it on a real drone. Against the stock 3 kg SITL quad, a half-stick Acro
roll reaches 90% of its rate in 60–110 ms instead of ~200 ms, and full throttle climbs at 35–38 m/s²
instead of 10.5 m/s². Yaw is about the same, 200–230 ms, limited by the frame's yaw authority.

Measured in Loiter, from a stick step to the response:

| Stick | Response |
|---|---|
| Forward, half | 12° lean at 0.2 s, 2.4 m/s at 1 s, 3.7 m/s at 3 s |
| Forward, full | 0.5 m/s at 0.22 s, 5.9 m/s at 1 s, 9.4 m/s at 3 s |
| Released at full speed | stopped in 1.2 s |
| Yaw, full | turning within 55–90 ms, 90% of full rate at 0.4–0.45 s |
| Throttle, full | 0.3 m/s climb at 0.45 s, 4.1 m/s at 2 s |

Loiter here holds the heading while the yaw stick is centred
([`src/ardupilot/loiter-holds-heading.patch`](src/ardupilot/loiter-holds-heading.patch)). Stock
ArduCopter Loiter only holds the yaw rate, so swinging the lean around at 45° turns the nose: three
full right-stick circles turned it 116°, against 0° with the patch. A real drone flies stock Loiter
until it runs a build with the same patch.

Loiter turns the stick into a lean angle, so speed builds toward its limit with a time constant of
`LOIT_SPEED` / (g · tan `LOIT_ANG_MAX`), about 1 s here. A lower top speed or a steeper lean shortens it.

Acro flies on the rate loop alone (`ACRO_OPTIONS` 2). With ArduCopter's attitude hold on, releasing
the yaw stick swung the nose back by 29–52% of the turn rate and took 0.7–0.9 s to settle. On the rate
loop alone, with the simulated airframe's `ATC_RAT_YAW_P` at 0.8, a half-stick yaw reaches 90% of its
rate in 0.2 s and stops within 0.2 s, with no swing back.

Acro has no trainer (`ACRO_TRAINER` 0): released sticks hold the attitude instead of levelling the
copter, and roll and pitch are not capped at `ANGLE_MAX`.

## License

GPL-3.0, the same as the ArduPilot it builds. See [LICENSE](LICENSE).

`web/public/models/drone.glb` is the Cesium Drone, © 2017–2018 Analytical Graphics, Inc., mesh and
textures by Ed Mackey, under [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/).
