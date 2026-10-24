import asyncio
import functools
import json
import math
import os
import time

import websockets
from pymavlink import mavutil

import camera

WANTED_TYPES = {'HEARTBEAT', 'ATTITUDE', 'GLOBAL_POSITION_INT', 'VFR_HUD', 'GIMBAL_DEVICE_ATTITUDE_STATUS'}
YAW_IN_EARTH_FRAME = 64
STREAM_SILENCE_S = 3
MAVLINK_PATH = '/ws/mavlink'


def msg_to_json(msg, vehicle_sysid):
    msg_type = msg.get_type()

    if msg_type == 'GLOBAL_POSITION_INT' and msg.get_srcSystem() != vehicle_sysid:
        return {
            'type': 'CAR',
            'lat': msg.lat / 1e7,
            'lng': msg.lon / 1e7,
            'hdg': msg.hdg / 100.0,
        }
    elif msg_type == 'HEARTBEAT':
        if msg.autopilot == mavutil.mavlink.MAV_AUTOPILOT_INVALID:
            return None
        return {
            'type': 'HEARTBEAT',
            'armed': bool(msg.base_mode & mavutil.mavlink.MAV_MODE_FLAG_SAFETY_ARMED),
            'mode': msg.custom_mode,
            'system_status': msg.system_status,
        }
    elif msg_type == 'ATTITUDE':
        return {
            'type': 'ATTITUDE',
            'roll': msg.roll,
            'pitch': msg.pitch,
            'yaw': msg.yaw,
            'rollspeed': msg.rollspeed,
            'pitchspeed': msg.pitchspeed,
            'yawspeed': msg.yawspeed,
        }
    elif msg_type == 'GLOBAL_POSITION_INT':
        return {
            'type': 'GLOBAL_POSITION_INT',
            'lat': msg.lat / 1e7,
            'lng': msg.lon / 1e7,
            'alt': msg.alt / 1000.0,
            'relative_alt': msg.relative_alt / 1000.0,
            'vx': msg.vx / 100.0,
            'vy': msg.vy / 100.0,
            'vz': msg.vz / 100.0,
            'hdg': msg.hdg / 100.0,
        }
    elif msg_type == 'GIMBAL_DEVICE_ATTITUDE_STATUS':
        w, x, y, z = msg.q
        return {
            'type': 'GIMBAL',
            'device': msg.gimbal_device_id,
            'roll': math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y)),
            'pitch': math.asin(max(-1.0, min(1.0, 2 * (w * y - z * x)))),
            'yaw': math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)),
            'earth_yaw': bool(msg.flags & YAW_IN_EARTH_FRAME),
        }
    elif msg_type == 'VFR_HUD':
        return {
            'type': 'VFR_HUD',
            'airspeed': msg.airspeed,
            'groundspeed': msg.groundspeed,
            'heading': msg.heading,
            'throttle': msg.throttle,
            'alt': msg.alt,
            'climb': msg.climb,
        }
    return None


def request_streams(conn):
    conn.mav.request_data_stream_send(
        conn.target_system, conn.target_component,
        mavutil.mavlink.MAV_DATA_STREAM_ALL, 10, 1
    )


def connect_mavlink(host, port):
    while True:
        try:
            conn = mavutil.mavlink_connection(f'tcp:{host}:{port}')
            conn.wait_heartbeat(timeout=10)
            print(f'Connected to MAVLink at tcp:{host}:{port} (sysid={conn.target_system})')
            request_streams(conn)
            print('Requested MAVLink data streams')
            return conn
        except Exception as e:
            print(f'Waiting for SITL at tcp:{host}:{port}... ({e})')
            time.sleep(2)


clients = set()
demands = {}
car_box = {'box': None, 'at': 0.0}


def demand_message():
    return json.dumps({'type': 'CAMERA_DEMAND', 'feeds': sorted(set(demands.values()))})


async def broadcast(payload):
    sockets = list(clients)
    results = await asyncio.gather(*(ws.send(payload) for ws in sockets), return_exceptions=True)
    clients.difference_update(ws for ws, result in zip(sockets, results) if isinstance(result, websockets.ConnectionClosed))


def report_from(message):
    try:
        report = json.loads(message)
    except ValueError:
        return None
    return report if isinstance(report, dict) else None


def note_car_box(report):
    box = report.get('box')
    valid = isinstance(box, list) and len(box) == 4 and all(type(v) in (int, float) for v in box)
    car_box.update(box=box if valid else None, at=time.monotonic())


async def mavlink_pipe(websocket, host, port):
    reader, writer = await asyncio.open_connection(host, port)

    async def tcp_to_socket():
        while data := await reader.read(65536):
            await websocket.send(data)
        await websocket.close()

    async def socket_to_tcp():
        try:
            async for message in websocket:
                writer.write(message)
                await writer.drain()
        finally:
            writer.close()

    await asyncio.gather(tcp_to_socket(), socket_to_tcp(), return_exceptions=True)


async def ws_handler(websocket, mavlink_host, mavlink_port):
    if websocket.request.path == MAVLINK_PATH:
        return await mavlink_pipe(websocket, mavlink_host, mavlink_port)
    clients.add(websocket)
    addr = websocket.remote_address
    print(f'WebSocket client connected: {addr}')
    try:
        await websocket.send(demand_message())
        async for message in websocket:
            report = report_from(message)
            if report and report.get('type') == 'CAR_BOX':
                note_car_box(report)
            elif report and report.get('type') == 'CAMERA_DEMAND' and isinstance(report.get('feed'), str):
                demands[websocket] = report['feed']
                print(f'Camera feed {report["feed"]} demanded')
                await broadcast(demand_message())
    except websockets.ConnectionClosed:
        pass
    finally:
        clients.discard(websocket)
        print(f'WebSocket client disconnected: {addr}')
        if demands.pop(websocket, None) is not None:
            await broadcast(demand_message())


async def mavlink_reader(mavlink_host, mavlink_port):
    mav = connect_mavlink(mavlink_host, mavlink_port)
    streamed_at = time.monotonic()

    while True:
        try:
            msg = mav.recv_match(type=list(WANTED_TYPES), blocking=False)
            if msg:
                if msg.get_type() != 'HEARTBEAT' and msg.get_srcSystem() == mav.target_system:
                    streamed_at = time.monotonic()
                elif time.monotonic() - streamed_at > STREAM_SILENCE_S:
                    print('Only heartbeats for a while, the SITL restarted: requesting data streams again')
                    request_streams(mav)
                    streamed_at = time.monotonic()
                data = msg_to_json(msg, mav.target_system)
                if data and clients:
                    await broadcast(json.dumps(data))
            else:
                await asyncio.sleep(0.01)
        except Exception as e:
            print(f'MAVLink read error: {e}, reconnecting...')
            try:
                mav.close()
            except Exception:
                pass
            await asyncio.sleep(1)
            mav = connect_mavlink(mavlink_host, mavlink_port)


async def main():
    mavlink_host = os.environ.get('MAVLINK_HOST', '127.0.0.1')
    mavlink_port = int(os.environ.get('MAVLINK_PORT', '5762'))
    ws_port = int(os.environ.get('WS_PORT', '8889'))

    handler = functools.partial(ws_handler, mavlink_host=mavlink_host, mavlink_port=mavlink_port)
    async with websockets.serve(handler, '0.0.0.0', ws_port):
        print(f'WebSocket MAVLink bridge on ws://0.0.0.0:{ws_port}, raw MAVLink on {MAVLINK_PATH}')
        tasks = [mavlink_reader(mavlink_host, mavlink_port)]
        if os.environ.get('SIM_CAMERA') == '1':
            tasks.append(camera.run(mavlink_host, mavlink_port, lambda: (car_box['box'], car_box['at'])))
        await asyncio.gather(*tasks)


if __name__ == '__main__':
    asyncio.run(main())
