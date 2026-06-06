# aircast-dbus-sim library chart

A helm library chart exposing partial templates for embedding the aircast
D-Bus simulator as a sidecar in another chart's Pod spec.

## Usage in a parent chart

Add a dependency in your chart's `Chart.yaml`:

```yaml
dependencies:
  - name: aircast-dbus-sim
    version: 0.1.0
    repository: "file://../../../aircast-sitl/dbus-sim/deploy/helm"
```

In your Pod template:

```yaml
spec:
  containers:
    - name: agent
      # ...your agent container...
      env:
        {{- include "aircast-dbus-sim.consumerEnv" . | nindent 8 }}
      volumeMounts:
        {{- include "aircast-dbus-sim.consumerVolumeMount" . | nindent 8 }}
    {{- include "aircast-dbus-sim.container" . | nindent 4 }}
  volumes:
    {{- include "aircast-dbus-sim.volume" . | nindent 4 }}
```

The agent container then talks to the sim's D-Bus over the shared
`emptyDir` at `/run/dbus`. Unix-socket only — no network involved.

## Phase 8 / standalone deployment

This is a library chart, intentionally non-deployable on its own. The
StatefulSet pattern for a shared dev sim pool is Phase 8 and gets its
own chart elsewhere.
