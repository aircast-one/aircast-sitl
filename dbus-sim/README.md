# aircast D-Bus simulator

A container that stands in for the host-side D-Bus services aircast-agent
talks to on a Pi (`org.freedesktop.NetworkManager` and
`org.freedesktop.ModemManager1`). It exists so the agent boots
end-to-end in sandboxed K8s pods, CI runners, and dev laptops without
real hardware on the other side.

This image lives in `aircast-sitl/dbus-sim/` alongside the ArduPilot
SITL because both serve the same purpose — simulating the host
environment a real drone provides. They release independently.

Full design: see `/docs/simulators.md` in the parent monorepo.

## Quick start

```sh
# Build + run the smoke test (most useful target)
make test

# Start the sim in the background and tail logs
make run
make logs
make stop
```

The simulator currently exposes only the **happy-wifi** scenario:

- One activated WiFi device on `wlan0`.
- One access point `homeNet` (5180 MHz, strength 87).
- `org.freedesktop.NetworkManager.State == 70` (CONNECTED_GLOBAL).
- `org.freedesktop.ModemManager1` is on the bus with zero modems.

## Phase 1 only

The simulator is being built in phases. Everything below is deferred:

- [ ] **Phase 2** — NM extensions: `IP4Config`, `Settings`,
      `Settings.Connection`, `Connection.Active`, `Device.Reapply`.
- [ ] **Phase 3** — MM extensions: `Bearer`, `Signal.Lte`, signal /
      registration transitions over time.
- [ ] **Phase 4** — YAML scenario loader and runtime transitions.
- [ ] **Phase 5** — FastAPI control plane for test-time scenario driving.
- [ ] **Phase 6** — K8s sidecar integration via aircast-deployer; helm
      chart; image published to GHCR.
- [ ] **Phase 7** — Failure injection routes + agent recovery-path tests.

Until Phase 6 the image is local-only — there's no published GHCR tag.

## Implementation notes

- Tooling: [python-dbusmock](https://github.com/martinpitt/python-dbusmock)
  templates for NM and MM.
- `dbus-daemon` is launched by the container's entrypoint at the stable
  path `unix:path=/run/dbus/system_bus_socket`. The address is exported
  as `DBUS_SYSTEM_BUS_ADDRESS` so the sim's Python process and any
  sidecar consumer share the same bus.
- Bus auth accepts both `EXTERNAL` and `ANONYMOUS`. EXTERNAL is what
  godbus (used by aircast-agent) negotiates; ANONYMOUS is the fallback
  for python-dbus and other clients. The image creates a uid-1000
  `aircast` user so EXTERNAL succeeds when the agent connects as its
  default uid.
- The container removes Debian's bundled
  `org.freedesktop.NetworkManager.service` and
  `org.freedesktop.ModemManager1.service` so the bus doesn't try to
  auto-activate the real binaries.
- Runs unprivileged. No `--cap-add`, no host networking, no kernel
  modules.

## File layout

```
dbus-sim/
├── Dockerfile
├── Makefile
├── README.md
├── entrypoint.sh
├── pyproject.toml
├── aircast_sim/
│   ├── __init__.py
│   ├── __main__.py
│   └── scenarios/builtins/happy_wifi.py
└── tests/test_smoke.py
```
