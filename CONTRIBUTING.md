# Contributing to Aircast SITL

Docker-based ArduPilot SITL (Copter, Plane, QuadPlane) for ARM64 and AMD64, plus the
`dbus-sim` D-Bus simulator and the Unreal/web camera rig used for FPV rendering.

## Build and run

```bash
just build          # current platform
just build-arm64     # Apple Silicon, Raspberry Pi
just build-amd64     # Intel/AMD x86_64
just run             # start the container
just logs            # follow container logs
just stop
```

`just` with no arguments lists every recipe, grouped by `build` / `run` / `publish`.

## Onboard camera / FPV rig

`just camera [host] [look]` starts MediaMTX, the MAVLink-to-WebSocket bridge
(`src/ws_bridge.py`, run via `uv run`), and either a headless Chrome/Vite renderer
(`look=photoreal` or `satellite`) or the Unreal project (`look=unreal`). The Unreal path
needs `just unreal-build` first, which fetches the pinned CesiumForUnreal release — check
the `cesium_unreal` variable in the `justfile` before bumping it, since a mismatched plugin
version breaks the Unreal build silently.

## dbus-sim

`dbus-sim/` is a separate Python component (see `dbus-sim/pyproject.toml`) with its own
`justfile`. Run `just test` from inside `dbus-sim/` before sending a PR that touches it —
CI (`.github/workflows/dbus-sim.yml`) runs the same `just test` on push/PR for any change
under `dbus-sim/**`, then publishes a multi-arch image to `ghcr.io/aircast-one/aircast-sim`
on `master` or a `v*` tag.

## Testing a change

- Core SITL changes (parameters, flight modes, camera tracking): build the image and fly it
  with MAVProxy, QGroundControl, or Mission Planner against `tcp:localhost:5760` /
  `udp:localhost:14550`, and confirm the behavior change in flight, not just at build time.
- `dbus-sim/` changes: `cd dbus-sim && just test`.
- Camera rig changes: `just camera` and check the rendered feed over RTSP.

## Commits and releases

Keep commits scoped and in the imperative, prefixed by area where it helps
(`feat(sitl): ...`, `fix(hil): ...`) — see `git log` for the existing convention.

Releases are cut from the Aircast superproject with `just release aircast-sitl <type>`, never
by tagging this repo directly. Every `v*` tag builds AMD64 and ARM64 on native runners,
publishes `latest` and `v<version>-<commit>`, and rolls out `sitl.aircast.one`.
