#!/bin/bash

VEHICLE_FILE=/var/lib/aircast/vehicle
HOME_FILE=/var/lib/aircast/home
PARAMS_FILE=/var/lib/aircast/params.parm
DEFAULT_PARAMS=/usr/local/share/ardupilot/default_params
MODEL_PARAMS=/usr/local/share/ardupilot/models
AIRCAST_PARAMS=/usr/local/share/aircast

shutdown() {
    echo "Shutting down Aircast SITL..."
    kill -TERM "$ws_bridge_pid" 2>/dev/null || true
    kill -TERM "$car_pid" 2>/dev/null || true
    kill -TERM "$web_pid" 2>/dev/null || true
    kill -TERM "$router_pid" 2>/dev/null || true
    kill -TERM "$sitl_pid" 2>/dev/null || true
    wait "$ws_bridge_pid" 2>/dev/null || true
    wait "$web_pid" 2>/dev/null || true
    wait "$router_pid" 2>/dev/null || true
    wait "$sitl_pid" 2>/dev/null || true
    echo "Exitting"
    exit 0
}

trap shutdown SIGTERM SIGINT

python3 /opt/aircast/serve.py &
web_pid=$!
echo "Web interface started on port 8888"

MAVLINK20=1 MAVLINK_PORT=5760 PYTHONUNBUFFERED=1 python3 /opt/aircast/ws_bridge.py &
ws_bridge_pid=$!
echo "WebSocket MAVLink bridge started on port 8889 (PID $ws_bridge_pid)"

ARGS=()
SKIP_NEXT=false
for arg in "$@"; do
    if $SKIP_NEXT; then
        SKIP_NEXT=false
        continue
    fi
    if [ "$arg" = "-M" ] || [ "$arg" = "--defaults" ]; then
        SKIP_NEXT=true
        continue
    fi
    ARGS+=("$arg")
done

while true; do
    vehicle=$(cat "$VEHICLE_FILE" 2>/dev/null || echo copter)
    case "$vehicle" in
        plane)
            binary=arduplane
            model=plane
            defaults="$MODEL_PARAMS/plane.parm,$AIRCAST_PARAMS/gimbal.parm"
            ;;
        quadplane)
            binary=arduplane
            model=quadplane
            defaults="$DEFAULT_PARAMS/quadplane.parm,$AIRCAST_PARAMS/gimbal.parm"
            ;;
        *)
            binary=arducopter
            model=quad:$AIRCAST_PARAMS/racer.json
            defaults="$DEFAULT_PARAMS/copter.parm,$AIRCAST_PARAMS/gimbal.parm,$AIRCAST_PARAMS/airframe.parm,$AIRCAST_PARAMS/pilot.parm,$AIRCAST_PARAMS/follow.parm"
            ;;
    esac
    if [ -s "$PARAMS_FILE" ]; then
        defaults="$defaults,$PARAMS_FILE"
    fi
    model="${SITL_MODEL:-$model}"
    home=$(cat "$HOME_FILE" 2>/dev/null || true)
    echo "Starting $binary SITL ($vehicle) with args: ${ARGS[*]} -M $model --defaults $defaults ${home:+--home $home}"
    "/usr/local/bin/$binary" "${ARGS[@]}" -M "$model" --defaults "$defaults" ${home:+--home "$home"} &
    sitl_pid=$!
    echo "SITL started with PID $sitl_pid"

    MAVLINK20=1 PYTHONUNBUFFERED=1 python3 /opt/aircast/car.py &
    car_pid=$!

    sleep 2
    if [ -z "$router_pid" ] || ! kill -0 "$router_pid" 2>/dev/null; then
        mavlink-routerd &
        router_pid=$!
        echo "mavlink-router started (PID $router_pid) - unlimited connections on TCP:5760"
    fi

    wait $sitl_pid
    exit_code=$?
    kill -TERM "$car_pid" 2>/dev/null || true

    if [ "$exit_code" -eq 143 ] || [ "$exit_code" -eq 130 ]; then
        echo "SITL received termination signal, shutting down..."
        break
    fi

    echo "SITL exited with code $exit_code, restarting in 2 seconds..."
    sleep 2
done
