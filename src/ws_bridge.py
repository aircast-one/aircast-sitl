"""
WebSocket-to-MAVLink bridge for browser-based telemetry.
Connects to ArduCopter SITL on localhost:5760 (TCP) via pymavlink
and forwards parsed telemetry as JSON over WebSocket to browser clients.
"""
import asyncio
import json
import os
import time

import websockets
from pymavlink import mavutil

WANTED_TYPES = {'HEARTBEAT', 'ATTITUDE', 'GLOBAL_POSITION_INT', 'VFR_HUD'}


def msg_to_json(msg):
    """Convert a pymavlink message to JSON-serializable dict"""
    msg_type = msg.get_type()

    if msg_type == 'HEARTBEAT':
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


def connect_mavlink(host, port):
    """Connect to SITL via TCP with retry, request data streams"""
    while True:
        try:
            conn = mavutil.mavlink_connection(f'tcp:{host}:{port}')
            conn.wait_heartbeat(timeout=10)
            print(f'Connected to MAVLink at tcp:{host}:{port} (sysid={conn.target_system})')
            conn.mav.request_data_stream_send(
                conn.target_system, conn.target_component,
                mavutil.mavlink.MAV_DATA_STREAM_ALL, 10, 1
            )
            print('Requested MAVLink data streams')
            return conn
        except Exception as e:
            print(f'Waiting for SITL at tcp:{host}:{port}... ({e})')
            time.sleep(2)


clients = set()


async def ws_handler(websocket):
    """Handle a WebSocket client connection"""
    clients.add(websocket)
    addr = websocket.remote_address
    print(f'WebSocket client connected: {addr}')
    try:
        async for _ in websocket:
            pass  # We only send, ignore incoming messages
    except websockets.ConnectionClosed:
        pass
    finally:
        clients.discard(websocket)
        print(f'WebSocket client disconnected: {addr}')


async def mavlink_reader(mavlink_host, mavlink_port):
    """Read MAVLink messages and broadcast to WebSocket clients"""
    mav = connect_mavlink(mavlink_host, mavlink_port)

    while True:
        try:
            msg = mav.recv_match(type=list(WANTED_TYPES), blocking=False)
            if msg:
                data = msg_to_json(msg)
                if data and clients:
                    payload = json.dumps(data)
                    dead = []
                    for ws in clients.copy():
                        try:
                            await ws.send(payload)
                        except websockets.ConnectionClosed:
                            dead.append(ws)
                    for ws in dead:
                        clients.discard(ws)
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

    async with websockets.serve(ws_handler, '0.0.0.0', ws_port):
        print(f'WebSocket MAVLink bridge on ws://0.0.0.0:{ws_port}')
        await mavlink_reader(mavlink_host, mavlink_port)


if __name__ == '__main__':
    asyncio.run(main())
