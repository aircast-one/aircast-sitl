import asyncio
import json
import os
import signal
import subprocess
from pathlib import Path
from urllib.parse import urlencode, urlsplit

import websockets

SITE = os.environ.get('SITL_SITE', 'https://sitl.aircast.one').rstrip('/')
LOOK = os.environ.get('CAMERA_LOOK', 'photoreal')
PUBLISHER = f"publisher:{os.environ.get('CAMERA_PUBLISHER_PASS', '')}"
CHROME = os.environ.get('CHROME', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
UNREAL = os.environ.get(
    'UNREAL_EDITOR', '/Users/Shared/Epic Games/UE_5.8/Engine/Binaries/Mac/UnrealEditor.app/Contents/MacOS/UnrealEditor'
)
UNREAL_PROJECT = Path(__file__).resolve().parent.parent / 'unreal' / 'AircastSim.uproject'
PROFILES = Path.home() / 'Library' / 'Caches' / 'aircast-sitl-camera'
GIMBALS = {'sim': 1, 'shoot': 2}
RECONNECT_S = 2

HOST = urlsplit(SITE).hostname
SECURE = SITE.startswith('https://')
BRIDGE = f'wss://{HOST}/ws' if SECURE else f'ws://{HOST}:8889'
WHIP = f'{SITE}/video' if SECURE else f'http://{HOST}:8890'
RTSP = f'rtsp://{PUBLISHER}@{HOST}:8554'


def chrome(feed):
    query = urlencode({'look': LOOK, 'gimbal': GIMBALS[feed], 'whip': f'{WHIP}/{feed}/whip', 'publisher': PUBLISHER})
    return [
        CHROME,
        '--headless',
        f'--user-data-dir={PROFILES / feed}',
        '--window-size=1280,720',
        '--disable-features=WebRtcHideLocalIpsWithMdns',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        f'{SITE}/camera?{query}',
    ]


def unreal():
    return [
        UNREAL, str(UNREAL_PROJECT), '-game', '-windowed', '-ResX=1280', '-ResY=720', '-log',
        f'-Telemetry={BRIDGE}', f'-Rtsp={RTSP}/sim', f"-IonToken={os.environ.get('CESIUM_ION_TOKEN', '')}",
    ]


def start(feed):
    print(f'Rendering {feed}', flush=True)
    command = unreal() if LOOK == 'unreal' and feed == 'sim' else chrome(feed)
    return subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)


def stop(feed, process):
    print(f'Stopping {feed}', flush=True)
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass


def reconcile(running, wanted):
    for feed, process in running.items():
        if feed not in wanted and process.poll() is None:
            stop(feed, process)
    alive = {feed: process for feed, process in running.items() if feed in wanted and process.poll() is None}
    return alive | {feed: start(feed) for feed in sorted(wanted - alive.keys())}


def demanded(message):
    try:
        report = json.loads(message)
    except ValueError:
        return None
    if not isinstance(report, dict) or report.get('type') != 'CAMERA_DEMAND':
        return None
    return set(report.get('feeds', [])) & GIMBALS.keys()


async def main():
    state = {'running': {}, 'wanted': set()}
    PROFILES.mkdir(parents=True, exist_ok=True)
    asyncio.get_running_loop().add_signal_handler(signal.SIGTERM, asyncio.current_task().cancel)
    print(f'Camera agent for {SITE}, look {LOOK}', flush=True)
    try:
        while True:
            try:
                async with websockets.connect(BRIDGE, max_size=None) as bridge:
                    print(f'Listening for camera demand on {BRIDGE}', flush=True)
                    async for message in bridge:
                        wanted = demanded(message)
                        state['wanted'] = state['wanted'] if wanted is None else wanted
                        state['running'] = reconcile(state['running'], state['wanted'])
            except (OSError, websockets.WebSocketException) as e:
                print(f'Bridge {BRIDGE} unreachable ({e}), retrying', flush=True)
            await asyncio.sleep(RECONNECT_S)
    finally:
        reconcile(state['running'], set())


if __name__ == '__main__':
    asyncio.run(main())
