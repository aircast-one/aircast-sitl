import asyncio
import math
import time

from pymavlink import mavutil

MAV = mavutil.mavlink
COMPONENT = MAV.MAV_COMP_ID_CAMERA
HFOV_DEG = 60.0
RESOLUTION = (1280, 720)
VFOV_DEG = math.degrees(2 * math.atan(math.tan(math.radians(HFOV_DEG / 2)) * RESOLUTION[1] / RESOLUTION[0]))
FOCAL_MM = 4.0
SENSOR_H_MM = 2 * FOCAL_MM * math.tan(math.radians(HFOV_DEG / 2))
SENSOR_V_MM = SENSOR_H_MM * RESOLUTION[1] / RESOLUTION[0]
FLAGS = (
    MAV.CAMERA_CAP_FLAGS_HAS_TRACKING_POINT
    | MAV.CAMERA_CAP_FLAGS_HAS_TRACKING_RECTANGLE
    | MAV.CAMERA_CAP_FLAGS_HAS_TRACKING_GEO_STATUS
)
GIMBAL_DEVICE = 1
GAIN_PER_S = 2.0
HEARTBEAT_S = 1.0
STEER_S = 0.05
BOX_STALE_S = 1.0
LOST_S = 3.0
TICK_S = 0.01
TRACK_COMMANDS = (MAV.MAV_CMD_CAMERA_TRACK_POINT, MAV.MAV_CMD_CAMERA_TRACK_RECTANGLE)
INTERVALS = {
    MAV.MAVLINK_MSG_ID_CAMERA_TRACKING_IMAGE_STATUS: 'status_s',
    MAV.MAVLINK_MSG_ID_CAMERA_TRACKING_GEO_STATUS: 'geo_s',
}


def padded(text, size):
    return list(text.encode().ljust(size, b'\0'))


def angle_from_centre(fraction, fov_deg):
    return math.atan(2 * fraction * math.tan(math.radians(fov_deg) / 2))


def steer(box):
    x = (box[0] + box[2]) / 2 - 0.5
    y = (box[1] + box[3]) / 2 - 0.5
    return -GAIN_PER_S * angle_from_centre(y, VFOV_DEG), GAIN_PER_S * angle_from_centre(x, HFOV_DEG)


def picks(box, command, p):
    if box is None:
        return False
    if command == MAV.MAV_CMD_CAMERA_TRACK_POINT:
        radius = p[2] if math.isfinite(p[2]) else 0.0
        return box[0] - radius <= p[0] <= box[2] + radius and box[1] - radius <= p[1] <= box[3] + radius
    return p[0] < box[2] and box[0] < p[2] and p[1] < box[3] and box[1] < p[3]


def autopilot_heartbeat(msg):
    return msg.autopilot != MAV.MAV_AUTOPILOT_INVALID and msg.type != MAV.MAV_TYPE_GCS


def connect(host, port):
    while True:
        try:
            conn = mavutil.mavlink_connection(f'tcp:{host}:{port}', autoreconnect=True)
            beat = next(
                msg for msg in iter(lambda: conn.recv_match(type='HEARTBEAT', blocking=True, timeout=10), None)
                if autopilot_heartbeat(msg)
            )
            conn.target_system = beat.get_srcSystem()
            conn.mav.srcSystem = conn.target_system
            conn.mav.srcComponent = COMPONENT
            print(f'Simulated camera is component {COMPONENT} of system {conn.target_system}, tracking the car')
            return conn
        except Exception as e:
            print(f'Simulated camera waiting for the SITL at tcp:{host}:{port}... ({e})')
            time.sleep(2)


def send_information(conn):
    conn.mav.camera_information_send(
        int(time.monotonic() * 1000) & 0xFFFFFFFF,
        padded('Aircast', 32),
        padded('SITL tracking camera', 32),
        0,
        FOCAL_MM,
        SENSOR_H_MM,
        SENSOR_V_MM,
        RESOLUTION[0],
        RESOLUTION[1],
        0,
        FLAGS,
        0,
        b'',
        GIMBAL_DEVICE,
    )


def send_rates(conn, pitch_rate, yaw_rate):
    conn.mav.gimbal_manager_set_pitchyaw_send(
        conn.target_system,
        MAV.MAV_COMP_ID_AUTOPILOT1,
        MAV.GIMBAL_MANAGER_FLAGS_YAW_LOCK,
        0,
        math.nan,
        math.nan,
        pitch_rate,
        yaw_rate,
    )


def send_status(conn, box, tracking):
    active = tracking and box is not None
    edges = box if active else (math.nan,) * 4
    conn.mav.camera_tracking_image_status_send(
        MAV.CAMERA_TRACKING_STATUS_FLAGS_ACTIVE if active else MAV.CAMERA_TRACKING_STATUS_FLAGS_IDLE,
        MAV.CAMERA_TRACKING_MODE_RECTANGLE if active else MAV.CAMERA_TRACKING_MODE_NONE,
        MAV.CAMERA_TRACKING_TARGET_DATA_IN_STATUS if active else 0,
        (edges[0] + edges[2]) / 2,
        (edges[1] + edges[3]) / 2,
        math.nan,
        *edges,
    )


def send_geo(conn, car):
    conn.mav.camera_tracking_geo_status_send(
        MAV.CAMERA_TRACKING_STATUS_FLAGS_ACTIVE,
        car.lat,
        car.lon,
        car.alt / 1000,
        math.nan,
        math.nan,
        car.vx / 100,
        car.vy / 100,
        car.vz / 100,
        math.nan,
        math.nan,
        math.radians(car.hdg / 100),
        math.nan,
    )


def answer(conn, msg, state, box):
    command, p = msg.command, (msg.param1, msg.param2, msg.param3, msg.param4)
    asked_info = command == MAV.MAV_CMD_REQUEST_CAMERA_INFORMATION or (
        command == MAV.MAV_CMD_REQUEST_MESSAGE and int(p[0]) == MAV.MAVLINK_MSG_ID_CAMERA_INFORMATION
    )
    if asked_info:
        result = MAV.MAV_RESULT_ACCEPTED
    elif command == MAV.MAV_CMD_SET_MESSAGE_INTERVAL and int(p[0]) in INTERVALS:
        state[INTERVALS[int(p[0])]] = None if p[1] < 0 else max(p[1], 100_000) / 1e6
        result = MAV.MAV_RESULT_ACCEPTED
    elif command in TRACK_COMMANDS:
        state['tracking'] = picks(box, command, p)
        state['seen_at'] = time.monotonic()
        result = MAV.MAV_RESULT_ACCEPTED if state['tracking'] else MAV.MAV_RESULT_FAILED
        print('Tracking the car' if state['tracking'] else 'Asked to track, but the car is not there')
    elif command == MAV.MAV_CMD_CAMERA_STOP_TRACKING:
        state['tracking'] = False
        send_rates(conn, 0.0, 0.0)
        result = MAV.MAV_RESULT_ACCEPTED
        print('Stopped tracking')
    else:
        result = MAV.MAV_RESULT_UNSUPPORTED
    conn.mav.command_ack_send(command, result, 0, 0, msg.get_srcSystem(), msg.get_srcComponent())
    if asked_info:
        send_information(conn)


async def run(host, port, car_box):
    conn = await asyncio.to_thread(connect, host, port)
    state = {
        'tracking': False, 'status_s': None, 'geo_s': None, 'car': None,
        'seen_at': 0.0, 'beat_at': 0.0, 'steered_at': 0.0, 'status_at': 0.0, 'geo_at': 0.0,
    }
    while True:
        now = time.monotonic()
        box, boxed_at = car_box()
        fresh = box if now - boxed_at < BOX_STALE_S else None
        while msg := conn.recv_match(type=['COMMAND_LONG', 'GLOBAL_POSITION_INT'], blocking=False):
            if msg.get_type() == 'GLOBAL_POSITION_INT':
                state['car'] = msg if msg.get_srcSystem() != conn.target_system else state['car']
            elif msg.target_system == conn.mav.srcSystem and msg.target_component == COMPONENT:
                answer(conn, msg, state, fresh)
        if now - state['beat_at'] >= HEARTBEAT_S:
            conn.mav.heartbeat_send(MAV.MAV_TYPE_CAMERA, MAV.MAV_AUTOPILOT_INVALID, 0, 0, MAV.MAV_STATE_ACTIVE)
            state['beat_at'] = now
        if state['tracking'] and fresh is not None:
            state['seen_at'] = now
        if state['tracking'] and now - state['seen_at'] > LOST_S:
            state['tracking'] = False
            send_rates(conn, 0.0, 0.0)
            print('Lost the car')
        if state['tracking'] and now - state['steered_at'] >= STEER_S:
            send_rates(conn, *(steer(fresh) if fresh is not None else (0.0, 0.0)))
            state['steered_at'] = now
        if state['status_s'] and now - state['status_at'] >= state['status_s']:
            send_status(conn, fresh, state['tracking'])
            state['status_at'] = now
        if state['geo_s'] and state['tracking'] and state['car'] and now - state['geo_at'] >= state['geo_s']:
            send_geo(conn, state['car'])
            state['geo_at'] = now
        await asyncio.sleep(TICK_S)
